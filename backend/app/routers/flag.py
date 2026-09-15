"""Country-flag proxy + on-disk cache (flagcdn.com), keyed by ISO alpha-2 code.

The Flown card shows a flag for each country the user has flown that airframe
to. Flag emoji don't render on every kiosk display, so we serve real images:
flagcdn's tiny PNGs, proxied + cached to disk so the kiosk keeps showing flags
when offline and never re-hits flagcdn for a country it has already seen.

Like the logo cache this needs no eviction — there are only ~250 flags and each
is a couple of KB. A negative result is cached as a zero-byte marker.
"""

import logging
import re
from pathlib import Path

import httpx
from fastapi import APIRouter, Response
from fastapi.responses import FileResponse

from app.config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/flag", tags=["flag"])

_UA = "ant-adsb-radar/1.0 (+https://github.com/anthonyjhicks/ant-adsb-radar; ADS-B kiosk)"
_settings = get_settings()
_CACHE_DIR = Path(_settings.flag_cache_dir)
_IMMUTABLE = "public, max-age=31536000, immutable"
# ISO 3166-1 alpha-2; validate before touching disk/network.
_ISO2_RE = re.compile(r"^[A-Z]{2}$")
# Rendered ~20px wide on the 1920×1080 stage; 160px keeps it crisp at ~1KB.
_WIDTH = 160


def _path(code: str) -> Path:
    return _CACHE_DIR / f"{code}.png"


@router.get("/{iso2}")
async def get_flag(iso2: str) -> Response:
    code = (iso2 or "").strip().upper()
    if not _ISO2_RE.match(code):
        return Response(status_code=404)

    path = _path(code)
    if path.exists():
        # Zero-byte file = cached "no flag" marker.
        if path.stat().st_size == 0:
            return Response(status_code=404)
        return FileResponse(path, media_type="image/png", headers={"Cache-Control": _IMMUTABLE})

    img_bytes: bytes | None = None
    try:
        async with httpx.AsyncClient(timeout=8.0, headers={"User-Agent": _UA}) as client:
            resp = await client.get(f"https://flagcdn.com/w{_WIDTH}/{code.lower()}.png")
            # Persist only on a definitive answer, so a transient error doesn't
            # get baked in as a permanent "no flag".
            is_image = resp.headers.get("content-type", "").startswith("image/")
            if resp.status_code == 200 and is_image:
                img_bytes = resp.content
            elif resp.status_code == 404:
                img_bytes = b""  # negative marker
    except Exception as exc:  # noqa: BLE001
        logger.debug("flag lookup failed for %s: %s", code, exc)
        return Response(status_code=404)

    if img_bytes is None:
        return Response(status_code=404)

    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path.write_bytes(img_bytes)
    if not img_bytes:
        return Response(status_code=404)
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": _IMMUTABLE})
