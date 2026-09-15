"""METAR proxy (aviationweather.gov) + active-runway computation.

Returns parsed weather for an airport and the runways most likely in use,
derived from the reported wind (with a calm-wind default per airport), plus
the head/crosswind component on every runway end. The raw observation is also
decoded here — present weather (rain / showers / fog / thunder …), visibility
in metres, cloud layers and ceiling — so the kiosk can animate the sky over
the receiver from the nearest station's report.

Cached ~5 min. Proxied server-side for a polite User-Agent + caching. Several
stations can be fetched in one upstream call via ``GET /api/metar?ids=A,B,C``.
"""

import logging
import math
import re
import time
from datetime import UTC, datetime

import httpx
from fastapi import APIRouter, Query

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/metar", tags=["metar"])

_UA = "ant-adsb-radar/1.0 (+https://github.com/anthonyjhicks/ant-adsb-radar; ADS-B kiosk)"
_TTL = 300
_cache: dict[str, tuple[float, dict]] = {}

# Station catalogue: reference point (for "nearest to the receiver"), runway
# ends with their (approximately true) headings, and the calm-wind preference.
STATIONS: dict[str, dict] = {
    "EGLL": {
        "name": "Heathrow",
        "lat": 51.4775,
        "lon": -0.4614,
        "elev_ft": 83,
        "ends": [("09L", 90), ("09R", 90), ("27L", 270), ("27R", 270)],
        "preferred": 270,
    },
    "EGKK": {
        "name": "Gatwick",
        "lat": 51.1481,
        "lon": -0.1903,
        "elev_ft": 203,
        "ends": [("08R", 78), ("26L", 258)],
        "preferred": 258,
    },
    "EGSS": {
        "name": "Stansted",
        "lat": 51.885,
        "lon": 0.235,
        "elev_ft": 348,
        "ends": [("04", 43), ("22", 223)],
        "preferred": 223,
    },
    "EGLC": {
        "name": "London City",
        "lat": 51.5053,
        "lon": 0.0553,
        "elev_ft": 19,
        "ends": [("09", 93), ("27", 273)],
        "preferred": 273,
    },
    "EGLW": {
        # London Heliport, Battersea: one FATO strip along the Thames; helicopters
        # land into wind on whichever end faces it. Reports only while open.
        "name": "London Heliport",
        "lat": 51.4697,
        "lon": -0.1794,
        "elev_ft": 18,
        "ends": [("04", 35), ("22", 215)],
        "preferred": 215,
    },
    "EGGW": {
        "name": "Luton",
        "lat": 51.8747,
        "lon": -0.3683,
        "elev_ft": 526,
        "ends": [("07", 75), ("25", 255)],
        "preferred": 255,
    },
    "EGLF": {
        "name": "Farnborough",
        "lat": 51.2758,
        "lon": -0.7763,
        "elev_ft": 238,
        "ends": [("06", 61), ("24", 241)],
        "preferred": 241,
    },
}

# Kept for callers that still import the old name.
RUNWAYS = STATIONS


def _angdiff(a: float, b: float) -> float:
    d = abs(a - b) % 360
    return min(d, 360 - d)


def _mode_label(heading: float) -> str:
    for ref, label in [(0, "Northerly"), (90, "Easterly"), (180, "Southerly"), (270, "Westerly")]:
        if _angdiff(heading, ref) <= 45:
            return label
    return "Northerly"


def _is_calm(wdir, wspd) -> bool:
    return wspd is None or wspd < 4 or wdir is None or wdir == 0


def _active_runways(icao: str, wdir, wspd) -> dict:
    cfg = STATIONS.get(icao)
    if not cfg:
        return {"runways": [], "mode": None}
    calm = _is_calm(wdir, wspd)
    ref = cfg["preferred"] if calm else wdir
    chosen = [name for name, hdg in cfg["ends"] if _angdiff(hdg, ref) <= 90]
    if not chosen:
        chosen = [name for name, hdg in cfg["ends"] if _angdiff(hdg, cfg["preferred"]) <= 90]
    heading = next((hdg for name, hdg in cfg["ends"] if name == chosen[0]), ref) if chosen else ref
    mode = _mode_label(heading) + (" (calm)" if calm else "")
    return {"runways": chosen, "mode": mode}


