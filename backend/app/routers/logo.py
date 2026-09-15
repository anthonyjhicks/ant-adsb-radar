"""Airline-logo proxy + on-disk cache (images.kiwi.com), keyed by IATA code.

The Spotlight panel shows the operating airline's tail logo next to the
featured aircraft. kiwi.com serves clean transparent PNG logos by IATA code;
we proxy + cache them to disk so the kiosk keeps showing logos when offline and
never re-hits kiwi for an airline it has already seen.

Unlike the photo cache this needs no eviction: a fixed feeder sees at most a few
hundred airlines and each logo is a couple of KB. A negative result (no logo for
that code) is cached as a zero-byte marker so we don't retry every render.
"""

import logging
import re
from pathlib import Path

import httpx
from fastapi import APIRouter, Response
from fastapi.responses import FileResponse

from app.config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/logo", tags=["logo"])

_UA = "ant-adsb-radar/1.0 (+https://github.com/anthonyjhicks/ant-adsb-radar; ADS-B kiosk)"
_settings = get_settings()
_CACHE_DIR = Path(_settings.logo_cache_dir)
_IMMUTABLE = "public, max-age=31536000, immutable"
# IATA airline codes are 2 alphanumerics; validate before touching disk/network.
_IATA_RE = re.compile(r"^[A-Z0-9]{2}$")


def _path(iata: str) -> Path:
    return _CACHE_DIR / f"{iata}.png"


@router.get("/{iata}")
async def get_logo(iata: str) -> Response:
    code = (iata or "").strip().upper()
    if not _IATA_RE.match(code):
        return Response(status_code=404)

    path = _path(code)
    if path.exists():
        # Zero-byte file = cached "no logo" marker.
        if path.stat().st_size == 0:
            return Response(status_code=404)
        return FileResponse(path, media_type="image/png", headers={"Cache-Control": _IMMUTABLE})

    img_bytes: bytes | None = None
    try:
        async with httpx.AsyncClient(timeout=8.0, headers={"User-Agent": _UA}) as client:
            resp = await client.get(f"https://images.kiwi.com/airlines/128/{code}.png")
            # Persist only on a definitive answer, so a transient error doesn't
            # get baked in as a permanent "no logo".
            is_image = resp.headers.get("content-type", "").startswith("image/")
            if resp.status_code == 200 and is_image:
                img_bytes = resp.content
            elif resp.status_code == 404 or 300 <= resp.status_code < 400:
                # kiwi answers unknown codes with a 303 to a generic placeholder;
                # treat that (and a plain 404) as a cached "no logo" so we stop
                # re-hitting upstream. Transient 4xx/5xx fall through uncached.
                img_bytes = b""  # negative marker
    except Exception as exc:  # noqa: BLE001
        logger.debug("logo lookup failed for %s: %s", code, exc)
        return Response(status_code=404)

    if img_bytes is None:
        return Response(status_code=404)

    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path.write_bytes(img_bytes)
    if not img_bytes:
        return Response(status_code=404)
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": _IMMUTABLE})
