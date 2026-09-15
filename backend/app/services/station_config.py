"""StationConfigStore — durable station settings, kept in a JSON file.

What the kiosk calls itself, where the receiver is, how the fixed-range scopes
are set up, and which airports the weather view shows. Edited at /config next
to the view order, and stored the same way — a JSON file on the config volume,
written atomically — so every screen showing the station agrees and it
survives a redeploy.

The document is sparse on disk and complete in memory: only the keys actually
saved are written, and `get()` always returns every setting with the defaults
filled in, so a file written by an older version (or by hand) never leaves the
kiosk missing a value. A malformed key is dropped on its own rather than
discarding the rest.

Receiver location. readsb normally reports its own site position, which the
backend uses to centre the scope and to compute each contact's range and
bearing. A manual `lat`/`lon` here overrides that — for a readsb that isn't
configured with a location, or to publish a deliberately coarse position — and
while it is set the backend computes range and bearing from the override
instead of trusting readsb's site-relative distance, so everything on screen
stays consistent with the centre of the scope.
"""

import json
import logging
import math
import os
import re
import tempfile
import threading
import time
from pathlib import Path

logger = logging.getLogger(__name__)

# Bounds are mirrored in frontend/src/lib/api/config.ts — keep them in step.
MAX_NAME_LEN = 40
MAX_LABEL_LEN = 32
MIN_LOCAL_NM, MAX_LOCAL_NM = 5, 240
MIN_HOME_NM, MAX_HOME_NM = 2, 100
MAX_METAR_STATIONS = 4

_ICAO_RE = re.compile(r"^[A-Z0-9]{4}$")

DEFAULTS: dict = {
    # Shown top-left of every view (and as the page title).
    "name": "Ant ADS-B Radar",
    # Manual receiver position; both null means "use what readsb reports".
    "lat": None,
    "lon": None,
    # Print the receiver's coordinates in the kiosk header. Off by default: a
    # wall display is often visible to visitors, and a photo of it shouldn't
    # give the site away.
    "show_coords": False,
    # The fixed-range scopes: the wide one is labelled "Local · <label>" (or
    # "Local · <n> nm" when the label is empty), the tight one is "Local · Home".
    "local_label": "",
    "local_nm": 40,
    "home_nm": 10,
    # ICAO codes of the airports on the Weather & Runways view, in card order.
    # The sky is animated from whichever of them is nearest and reporting.
    "metar_stations": ["EGLL", "EGKK", "EGLW", "EGLC"],
}


class InvalidStation(ValueError):
    """A submitted station setting is out of bounds or the wrong shape."""


def _text(value: object, field: str, max_len: int, *, allow_empty: bool) -> str:
    if not isinstance(value, str):
        raise InvalidStation(f"{field} must be a string")
    text = " ".join(value.split())  # collapse whitespace, strip control characters
    if not text and not allow_empty:
        raise InvalidStation(f"{field} must not be empty")
    if len(text) > max_len:
        raise InvalidStation(f"{field} must be at most {max_len} characters")
    return text


def _number(value: object, field: str, lo: float, hi: float) -> float:
    # bool is an int subclass, and json.loads happily produces NaN/Infinity,
    # so neither is caught by an isinstance check alone.
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise InvalidStation(f"{field} must be a number")
    if not lo <= value <= hi:
        raise InvalidStation(f"{field} must be between {lo} and {hi}")
    return float(value)


def validate_station(raw: object) -> dict:
    """Return the settings present in `raw` as a clean sparse dict, or raise InvalidStation.

    Keys absent from `raw` (or explicitly null, for the optional ones) are left
    out, which `get()` later fills from DEFAULTS.
    """
    if not isinstance(raw, dict):
        raise InvalidStation("station config must be an object")
    out: dict = {}

    if raw.get("name") is not None:
        out["name"] = _text(raw["name"], "name", MAX_NAME_LEN, allow_empty=False)

    lat, lon = raw.get("lat"), raw.get("lon")
    if (lat is None) != (lon is None):
        raise InvalidStation("lat and lon must be given together")
    if lat is not None:
        out["lat"] = round(_number(lat, "lat", -90, 90), 6)
        out["lon"] = round(_number(lon, "lon", -180, 180), 6)

    if raw.get("show_coords") is not None:
        if not isinstance(raw["show_coords"], bool):
            raise InvalidStation("show_coords must be true or false")
        out["show_coords"] = raw["show_coords"]

    if raw.get("local_label") is not None:
        out["local_label"] = _text(
            raw["local_label"], "local_label", MAX_LABEL_LEN, allow_empty=True
        )
    if raw.get("local_nm") is not None:
        nm = _number(raw["local_nm"], "local_nm", MIN_LOCAL_NM, MAX_LOCAL_NM)
        out["local_nm"] = int(round(nm))
    if raw.get("home_nm") is not None:
        nm = _number(raw["home_nm"], "home_nm", MIN_HOME_NM, MAX_HOME_NM)
        out["home_nm"] = int(round(nm))

    if raw.get("metar_stations") is not None:
        stations = raw["metar_stations"]
        if not isinstance(stations, list):
            raise InvalidStation("metar_stations must be a list of ICAO codes")
        if len(stations) > MAX_METAR_STATIONS:
            raise InvalidStation(f"metar_stations must hold at most {MAX_METAR_STATIONS} codes")
        clean: list[str] = []
        for item in stations:
            code = item.strip().upper() if isinstance(item, str) else ""
            if not _ICAO_RE.match(code):
                raise InvalidStation(f"invalid ICAO code in metar_stations: {item!r}")
            if code in clean:
                raise InvalidStation(f"duplicate ICAO code in metar_stations: {code}")
            clean.append(code)
        out["metar_stations"] = clean

    return out


