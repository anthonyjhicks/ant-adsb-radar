from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Upstream readsb-protobuf web endpoint that serves data/*.pb. Either the
    # readsb host's LAN address, or the service name when the backend joins
    # readsb's docker network.
    readsb_url: str = "http://readsb:8080"

    # How often to poll readsb (seconds). readsb itself refreshes ~1s.
    readsb_poll_interval: float = 1.0

    # How many nearest aircraft to surface in the "nearest" aggregate.
    nearest_count: int = 12

    # CORS origins allowed to hit the API / SSE stream.
    cors_origins: list[str] = ["*"]

    # Enrich aircraft with registration/type/operator from readsb's own db
    # (fetched once from READSB_URL/db/ at startup). Set false to disable.
    enrich: bool = True

    # Read-only Postgres URL of an optional personal flights database, used to
    # flag aircraft you have flown on (by registration) — see services/flown.py
    # for the tables it expects. Empty disables the feature.
    flights_db_url: str = ""

    # How often to refresh the flown-registration set (seconds).
    flown_refresh_interval: float = 3600.0

    # Where to permanently cache aircraft thumbnails (metadata + image bytes),
    # keyed by ICAO hex. Mounted as a docker volume so it survives rebuilds;
    # the first sighting downloads the photo, after which neither the
    # planespotters API nor its image CDN is hit again for that aircraft.
    photo_cache_dir: str = "/data/photos"

    # Hard ceiling on the on-disk photo cache (bytes). When a new photo would
    # push the directory over this, the least-recently-shown aircraft are
    # evicted down to ~90% of the cap. At ~25KB/photo, 1GiB holds ~40k aircraft
    # — comfortably above what a fixed-location feeder sees — so in practice
    # this just bounds pathological growth. 0 disables eviction (unbounded).
    photo_cache_max_bytes: int = 1_073_741_824

    # Where to cache airline logos (tiny PNGs from images.kiwi.com, keyed by
    # IATA code). There are only a few hundred airlines a feeder ever sees, so
    # this stays small and needs no eviction; a docker volume keeps the kiosk
    # working offline once an airline has been seen once.
    logo_cache_dir: str = "/data/logos"

    # Where to cache country flags (tiny PNGs from flagcdn.com, keyed by ISO
    # alpha-2). There are only ~250 of them, so this stays small and needs no
    # eviction; a docker volume keeps the flags rendering offline.
    flag_cache_dir: str = "/data/flags"

    # SQLite file holding the durable receiver history (hourly rollups, the
    # first-seen-today log, per-bearing coverage). On its own docker volume so
    # trends survive a redeploy. Empty disables history tracking.
    history_db_path: str = "/data/history/history.db"

    # JSON file holding the kiosk display config (currently the rotation order
    # of the views, set from /config). On its own docker volume so the order
    # survives a redeploy. Empty disables saving — the kiosk then always uses
    # its built-in default order.
    panel_config_path: str = "/data/config/panels.json"

    # JSON file holding the station settings (name, manual receiver position,
    # scope ranges, weather stations), set from /config. Shares the config
    # volume with the panel order. Empty disables saving — the kiosk then uses
    # the built-in defaults and readsb's own position.
    station_config_path: str = "/data/config/station.json"

    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