def _runway_winds(icao: str, wdir, wspd, active: list[str]) -> list[dict]:
    """Head/crosswind component (kt) on every runway end.

    ``headwind`` is negative for a tailwind; ``crosswind`` is unsigned with
    ``crosswind_from`` saying which side ("L"/"R", as seen landing on that
    end). Both are null when the wind direction is variable/unknown.
    """
    cfg = STATIONS.get(icao)
    if not cfg:
        return []
    out = []
    for name, hdg in cfg["ends"]:
        entry: dict = {"name": name, "heading": hdg, "active": name in active}
        if wspd is None or wspd == 0:
            entry.update({"headwind": 0, "crosswind": 0, "crosswind_from": None})
        elif wdir is None or wdir == 0:
            # Variable direction: the components are undefined.
            entry.update({"headwind": None, "crosswind": None, "crosswind_from": None})
        else:
            rel = math.radians(wdir - hdg)
            head = wspd * math.cos(rel)
            cross = wspd * math.sin(rel)
            entry.update(
                {
                    "headwind": round(head),
                    "crosswind": round(abs(cross)),
                    "crosswind_from": "R" if cross > 0.5 else ("L" if cross < -0.5 else None),
                }
            )
        out.append(entry)
    return out


# --- raw-observation decoding ------------------------------------------------

_STOP_TOKENS = {"RMK", "TEMPO", "BECMG", "NOSIG", "PROB30", "PROB40"}

_WX_RE = re.compile(
    r"^(?P<int>\+|-|VC)?"
    r"(?P<desc>MI|BC|PR|DR|BL|SH|TS|FZ)?"
    r"(?P<precip>(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP)+)?"
    r"(?P<obsc>BR|FG|FU|VA|DU|SA|HZ|PY)?"
    r"(?P<other>PO|SQ|FC|SS|DS)?$"
)
_PRECIP_WORDS = {
    "DZ": "drizzle",
    "RA": "rain",
    "SN": "snow",
    "SG": "snow grains",
    "IC": "ice crystals",
    "PL": "ice pellets",
    "GR": "hail",
    "GS": "small hail",
    "UP": "unknown precipitation",
}
_OBSC_WORDS = {
    "BR": "mist",
    "FG": "fog",
    "FU": "smoke",
    "VA": "volcanic ash",
    "DU": "dust",
    "SA": "sand",
    "HZ": "haze",
    "PY": "spray",
}
_OTHER_WORDS = {
    "PO": "dust whirls",
    "SQ": "squalls",
    "FC": "funnel cloud",
    "SS": "sandstorm",
    "DS": "duststorm",
}
_DESC_WORDS = {
    "MI": "shallow",
    "BC": "patches of",
    "PR": "partial",
    "DR": "drifting",
    "BL": "blowing",
    "FZ": "freezing",
}
_INTENSITY = {"-": "light", "+": "heavy", "VC": "vicinity", None: "moderate"}

_VIS_RE = re.compile(r"^(?P<m>\d{4})(?:NDV|[NSEW]{1,2})?$")
_CLOUD_RE = re.compile(r"^(?P<cover>FEW|SCT|BKN|OVC|VV)(?P<base>\d{3}|///)(?P<type>CB|TCU|///)?$")
_WIND_RE = re.compile(r"^(?P<dir>\d{3}|VRB)(?P<spd>\d{2,3})(?:G(?P<gst>\d{2,3}))?(?:KT|MPS|KMH)$")
_WIND_VAR_RE = re.compile(r"^(?P<a>\d{3})V(?P<b>\d{3})$")
_TIME_RE = re.compile(r"^\d{6}Z$")

_COVER_OKTAS = {"FEW": 1.5, "SCT": 3.5, "BKN": 6, "OVC": 8, "VV": 8}
_SKY_WORDS = {
    "FEW": "few",
    "SCT": "scattered",
    "BKN": "broken",
    "OVC": "overcast",
    "VV": "obscured",
}


def _tokens(raw: str | None) -> list[str]:
    """Body tokens of a METAR, up to the first trend/remark group."""
    out: list[str] = []
    for tok in (raw or "").replace("=", " ").split():
        if tok in _STOP_TOKENS:
            break
        out.append(tok)
    return out


def _weather_label(m: re.Match) -> str:
    parts: list[str] = []
    intensity = m.group("int")
    desc = m.group("desc")
    precip = m.group("precip") or ""
    obsc = m.group("obsc")
    other = m.group("other")
    precips = [precip[i : i + 2] for i in range(0, len(precip), 2)]

    if intensity in ("-", "+"):
        parts.append(_INTENSITY[intensity])
    if desc and desc != "SH" and desc != "TS":
        parts.append(_DESC_WORDS[desc])
    if desc == "TS":
        parts.append("thunderstorm")
        if precips:
            parts.append("with")
    words = [_PRECIP_WORDS[p] for p in precips]
    if desc == "SH":
        words = [w + " showers" for w in words] or ["showers"]
    if words:
        parts.append(" and ".join(words))
    if obsc:
        parts.append(_OBSC_WORDS[obsc])
    if other:
        parts.append(_OTHER_WORDS[other])
    if intensity == "VC":
        parts.append("in the vicinity")
    return " ".join(parts)


