"""Receiver history endpoints, backed by the SQLite HistoryStore.

These are low-frequency pull endpoints (the panels poll them every ~30 s),
unlike the 1 Hz radar/stats SSE stream. Empty rollups simply return empty
collections so the frontend renders a graceful "collecting data" state.
"""

from fastapi import APIRouter, Query, Request

router = APIRouter(prefix="/api/history", tags=["history"])


def _store(request: Request):
    return getattr(request.app.state, "history", None)


@router.get("/hourly")
async def hourly(request: Request, hours: int = Query(48, ge=1, le=168)) -> dict:
    store = _store(request)
    rows = store.hourly(hours) if store else []
    return {"hours": hours, "buckets": rows}


@router.get("/summary")
async def summary(request: Request) -> dict:
    store = _store(request)
    if not store:
        empty = {"messages": 0, "peak_contacts": 0, "max_range_nm": 0, "unique_ac": 0}
        return {"today": empty, "yesterday": empty}
    return store.summary()


@router.get("/today")
async def today(request: Request, limit: int = Query(80, ge=1, le=300)) -> dict:
    store = _store(request)
    rows = store.seen_today(limit) if store else []
    return {"aircraft": rows}


@router.get("/airframes")
async def airframes(request: Request) -> dict:
    store = _store(request)
    if not store:
        return {"today": 0, "week": 0, "month": 0, "total": 0}
    return store.airframe_stats()


@router.get("/coverage")
async def coverage(request: Request) -> dict:
    store = _store(request)
    if not store:
        return {"today": [], "best": [], "uptime_pct": 100.0, "polls": 0, "failures": 0}
    return store.coverage()


@router.get("/diurnal")
async def diurnal(request: Request, weeks: int = Query(8, ge=1, le=52)) -> dict:
    store = _store(request)
    if not store:
        return {"weeks": weeks, "grid": []}
    return store.diurnal(weeks)


@router.get("/leaders")
async def leaders(request: Request, top: int = Query(12, ge=1, le=30)) -> dict:
    store = _store(request)
    if not store:
        empty = {"operators": [], "types": []}
        return {"week": empty, "month": empty}
    return store.leaders(top)


@router.get("/lifelist")
async def lifelist(request: Request, limit: int = Query(80, ge=1, le=400)) -> dict:
    store = _store(request)
    if not store:
        return {"total_types": 0, "total_airframes": 0, "types": []}
    return store.lifelist(limit)


@router.get("/aircraft/{hex}")
async def aircraft(request: Request, hex: str) -> dict:
    """This station's own sighting log for one airframe (days seen, callsigns)."""
    store = _store(request)
    if not store:
        return {
            "hex": hex,
            "days_seen": 0,
            "first_seen": None,
            "last_seen": None,
            "callsigns": [],
            "mil": False,
            "interesting": False,
        }
    return store.aircraft_history(hex)


@router.get("/records")
async def records(request: Request) -> dict:
    store = _store(request)
    if not store:
        return {"today": None, "alltime": None, "octants": []}
    return store.records()
