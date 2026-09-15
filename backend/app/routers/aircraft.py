"""Airframe-detail proxy (adsbdb.com), keyed by ICAO hex.

Complements the in-memory Mictronics enrichment (registration/type/operator)
with adsbdb's richer static airframe record: manufacturer, the *registered
owner* (often more accurate than the callsign-prefix operator), the owner's
country, and the operator flag code. Proxied server-side for a polite
User-Agent + caching; airframe data is effectively static, so results
(including "unknown") are cached for a long time.
"""

import logging
import time

import httpx
from fastapi import APIRouter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/aircraft", tags=["aircraft"])

_UA = "ant-adsb-radar/1.0 (+https://github.com/anthonyjhicks/ant-adsb-radar; ADS-B kiosk)"
_TTL = 7 * 24 * 3600  # airframe records barely change
_cache: dict[str, tuple[float, dict]] = {}

EMPTY = {
    "manufacturer": None,
    "type": None,
    "icao_type": None,
    "owner": None,
    "owner_country": None,
    "owner_country_iso": None,
    "flag_code": None,
    "photo": None,
}


@router.get("/{hex}")
async def get_aircraft(hex: str) -> dict:
    hexid = (hex or "").lstrip("~").strip().upper()
    if not hexid:
        return dict(EMPTY)

    now = time.time()
    hit = _cache.get(hexid)
    if hit and now - hit[0] < _TTL:
        return hit[1]

    result = dict(EMPTY)
    try:
        async with httpx.AsyncClient(timeout=8.0, headers={"User-Agent": _UA}) as client:
            resp = await client.get(f"https://api.adsbdb.com/v0/aircraft/{hexid}")
            if resp.status_code == 200:
                ac = (resp.json().get("response") or {})
                # `response` is the string "unknown aircraft" when not found.
                if isinstance(ac, dict):
                    a = ac.get("aircraft") or {}
                    result = {
                        "manufacturer": a.get("manufacturer") or None,
                        "type": a.get("type") or None,
                        "icao_type": a.get("icao_type") or None,
                        "owner": a.get("registered_owner") or None,
                        "owner_country": a.get("registered_owner_country_name") or None,
                        "owner_country_iso": a.get("registered_owner_country_iso_name") or None,
                        "flag_code": a.get("registered_owner_operator_flag_code") or None,
                        "photo": a.get("url_photo_thumbnail") or a.get("url_photo") or None,
                    }
    except Exception as exc:  # noqa: BLE001
        logger.debug("aircraft lookup failed for %s: %s", hexid, exc)

    _cache[hexid] = (now, result)
    return result