def parse_weather(raw: str | None) -> list[dict]:
    """Present-weather groups (``-SHRA``, ``BR``, ``VCTS`` …) decoded."""
    out: list[dict] = []
    for tok in _tokens(raw):
        m = _WX_RE.match(tok)
        if not m:
            continue
        if not (m.group("desc") or m.group("precip") or m.group("obsc") or m.group("other")):
            continue
        precip = m.group("precip") or ""
        out.append(
            {
                "code": tok,
                "intensity": _INTENSITY[m.group("int")],
                "descriptor": m.group("desc"),
                "precip": [precip[i : i + 2] for i in range(0, len(precip), 2)],
                "obscuration": m.group("obsc"),
                "other": m.group("other"),
                "label": _weather_label(m),
            }
        )
    return out


def parse_visibility(raw: str | None) -> dict:
    """Prevailing visibility in metres (``9999`` → 10000 = 10 km or more)."""
    toks = _tokens(raw)
    if "CAVOK" in toks:
        return {"visibility_m": 10000, "cavok": True}
    # Only look after the time group (and any wind group), so nothing in the
    # header can read as a visibility; a report with the wind missing ("/////KT")
    # still decodes.
    started = False
    for i, tok in enumerate(toks):
        if _TIME_RE.match(tok) or _WIND_RE.match(tok):
            started = True
            continue
        if not started:
            continue
        if _WIND_VAR_RE.match(tok):
            continue
        m = _VIS_RE.match(tok)
        if m:
            metres = int(m.group("m"))
            return {"visibility_m": 10000 if metres >= 9999 else metres, "cavok": False}
        # US style: "10SM", "1/2SM", or "2 1/2SM" (whole number in its own token).
        nxt = toks[i + 1] if i + 1 < len(toks) else ""
        if tok.isdigit() and nxt.endswith("SM") and "/" in nxt:
            sm = _parse_statute_miles(nxt)
            if sm is not None:
                return {"visibility_m": round((int(tok) + sm) * 1609.344), "cavok": False}
        if tok.endswith("SM"):
            sm = _parse_statute_miles(tok)
            if sm is not None:
                return {"visibility_m": round(sm * 1609.344), "cavok": False}
        # First cloud/temperature group means the visibility group was absent.
        if _CLOUD_RE.match(tok) or re.match(r"^M?\d{2}/M?\d{2}$", tok):
            break
    return {"visibility_m": None, "cavok": False}


def _parse_statute_miles(tok: str) -> float | None:
    body = tok[:-2].lstrip("PM")
    if "/" in body:
        num, den = body.split("/", 1)
        try:
            return int(num) / int(den)
        except (ValueError, ZeroDivisionError):
            return None
    try:
        return float(body)
    except ValueError:
        return None


def parse_clouds(raw: str | None) -> dict:
    """Cloud layers (base ft AGL, cover, CB/TCU), the ceiling, and a sky summary."""
    layers: list[dict] = []
    toks = _tokens(raw)
    for tok in toks:
        m = _CLOUD_RE.match(tok)
        if not m:
            continue
        base = m.group("base")
        layers.append(
            {
                "cover": m.group("cover"),
                "base_ft": None if base == "///" else int(base) * 100,
                "type": m.group("type") if m.group("type") in ("CB", "TCU") else None,
                "oktas": _COVER_OKTAS[m.group("cover")],
            }
        )
    layers.sort(key=lambda layer: (layer["base_ft"] is None, layer["base_ft"] or 0))
    ceiling = next(
        (
            layer["base_ft"]
            for layer in layers
            if layer["cover"] in ("BKN", "OVC", "VV") and layer["base_ft"] is not None
        ),
        None,
    )
    if layers:
        top = max(layers, key=lambda layer: layer["oktas"])
        sky = _SKY_WORDS[top["cover"]]
    elif "CAVOK" in toks:
        sky = "cavok"
    elif any(t in ("NSC", "NCD", "SKC", "CLR") for t in toks):
        sky = "clear"
    else:
        sky = "unknown"
    return {"cloud_layers": layers, "ceiling_ft": ceiling, "sky": sky}


