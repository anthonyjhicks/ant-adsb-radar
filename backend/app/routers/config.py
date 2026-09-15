"""Kiosk configuration — durable and shared by every client.

Two documents, both edited at /config and both kept as JSON files on the
config docker volume:

  /panels   which views rotate, in what order, and for how long (PanelConfigStore)
  /station  the station's name, its position, scope ranges and weather
            stations (StationConfigStore)

Unlike the per-browser scope-layer toggles (localStorage), these belong to the
*installation*: the wall display and a phone should show the same station the
same way, and that has to survive a redeploy.

`hidden` and `dwell` are optional in the panels request body so an older client
(sending only `order`) keeps working and simply clears nothing.
"""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.services.panel_config import EMPTY, InvalidOrder
from app.services.station_config import InvalidStation, with_defaults

router = APIRouter(prefix="/api/config", tags=["config"])


class PanelOrder(BaseModel):
    order: list[str]
    hidden: list[str] = []
    # id -> milliseconds; only the views actually overridden.
    dwell: dict[str, float] = {}


@router.get("/panels")
async def get_panels(request: Request) -> dict:
    """The saved view order, hidden ids and dwell overrides. An empty order means "no
    preference" — the kiosk then uses its built-in default, so an unwritable
    config dir isn't an error for readers."""
    store = getattr(request.app.state, "panel_config", None)
    return store.get() if store else dict(EMPTY)


@router.put("/panels")
async def put_panels(request: Request, body: PanelOrder) -> dict:
    store = getattr(request.app.state, "panel_config", None)
    if store is None:
        raise HTTPException(status_code=503, detail="Config storage unavailable")
    try:
        return store.set_config(body.order, body.hidden, body.dwell)
    except InvalidOrder as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=503, detail=f"Could not save config: {exc}") from exc


class Station(BaseModel):
    """The full station document. A null optional means "back to the default"."""

    name: str | None = None
    lat: float | None = None
    lon: float | None = None
    show_coords: bool | None = None
    local_label: str | None = None
    local_nm: float | None = None
    home_nm: float | None = None
    metar_stations: list[str] | None = None


def _readsb_position(request: Request) -> dict:
    service = getattr(request.app.state, "service", None)
    return dict(getattr(service, "readsb_receiver", None) or {"lat": None, "lon": None})


@router.get("/station")
async def get_station(request: Request) -> dict:
    """The station settings with defaults filled in, plus `readsb`: the position
    readsb itself reports, so the editor can show what "automatic" resolves to."""
    store = getattr(request.app.state, "station_config", None)
    doc = store.get() if store else {**with_defaults({}), "updated_at": None}
    doc["readsb"] = _readsb_position(request)
    return doc


@router.put("/station")
async def put_station(request: Request, body: Station) -> dict:
    store = getattr(request.app.state, "station_config", None)
    if store is None:
        raise HTTPException(status_code=503, detail="Config storage unavailable")
    try:
        doc = store.set_config(body.model_dump())
    except InvalidStation as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=503, detail=f"Could not save config: {exc}") from exc
    doc["readsb"] = _readsb_position(request)
    return doc