def with_defaults(sparse: dict) -> dict:
    doc = {k: (list(v) if isinstance(v, list) else v) for k, v in DEFAULTS.items()}
    doc.update(sparse)
    return doc


class StationConfigStore:
    def __init__(self, path: str) -> None:
        self.path = Path(path)
        self._lock = threading.Lock()
        # Raises if the directory can't be created; main.py treats that as
        # "no durable station config" and the kiosk falls back to the defaults.
        self.path.parent.mkdir(parents=True, exist_ok=True)
        # Cached parse of the file, keyed on its mtime, so the 1 Hz poll loop can
        # ask for the location override without re-parsing JSON every tick
        # while a hand edit of the file still takes effect on the next poll.
        self._cached: dict = {}
        self._cached_mtime: float | None = None

    def get(self) -> dict:
        """Every setting, defaults filled in, plus `updated_at`."""
        with self._lock:
            sparse = self._read()
        doc = with_defaults({k: v for k, v in sparse.items() if k != "updated_at"})
        doc["updated_at"] = sparse.get("updated_at")
        return doc

    def location(self) -> tuple[float, float] | None:
        """The manual receiver position, or None when readsb's own is to be used."""
        with self._lock:
            sparse = self._read()
        lat, lon = sparse.get("lat"), sparse.get("lon")
        if lat is None or lon is None:
            return None
        return (lat, lon)

    def set_config(self, raw: object) -> dict:
        sparse = validate_station(raw)
        sparse["updated_at"] = time.time()
        with self._lock:
            self._write(sparse)
        doc = with_defaults({k: v for k, v in sparse.items() if k != "updated_at"})
        doc["updated_at"] = sparse["updated_at"]
        return doc

    def _read(self) -> dict:
        try:
            mtime = self.path.stat().st_mtime
        except FileNotFoundError:
            self._cached, self._cached_mtime = {}, None
            return {}
        if mtime == self._cached_mtime:
            return dict(self._cached)
        try:
            raw = json.loads(self.path.read_text())
        except (OSError, ValueError) as exc:
            logger.warning("Station config unreadable (%s) — using defaults", exc)
            raw = {}
        if not isinstance(raw, dict):
            logger.warning("Station config malformed (not an object) — using defaults")
            raw = {}
        # Lenient read: keep every key that validates on its own, drop the rest,
        # so one bad value in a hand-edited file doesn't reset the whole station.
        clean: dict = {}
        for key in DEFAULTS:
            if key not in raw:
                continue
            if key in ("lat", "lon"):
                continue  # validated as a pair below
            try:
                clean.update(validate_station({key: raw[key]}))
            except InvalidStation as exc:
                logger.warning("Station config `%s` malformed (%s) — ignoring it", key, exc)
        try:
            clean.update(validate_station({"lat": raw.get("lat"), "lon": raw.get("lon")}))
        except InvalidStation as exc:
            logger.warning("Station config location malformed (%s) — ignoring it", exc)
        updated = raw.get("updated_at")
        if isinstance(updated, (int, float)) and not isinstance(updated, bool):
            clean["updated_at"] = updated
        self._cached, self._cached_mtime = clean, mtime
        return dict(clean)

    def _write(self, payload: dict) -> None:
        fd, tmp = tempfile.mkstemp(dir=self.path.parent, prefix=".station-", suffix=".json")
        try:
            with os.fdopen(fd, "w") as fh:
                json.dump(payload, fh, indent=2)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, self.path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise
        self._cached, self._cached_mtime = dict(payload), self.path.stat().st_mtime