def parse_wind_variation(raw: str | None) -> dict:
    for tok in _tokens(raw):
        m = _WIND_VAR_RE.match(tok)
        if m:
            return {"var_from": int(m.group("a")), "var_to": int(m.group("b"))}
    return {"var_from": None, "var_to": None}


def _obs_time(rec: dict) -> str | None:
    ts = rec.get("obsTime")
    if isinstance(ts, (int, float)):
        return datetime.fromtimestamp(ts, UTC).isoformat().replace("+00:00", "Z")
    rt = rec.get("reportTime")
    return str(rt) if rt else None


def build_metar(code: str, rec: dict | None) -> dict:
    """The API document for one station from an aviationweather record (or none)."""
    st = STATIONS.get(code, {})
    base: dict = {
        "icao": code,
        "available": False,
        "name": st.get("name"),
        "lat": st.get("lat"),
        "lon": st.get("lon"),
        "elev_ft": st.get("elev_ft"),
    }
    if not rec:
        return base

    raw = rec.get("rawOb")
    wdir = rec.get("wdir") if isinstance(rec.get("wdir"), int) else None
    wspd = rec.get("wspd")
    active = _active_runways(code, wdir, wspd)
    return {
        **base,
        "available": True,
        "name": st.get("name") or (rec.get("name") or "").split(",")[0],
        "lat": st.get("lat", rec.get("lat")),
        "lon": st.get("lon", rec.get("lon")),
        "raw": raw,
        "obs_time": _obs_time(rec),
        "wind": {
            "dir": wdir,
            "speed": wspd,
            "gust": rec.get("wgst"),
            "variable": rec.get("wdir") == "VRB" or rec.get("wdir") == 0,
            **parse_wind_variation(raw),
        },
        "temp": rec.get("temp"),
        "dewp": rec.get("dewp"),
        "visibility": rec.get("visib"),
        **parse_visibility(raw),
        "qnh": rec.get("altim"),
        "flight_category": rec.get("fltCat"),
        "clouds": rec.get("clouds") or [],
        **parse_clouds(raw),
        "wx": rec.get("wxString"),
        "weather": parse_weather(raw),
        **active,
        "runway_winds": _runway_winds(code, wdir, wspd, active["runways"]),
    }


# --- upstream + cache --------------------------------------------------------


async def _fetch_upstream(codes: list[str]) -> dict[str, dict]:
    """One aviationweather call for several stations, keyed by ICAO."""
    if not codes:
        return {}
    async with httpx.AsyncClient(timeout=8.0, headers={"User-Agent": _UA}) as client:
        resp = await client.get(
            "https://aviationweather.gov/api/data/metar",
            params={"ids": ",".join(codes), "format": "json"},
        )
        if resp.status_code != 200:
            return {}
        arr = resp.json()
    out: dict[str, dict] = {}
    for rec in arr if isinstance(arr, list) else []:
        icao = str(rec.get("icaoId") or "").upper()
        if icao:
            out[icao] = rec
    # A single-station query can come back without icaoId on old API builds.
    if not out and len(codes) == 1 and isinstance(arr, list) and arr:
        out[codes[0]] = arr[0]
    return out


async def _get_many(codes: list[str]) -> list[dict]:
    now = time.time()
    results: dict[str, dict] = {}
    missing: list[str] = []
    for code in codes:
        hit = _cache.get(code)
        if hit and now - hit[0] < _TTL:
            results[code] = hit[1]
        else:
            missing.append(code)

    if missing:
        recs: dict[str, dict] = {}
        try:
            recs = await _fetch_upstream(missing)
        except Exception as exc:  # noqa: BLE001
            logger.debug("metar lookup failed for %s: %s", missing, exc)
        for code in missing:
            doc = build_metar(code, recs.get(code))
            _cache[code] = (now, doc)
            results[code] = doc

    return [results[code] for code in codes]


def _clean_codes(ids: str) -> list[str]:
    seen: list[str] = []
    for part in re.split(r"[,\s]+", ids or ""):
        code = part.strip().upper()
        if re.fullmatch(r"[A-Z0-9]{4}", code) and code not in seen:
            seen.append(code)
    return seen[:12]


@router.get("")
async def get_metars(ids: str = Query("", description="Comma-separated ICAO codes")) -> dict:
    """Several stations in one call (one upstream request for the uncached ones)."""
    codes = _clean_codes(ids) or list(STATIONS)
    return {"stations": await _get_many(codes)}


@router.get("/{icao}")
async def get_metar(icao: str) -> dict:
    codes = _clean_codes(icao)
    if not codes:
        return {"icao": (icao or "").strip().upper(), "available": False}
    return (await _get_many(codes[:1]))[0]
