import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import (
    aircraft,
    config,
    flag,
    health,
    history,
    logo,
    metar,
    photo,
    radar,
    route,
    sse,
)
from app.services.aircraft_db import AircraftDB
from app.services.cache import TTLCache
from app.services.flown import FlownRegistry
from app.services.history import HistoryStore
from app.services.panel_config import PanelConfigStore
from app.services.readsb import ReadsbService
from app.services.station_config import StationConfigStore
from app.sse.collector import run_collector
from app.sse.manager import SSEManager

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def _refresh_flown(flown: FlownRegistry, interval: float) -> None:
    while True:
        await asyncio.sleep(interval)
        await flown.refresh()


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()

    app.state.sse_manager = SSEManager()
    # Keep cached data valid for a few poll cycles so a brief readsb hiccup
    # doesn't blank the console.
    app.state.cache = TTLCache(default_ttl=max(5, int(settings.readsb_poll_interval * 5)))

    db = None
    if settings.enrich:
        try:
            db = await AircraftDB.from_readsb(settings.readsb_url)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Aircraft DB load failed (continuing without enrichment): %s", exc)

    # Flown-aircraft registry (optional personal flights DB), refreshed periodically.
    flown = FlownRegistry(settings.flights_db_url)
    if flown.enabled:
        await flown.refresh()
        app.state.flown_task = asyncio.create_task(
            _refresh_flown(flown, settings.flown_refresh_interval)
        )

    # Durable station settings (name, manual receiver position, scope ranges,
    # weather stations), set from the /config page. The service reads the
    # location override from it on every poll.
    station_config = None
    if settings.station_config_path:
        try:
            station_config = StationConfigStore(settings.station_config_path)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Station config init failed (using defaults): %s", exc)
    app.state.station_config = station_config

    app.state.service = ReadsbService(
        base_url=settings.readsb_url,
        nearest_count=settings.nearest_count,
        db=db,
        flown=flown,
        station=station_config,
    )

    # Durable receiver history (hourly rollups, first-seen log, coverage).
    history_store = None
    if settings.history_db_path:
        try:
            history_store = HistoryStore(settings.history_db_path)
        except Exception as exc:  # noqa: BLE001
            logger.warning("History store init failed (continuing without it): %s", exc)
    app.state.history = history_store

    # Durable kiosk display config (view order), set from the /config page.
    panel_config = None
    if settings.panel_config_path:
        try:
            panel_config = PanelConfigStore(settings.panel_config_path)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Panel config init failed (kiosk will use default order): %s", exc)
    app.state.panel_config = panel_config

    logger.info(
        "Polling readsb at %s every %ss", settings.readsb_url, settings.readsb_poll_interval
    )
    app.state.collector_task = asyncio.create_task(
        run_collector(
            app.state.service,
            app.state.cache,
            app.state.sse_manager,
            settings.readsb_poll_interval,
            history_store,
        )
    )

    yield

    app.state.collector_task.cancel()
    flown_task = getattr(app.state, "flown_task", None)
    if flown_task:
        flown_task.cancel()
    try:
        await app.state.collector_task
    except asyncio.CancelledError:
        pass
    await app.state.service.close()
    if app.state.history:
        app.state.history.close()


app = FastAPI(title="ant-adsb-radar", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(radar.router)
app.include_router(photo.router)
app.include_router(route.router)
app.include_router(aircraft.router)
app.include_router(logo.router)
app.include_router(flag.router)
app.include_router(metar.router)
app.include_router(history.router)
app.include_router(config.router)
app.include_router(sse.router)
