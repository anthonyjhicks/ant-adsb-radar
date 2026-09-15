"""Aircraft photo proxy + permanent on-disk cache (planespotters.net), keyed by ICAO hex.

planespotters requires a descriptive User-Agent (browsers can't set one, and it
rejects generic ones), so we proxy server-side. The first time an aircraft is
seen we fetch its metadata and download the thumbnail bytes to disk; after that
both the metadata and the image are served from our own disk, so neither the
planespotters API nor its image CDN is hit again — important for aircraft that
appear over and over (e.g. the approach stack of a nearby airport).

The cache is bounded by photo_cache_max_bytes: each file's mtime is bumped when
it's served, so when a new photo overflows the cap the least-recently-shown
aircraft are evicted first (LRU).
"""

import json
import logging
import os
from pathlib import Path

import httpx
from fastapi import APIRouter, Request, Response
from fastapi.responses import FileResponse

from app.config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/photo", tags=["photo"])

_UA = "ant-adsb-radar/1.0 (+https://github.com/anthonyjhicks/ant-adsb-radar; ADS-B kiosk)"

EMPTY = {"thumbnail": None, "link": None, "photographer": None}

_settings = get_settings()
_CACHE_DIR = Path(_settings.photo_cache_dir)
_MAX_BYTES = int(_settings.photo_cache_max_bytes)
# Browsers may keep the served image essentially forever: a given hex's cached
# thumbnail never changes under us.
_IMMUTABLE = "public, max-age=31536000, immutable"


def _meta_path(hexid: str) -> Path:
    return _CACHE_DIR / f"{hexid}.json"


def _img_path(hexid: str) -> Path:
    return _CACHE_DIR / f"{hexid}.img"


def _touch(hexid: str) -> None:
    """Bump mtime on a hex's files so LRU eviction treats it as recently used."""
    for path in (_img_path(hexid), _meta_path(hexid)):
        try:
            os.utime(path, None)
        except FileNotFoundError:
            pass


def _evict_if_needed() -> None:
    """Trim the cache to ~90% of the cap, dropping least-recently-shown aircraft."""
    if _MAX_BYTES <= 0:
        return
    try:
        entries = [(e.path, e.stat()) for e in os.scandir(_CACHE_DIR) if e.is_file()]
    except FileNotFoundError:
        return
    total = sum(st.st_size for _, st in entries)
    if total <= _MAX_BYTES:
        return
    # Group a hex's .img + .json so a pair is always evicted together (a lone
    # .json would point at a now-missing image). Order by each hex's newest
    # file mtime; the low-water mark avoids re-scanning on every later write.
    low_water = int(_MAX_BYTES * 0.9)
    by_stem: dict[str, list] = {}
    for path, st in entries:
        by_stem.setdefault(Path(path).stem, []).append((path, st))
    for files in sorted(by_stem.values(), key=lambda fs: max(st.st_mtime for _, st in fs)):
        if total <= low_water:
            break
        for path, st in files:
            try:
                os.remove(path)
                total -= st.st_size
            except FileNotFoundError:
                pass


def _read_meta(hexid: str) -> dict | None:
    """Return the cached public metadata for a hex, or None if not yet cached."""
    try:
        data = json.loads(_meta_path(hexid).read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return None
    return {k: data.get(k) for k in EMPTY}


def _write_meta(
    hexid: str, result: dict, img_bytes: bytes | None, content_type: str | None
) -> None:
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if img_bytes is not None:
        _img_path(hexid).write_bytes(img_bytes)
    data = dict(result)
    if content_type:
        data["content_type"] = content_type
    _meta_path(hexid).write_text(json.dumps(data))
    _evict_if_needed()


@router.get("/img/{hex}")
async def get_photo_image(hex: str) -> Response:
    hexid = hex.lstrip("~").upper()
    path = _img_path(hexid)
    if not path.exists():
        return Response(status_code=404)
    _touch(hexid)
    content_type = "image/jpeg"
    try:
        content_type = json.loads(_meta_path(hexid).read_text()).get("content_type") or content_type
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    return FileResponse(path, media_type=content_type, headers={"Cache-Control": _IMMUTABLE})


@router.get("/stats")
async def get_stats(request: Request) -> dict:
    """Cache effectiveness + on-disk footprint for the activity trends panel."""
    cached_aircraft = 0
    bytes_used = 0
    try:
        for e in os.scandir(_CACHE_DIR):
            if not e.is_file():
                continue
            bytes_used += e.stat().st_size
            if e.name.endswith(".img"):
                cached_aircraft += 1
    except FileNotFoundError:
        pass
    store = getattr(request.app.state, "history", None)
    counts = store.photo_stats() if store else {"hits": 0, "misses": 0}
    hits, misses = counts["hits"], counts["misses"]
    total = hits + misses
    return {
        "hits": hits,
        "misses": misses,
        "hit_rate": (hits / total) if total else None,
        "cached_aircraft": cached_aircraft,
        "bytes_used": bytes_used,
        "bytes_max": _MAX_BYTES,
    }


@router.get("/{hex}")
async def get_photo(hex: str, request: Request) -> dict:
    hexid = hex.lstrip("~").upper()
    store = getattr(request.app.state, "history", None)

    cached = _read_meta(hexid)
    if cached is not None:
        if store:
            store.bump_photo(True)
        _touch(hexid)
        return cached

    if store:
        store.bump_photo(False)

    result = dict(EMPTY)
    img_bytes: bytes | None = None
    content_type: str | None = None
    persist = False
    try:
        async with httpx.AsyncClient(timeout=8.0, headers={"User-Agent": _UA}) as client:
            resp = await client.get(f"https://api.planespotters.net/pub/photos/hex/{hexid}")
            # Only persist on a clean response, so a transient 429/5xx doesn't
            # permanently cache a bogus "no photo".
            if resp.status_code == 200:
                persist = True
                photos = resp.json().get("photos", [])
                if photos:
                    p = photos[0]
                    thumb = p.get("thumbnail_large") or p.get("thumbnail") or {}
                    src = thumb.get("src")
                    if src:
                        img = await client.get(src)
                        if img.status_code == 200:
                            img_bytes = img.content
                            content_type = img.headers.get("content-type", "image/jpeg")
                    result = {
                        # Served from our own disk (see /img/{hex}); the frontend
                        # turns this relative path into an absolute backend URL.
                        "thumbnail": f"/api/photo/img/{hexid}" if img_bytes else None,
                        "link": p.get("link"),
                        "photographer": p.get("photographer"),
                    }
    except Exception as exc:  # noqa: BLE001
        logger.debug("photo lookup failed for %s: %s", hexid, exc)
        return result

    if persist:
        _write_meta(hexid, result, img_bytes, content_type)
    return result
