from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix="/api/radar", tags=["radar"])


@router.get("/snapshot")
async def get_snapshot(request: Request):
    """Latest normalized radar snapshot (aircraft + receiver + aggregates)."""
    snapshot = request.app.state.cache.get("radar")
    if snapshot is None:
        raise HTTPException(status_code=503, detail="No radar data yet")
    return snapshot


@router.get("/stats")
async def get_stats(request: Request):
    """Latest readsb statistics periods."""
    stats = request.app.state.cache.get("stats")
    if stats is None:
        raise HTTPException(status_code=503, detail="No stats yet")
    return stats
