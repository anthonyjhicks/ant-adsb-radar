# Ant ADS-B Radar — Architecture

An ATC-console kiosk over Mictronics readsb-protobuf — it needs an ADS-B
receiver running that build, ideally on the local network. A single upstream
data source (the readsb host), so the design is a straight poll → decode →
enrich → SSE pipeline.

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | FastAPI + Pydantic v2 + httpx + protobuf, uv |
| Frontend | SvelteKit + Svelte 5 (runes) + Tailwind v4 + shadcn-svelte (bits-ui) |
| Real-time | Server-Sent Events (SSE) |
| Containers | Docker Compose |

## Data source: readsb protobuf

This readsb build serves **protobuf only** (the dump1090 `aircraft.json` path
404s). Endpoints on the readsb host (`READSB_URL`, default `http://readsb:8080`):

| Path | Message | Notes |
|------|---------|-------|
| `data/aircraft.pb` | `AircraftsUpdate` | live aircraft + `now` + cumulative `messages` |
| `data/receiver.pb` | `Receiver` | version + **receiver lat/lon** (centers the scope) |
| `data/stats.pb` | `Statistics` | period stats + `polar_range` coverage map |

The schema is vendored at `backend/app/proto/readsb.proto`; generated bindings
(`readsb_pb2.py`) are committed. Regenerate with `backend/scripts/gen_proto.sh`
(uses grpcio-tools via uvx — no system protoc needed). Runtime only needs the
`protobuf` package.

### Field notes learned from live decoding
- `addr` → 6-hex ICAO; non-ICAO `addr_type` is prefixed `~`.
- `squawk` is packed so its **hex** form is the 4-digit Mode A code
  (`f"{squawk:04X}"` → `"7000"`); 7500/7600/7700 ⇒ emergency.
- `category` hex is the emitter code (`0xA3` → `"A3"` → "Large").
- `distance` is precomputed metres-to-site; bearing is derived great-circle.
- `seen` is an absolute epoch-millisecond timestamp ⇒ age = `now − seen/1000`.
- Period `messages`/duration spans days, so the **instantaneous** rate is
  computed in the collector from the inter-poll delta of cumulative `messages`.
- `polar_range` keys are bucket indices (72 buckets = 5° resolution); values are
  metres (÷1852 → nm).

## Backend (`backend/app`)

```
config.py              # Settings: readsb_url, poll interval, nearest_count, cache + config paths
proto/readsb.proto     # vendored schema  +  readsb_pb2.py (committed, generated)
services/base.py       # HTTPService (httpx + tenacity); _get_bytes() for protobuf
services/readsb.py     # ReadsbService: decode 3 .pb -> enrich -> aggregate
services/aircraft_db.py # AircraftDB: registration/type/operator from readsb /db/
services/cache.py      # TTLCache
services/history.py    # HistoryStore: durable SQLite rollups (hourly / seen / coverage / counters)
services/flown.py      # FlownRegistry: registrations you've flown (optional external flights DB)
services/panel_config.py # PanelConfigStore: durable view order / hidden / dwell (JSON file, atomic writes)
services/station_config.py # StationConfigStore: name, receiver position override, scope ranges,
                       #   weather airports (JSON file, atomic writes, mtime-cached for the poll loop)
models/radar.py        # Pydantic: Aircraft, ReceiverInfo, RadarSnapshot, RadarStats
sse/manager.py         # SSEManager: pub/sub + last-event replay (shared)
sse/collector.py       # poll -> cache -> publish 'radar' + 'stats'; derives msg/s; folds into history
routers/radar.py       # GET /api/radar/snapshot, /api/radar/stats
routers/history.py     # GET /api/history/{hourly,summary,today,airframes,diurnal,leaders,lifelist,records,coverage,aircraft/{hex}}
routers/photo.py       # planespotters photo proxy + on-disk LRU cache + /stats (hit rate)
routers/route.py       # adsbdb route proxy (origin -> [midpoint] -> destination, airline detail), cached
routers/aircraft.py    # adsbdb airframe proxy (owner/manufacturer/country/flag by hex), cached
routers/logo.py        # airline tail-logo proxy (kiwi.com by IATA) + on-disk cache
routers/metar.py       # METAR proxy: decodes the raw ob (present weather, vis, cloud layers),
                       #   active runways + head/crosswind per end; batch GET ?ids=A,B,C
routers/sse.py         # GET /api/events (shared)
routers/config.py      # GET/PUT /api/config/panels (view order) + /api/config/station (station settings)
routers/health.py      # GET /api/health
main.py                # lifespan: build service + cache + sse + history + panel/station config, start collector
```

