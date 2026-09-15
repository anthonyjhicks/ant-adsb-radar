"""Flight-route proxy (adsbdb.com), keyed by callsign.

Returns origin/destination airports (codes, city, lat/lon) for a callsign.
Proxied server-side for a polite User-Agent + caching; results (including
"unknown") are cached for a few hours since routes are stable within a day.
"""

import logging
import time

import httpx
from fastapi import APIRouter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/route", tags=["route"])

_UA = "ant-adsb-radar/1.0 (+https://github.com/anthonyjhicks/ant-adsb-radar; ADS-B kiosk)"
_TTL = 6 * 3600
_cache: dict[str, tuple[float, dict]] = {}

EMPTY = {
    "origin": None,
    "midpoint": None,
    "destination": None,
    "airline": None,
    "airline_icao": None,
    "airline_iata": None,
    "airline_country": None,
    "airline_callsign": None,
    "flight_iata": None,
    "flight_icao": None,
}


def _airport(a: dict | None) -> dict | None:
    if not a:
        return None
    return {
        "iata": a.get("iata_code"),
        "icao": a.get("icao_code"),
        "name": a.get("name"),
        "city": a.get("municipality"),
        "country": a.get("country_name") or a.get("country_iso_name"),
        "lat": a.get("latitude"),
        "lon": a.get("longitude"),
        "elevation": a.get("elevation"),
    }


@router.get("/{callsign}")
async def get_route(callsign: str) -> dict:
    cs = (callsign or "").strip().upper()
    if not cs:
        return dict(EMPTY)

    now = time.time()
    hit = _cache.get(cs)
    if hit and now - hit[0] < _TTL:
        return hit[1]

    result = dict(EMPTY)
    try:
        async with httpx.AsyncClient(timeout=8.0, headers={"User-Agent": _UA}) as client:
            resp = await client.get(f"https://api.adsbdb.com/v0/callsign/{cs}")
            if resp.status_code == 200:
                fr = (resp.json().get("response") or {})
                # `response` is the string "unknown callsign" when not found.
                if isinstance(fr, dict):
                    route = fr.get("flightroute") or {}
                    airline = route.get("airline") or {}
                    result = {
                        "origin": _airport(route.get("origin")),
                        "midpoint": _airport(route.get("midpoint")),
                        "destination": _airport(route.get("destination")),
                        "airline": airline.get("name"),
                        "airline_icao": airline.get("icao"),
                        "airline_iata": airline.get("iata"),
                        "airline_country": airline.get("country"),
                        # adsbdb's airline.callsign is the R/T telephony ("SPEEDBIRD").
                        "airline_callsign": airline.get("callsign"),
                        "flight_iata": route.get("callsign_iata"),
                        "flight_icao": route.get("callsign_icao"),
                    }
    except Exception as exc:  # noqa: BLE001
        logger.debug("route lookup failed for %s: %s", cs, exc)

    _cache[cs] = (now, result)
    return result
