import os

from fastapi import APIRouter, Request

router = APIRouter(tags=["health"])

GIT_COMMIT = os.environ.get("GIT_COMMIT", "unknown")


@router.get("/api/health")
async def health_check(request: Request):
    service = request.app.state.service
    try:
        reachable = await service.health_check()
    except Exception:
        reachable = False
    have_data = request.app.state.cache.get("radar") is not None
    return {
        "status": "healthy" if (reachable and have_data) else "degraded",
        "version": GIT_COMMIT,
        "readsb_reachable": reachable,
        "have_data": have_data,
    }