Backend unit tests live in `backend/tests` (pytest; `uv run --extra dev pytest`).
They cover the pure decoding/maths (METAR parsing, runway wind components) and
the station-config validation and store.

**Receiver position.** `ReadsbService` centres everything on readsb's own site
position from `receiver.pb`. If a manual position is saved at `/config`
(`StationConfigStore.location()`, read every poll), it takes over: the snapshot's
`receiver.lat/lon` become the override (`receiver.source = "manual"`), and each
contact's `distance_nm` and `bearing` are recomputed from it with the haversine
formula rather than taken from readsb's site-relative `distance`, so range rings,
nearest-first ordering and the history's coverage lobes all agree with the
centre of the scope. Without an override, readsb's precomputed distance is used
and the same fallback only fills in when readsb reports none.

`ReadsbService.fetch_status()` returns `{"snapshot": …, "stats": …}`. The
collector caches both and publishes them every `READSB_POLL_INTERVAL` (1s). The
`SSEManager` replays the last event to each new subscriber, so a freshly-loaded
kiosk paints immediately.

## Frontend (`frontend/src`)

```
lib/api/client.ts        # apiGet + getSSEUrl (shared)
lib/api/radar.ts         # getSnapshot(), getStats()
lib/api/history.ts       # getSummary/getHourly/getAirframeStats/getLeaders/getLifelist/getRecords/getCoverage/getAircraftHistory
lib/api/config.ts        # panel config + station config (types, defaults, bounds, get/save)
lib/api/{photo,route,aircraft,logo,metar}.ts # planespotters photos, adsbdb routes + airframe detail, airline logos, METAR
lib/stores/sse.svelte.ts # SSEConnection (shared) — exact + prefix handlers
lib/stores/radar.svelte.ts # RadarStore: snapshot + stats + rolling rate history + per-hex trails
lib/types/radar.ts       # TS mirror of the Pydantic models
lib/utils/geo.ts         # polar projection, leader lines, altitude colors, rings, great-circle/haversine, route progress + ETA, CPA-to-station
lib/utils/solar.ts       # NOAA sun position (shared by Daylight and the weather sky)
lib/utils/weather.ts     # METAR -> sky-scene conditions (decks, precip, fog, wind) + summaries/formatters
lib/data/runways.ts      # runway layouts per airport + north-up schematic geometry
lib/panels.ts            # the view registry (id/name/component/accent/dwell/group) in default
                          #   order, + applyOrder(): reconcile a saved order with it,
                          #   visiblePanels(): drop the hidden ids,
                          #   applyDwell(): apply per-view dwell overrides,
                          #   applyStation(): scope ranges/label + weather airports from
                          #     the station settings,
                          #   withoutEmergency(): the emergency view is a takeover,
                          #     not a rotation member
lib/components/ui/*       # shadcn-svelte primitives (shared)
lib/components/panels/    # one Panel*.svelte per rotating view (see README "Views"):
                          #   scopes (PanelScope), live tactical (Strips, Spotlight, Movers,
                          #   Interesting, Watch, Photos), live instruments (Altitude [band/trend
                          #   toggle], Signal, TrackRose, Fleet [now/7d/30d toggle]),
                          #   durable history (Trends, NewToday, Lifelist, Coverage
                          #   [+range records]), Daylight, Stats
                          #   + RunwayCard.svelte (one airport's runway schematic + wind)
lib/components/weather/   # WeatherScene.svelte + scene.ts: the canvas sky over the
                          #   station (Weather & Runways) — cloud decks, precipitation,
                          #   fog, lightning, drifting with the wind, lit by the real sun
routes/+layout.svelte    # connect SSE
routes/+page.ts          # SSR load: snapshot + stats + saved order/hidden/dwell + station
routes/+page.svelte      # kiosk rotator (rotate, keys, UTC clock, ?view= deep-link,
                          #   emergency klaxon + takeover/hold, station name/coords in the header)
routes/config/+page.svelte # configuration: the station (name, position, scope ranges,
                          #   weather airports) and the rotation (drag/nudge the order,
                          #   hide views, set dwell seconds); both saved to the backend
routes/above/+page.svelte # ceiling-projector view: tracks of low arrivals glide across a
                          #   black screen in their true direction (see the file header)
```

Data flow per page: SSR `load` fetches a snapshot for instant first paint →
`radarStore.hydrate()` seeds the store → SSE `radar`/`stats` events take over.
The scope auto-centers on `receiver.lat/lon` and auto-fits its outer range ring
to the 95th-percentile contact distance (capped, contacts beyond are clipped).

## Durable history (`services/history.py`)

readsb's own period stats are coarse and reset with the daemon, so the backend
keeps its own **SQLite** rollup on a Docker volume that survives redeploys. The
collector calls `record()` once per successful poll (off the event loop, via a
thread executor) and `record_gap()` when a poll fails. Four tables:

| Table      | Grain                    | Feeds |
|------------|--------------------------|-------|
| `hourly`   | per-hour message volume, unique aircraft, peak contacts, max range, poll/fail counts | Activity Trends, Coverage uptime |
| `seen`     | one row per (airframe, day) with enrichment | First Seen Today, new-airframes counter, Operator League, Type-Dex |
| `coverage` | best range per bearing per day | Coverage & Health, Range Records |
| `counters` | durable name→value (e.g. photo cache hits/misses) | Activity Trends photo hit rate |

`routers/history.py` exposes low-frequency pull endpoints (panels poll ~60s) —
empty rollups return empty collections so the frontend renders a graceful
"collecting data" state:

- `/summary`, `/hourly`, `/today` — today-vs-yesterday, hourly buckets, first-seen log.
- `/airframes` — new airframes (first-ever sightings) today / this week / this month vs all-time.
- `/diurnal` — weekday × hour-of-day traffic-intensity grid.
- `/leaders` — most-seen operators & types over 7d / 30d (distinct airframes).
- `/lifelist` — every type ever logged with rarity (distinct days seen), rarest first.
- `/records` — furthest contact today / all-time + per-octant bests.
- `/coverage` — per-bearing range today vs all-time + 24h uptime.

The photo proxy (`routers/photo.py`) caches planespotters metadata + thumbnails
to disk (LRU-bounded) and records hit/miss counters, so repeat aircraft never
re-hit the upstream API or CDN.

`routers/config.py` + `services/panel_config.py` hold the kiosk **display
config** — which views rotate, in what order, and for how long, edited at
`/config`. It's a
JSON file on its own docker volume (`PANEL_CONFIG_PATH`), written atomically, so
it's shared by every screen showing the station and survives a redeploy.
`services/station_config.py` keeps the **station settings** (`STATION_CONFIG_PATH`,
same volume, same atomic writes) the same way: sparse on disk, defaults filled
in on read, one bad key dropped rather than the whole file.
Deliberately, the backend doesn't know which panel ids exist: it validates the
shape of what it stores — `order` and `hidden` as unique slug-like id lists,
`dwell` as an id→milliseconds map inside fixed bounds — and keeps it verbatim,
while `lib/panels.ts` reconciles it against the registry on load, so views added
or removed in code need no backend change and no file migration. Both `hidden`
and `dwell` are sparse for the same reason: hiding is an opt-out list and only
overridden dwells are stored, so a view added in code later defaults to visible
at the dwell its code specifies, rather than being swallowed or frozen by a
stale config.

## Deployment

`docker-compose.yml`: `backend` (uvicorn :8001) + `frontend` (adapter-node :3000),
run with `docker compose up -d --build` on the host, or pushed from a workstation
via `deploy.sh` (rsync + compose, `DEPLOY_HOST=user@host`), or by the optional
GitHub Actions deploy workflow on a self-hosted runner. The backend reaches readsb
through its published `:8080`; the browser reaches the backend via `PUBLIC_API_URL`
(build arg). SSR uses `INTERNAL_API_URL=http://backend:8001`.
