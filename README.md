# Ant ADS-B Radar

A full-screen, air-traffic-control–style kiosk console for the aircraft your
own ADS-B receiver is tracking. Dark radar aesthetic, twenty auto-rotating
views, a durable history of everything the station has ever seen — built to
sit on a wall display, and viewable on a phone.

![Radar Scope](docs/screenshots/scope.jpg)

It reads the output of [Mictronics **readsb-protobuf**](https://github.com/Mictronics/readsb-protobuf),
polling its protobuf feed once a second, enriches every contact (registration,
type, operator, route, photo), streams the result to the kiosk over Server-Sent
Events, and rolls it all up into an on-disk SQLite history so the trends outlive
a restart. Everything runs on your own network; the only outbound calls are to
public aviation APIs for photos, routes, logos and weather, and those are cached.

**Full reference with a screenshot of every view: [docs/DOCUMENTATION.md](docs/DOCUMENTATION.md).**

## What you need

This is a display for an ADS-B receiver you already run; it doesn't decode
radio itself.

- **An ADS-B receiver running [readsb-protobuf](https://github.com/Mictronics/readsb-protobuf)** —
  typically a Raspberry Pi with an RTL-SDR dongle and a 1090 MHz antenna,
  running the Mictronics image or container. Its web server (port 8080)
  publishes the aircraft list, the receiver position and the decoder
  statistics as protobuf files (`data/aircraft.pb`, `data/receiver.pb`,
  `data/stats.pb`) and the aircraft database under `db/`; this app reads
  exactly those. Plain readsb, dump1090 and tar1090 builds serve
  `aircraft.json` instead and are **not** supported.
- **Ideally on your local network.** The backend polls the receiver once a
  second, so it wants a LAN hop rather than the internet. Running the kiosk on
  the receiver host itself works well; a Raspberry Pi 4 copes.
- **Docker + Compose** (or Python 3.12 and Node 22 to run it bare) on the
  machine that serves the kiosk, and **a screen** to put it on — a wall
  display, a spare monitor, a phone.
- **Internet access is optional.** It's used only for aircraft photos, routes,
  airline logos, flags and METARs, all cached; without it the kiosk still
  shows the traffic.

## The views

The kiosk cycles through these (← → to switch, space to pause, number keys to
jump). Which ones, in what order and for how long is set on the built-in
[configuration page](#configuration).

| | |
|---|---|
| ![Local scope](docs/screenshots/local.jpg) | ![Closest Aircraft](docs/screenshots/spotlight.jpg) |
| ![Weather & Runways](docs/screenshots/metar.jpg) | ![Coverage & Health](docs/screenshots/coverage.jpg) |

**Scopes** — a PPI radar scope centred on the receiver (range rings that
auto-fit to traffic, sweep, coverage rose, a faint map, airspace rings, track
trails, velocity leaders, altitude-coloured data tags); the same scope locked to
a wide fixed range over your local terminal area and to a tight range right
over the station; and an orbiting 3D view of the traffic column.

**Live tactical** — a controller's flight-strip board; a deep-dive on the
closest aircraft (owner, model, photo, route with live progress and ETA,
closest-approach estimate, how often this station has seen the airframe); a
slideshow of spotter photos of what's overhead; military, interesting and
unusual airframes; fastest / highest / lowest / furthest; and an **Emergency
Watch** that takes the screen the moment something squawks 7500/7600/7700 and
holds it until the emergency clears.

**Live instruments** — altitude profile of the approach and departure stack,
signal-vs-range link budget, a heading rose of the airway flows, and operator
and type breakdowns (now / 7 days / 30 days).

**Durable history** — today-vs-yesterday activity trends with a new-airframes
counter, the day's first-seen log, and a "Type-Dex" of every aircraft type ever
logged, rarest first.

**Environment** — sun position and day/night over the station, and an animated
sky drawn from the nearest METAR (cloud decks at their reported bases,
precipitation, fog, wind, lightning) beside a runway card per airport showing
the wind-favoured ends, approach chevrons and head/crosswind components.

**Receiver stats** — per-bearing coverage today vs all-time with range records,
uptime, and readsb's own signal and decoding statistics.

Aircraft you've **flown on**, if you connect an optional personal flights
database, are circled in magenta with a row of flags for the countries you've
flown them to.

## How it works

```
readsb (:8080)                backend (FastAPI :8001)            frontend (:3000)
  data/aircraft.pb  ──poll──▶  decode protobuf + enrich  ──SSE──▶  SvelteKit kiosk
  data/receiver.pb             aggregate (nearest, stats)  radar   (auto-rotating views)
  data/stats.pb                cache + publish + history   stats
  db/*.json                    proxy + cache photos/routes/METAR
```

- **Backend** — FastAPI + Pydantic v2 + httpx. Decodes the three readsb `.pb`
  endpoints via the vendored `readsb.proto`, enriches each aircraft from
  readsb's own Mictronics database (no external dataset), computes bearings,
  aggregates and emergencies, publishes `radar` + `stats` events over SSE, and
  keeps the SQLite history and the on-disk photo/logo/flag caches on Docker
  volumes.
- **Frontend** — SvelteKit (Svelte 5 runes) + Tailwind v4, SSR-hydrated then
  live via SSE. A fixed 1920×1080 stage that renders 1:1 on the wall display and
  scales to fit smaller screens.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the file-by-file tour.

## Quick start

With a readsb-protobuf host reachable over HTTP (it publishes `:8080`) and
Docker + Compose on the machine that will serve the kiosk (the readsb host
itself is fine):

```bash
git clone https://github.com/anthonyjhicks/ant-adsb-radar.git
cd ant-adsb-radar
cp .env.example .env      # set READSB_URL, PUBLIC_API_URL, ORIGIN for your hosts
docker compose up -d --build
```

Then open `http://<host>:3000` on the display, and `http://<host>:3000/config`
to name the station, check the receiver position, label the local scope and
pick the weather airports. Ports: frontend **3000**, backend **8001** (readsb
stays on 8080).

Deep-link a single view for a fixed panel: `…/?view=local&paused=1`.

## Configuration

![Configuration page](docs/screenshots/config.jpg)

**`/config`** (linked bottom-right of every view) holds two things, both stored
on the receiver rather than in the browser, so every screen showing the station
agrees and they survive a redeploy:

- **Station** — the name shown top-left; the receiver position (normally what
  readsb reports; set it by hand if readsb has none, or to show a deliberately
  rounded location — range and bearing to every contact are then computed from
  what you enter); whether to print the coordinates in the header (off by
  default); the local scopes' label and ranges; and the airports on the Weather
  & Runways view.
- **Rotation** — drag the views into order, hide the ones you don't want, and
  set how many seconds each stays up.

Scope layers (map, airports, airspace, rings, coverage, sweep, trails, vectors,
labels) are toggled with the footer chips on any scope view and remembered per
browser.

### Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `READSB_URL` | `http://readsb:8080` | The readsb-protobuf host. Its LAN address, or the service name if the backend joins readsb's Docker network. |
| `PUBLIC_API_URL` | `http://localhost:8001` | Backend URL as the **browser** reaches it (baked into the frontend build). |
| `ORIGIN` | `http://localhost:3000` | Frontend origin (adapter-node). |
| `FRONTEND_PORT`, `BACKEND_PORT` | `3000`, `8001` | Host ports Compose publishes. Change both, and the two URLs above, to run a second instance beside another. |
| `FLIGHTS_DB_URL` | *(empty)* | Optional read-only Postgres URL of a personal flights database, to flag aircraft you've flown on. |
| `READSB_POLL_INTERVAL`, `NEAREST_COUNT`, `ENRICH`, cache and data paths | see [`backend/app/config.py`](backend/app/config.py) | Tuning; the defaults are right for Compose. |

### Adapting it to your region

The app was built under the London terminal area, and a few things are data
files rather than settings. To move it elsewhere, edit:

- [`frontend/src/lib/data/airports.ts`](frontend/src/lib/data/airports.ts) — the
  airport markers drawn on the scopes.
- [`frontend/src/lib/data/airspace.ts`](frontend/src/lib/data/airspace.ts) — the
  control-zone rings.
- [`frontend/src/lib/data/runways.ts`](frontend/src/lib/data/runways.ts) and the
  station catalogue at the top of
  [`backend/app/routers/metar.py`](backend/app/routers/metar.py) — runway
  layouts and headings for the Weather & Runways cards. Any airport can be
  listed at `/config`; one without a layout still gets its weather, just no
  runway diagram.
- [`frontend/src/lib/data/`](frontend/src/lib/data/) `coastline.json`,
  `land.json`, `rivers.json` — the map underlay, plain `[lon, lat]` polylines
  and polygons (currently the British Isles and the near continent). Extract
  your own area from a source such as Natural Earth and keep the same shape.

## Privacy

The kiosk doesn't phone home and has no accounts or telemetry. Things worth
knowing before you point a camera at the wall:

- The receiver's coordinates are **not** shown unless you switch them on at
  `/config`. The tight "Local · Home" scope still centres on the station, so a
  photo of it with the map layer on gives away roughly where you are.
- Setting a manual position rounded to two decimals (about a kilometre)
  keeps the display consistent while blurring the exact site.
- Outbound requests go only to planespotters.net (photos), adsbdb.com (routes
  and airframe records), images.kiwi.com (airline logos), flagcdn.com (flags)
  and aviationweather.gov (METAR), all proxied and cached by the backend with a
  User-Agent that names this project. Nothing about your receiver is sent.

## Develop

```bash
# Backend — point READSB_URL at your readsb host
cd backend && uv sync --extra dev
READSB_URL=http://<readsb-host>:8080 uv run uvicorn app.main:app --reload --port 8001
uv run ruff check app tests && uv run pytest

# Frontend
cd frontend && npm install
npm run dev            # http://localhost:5173, talks to the backend on :8001
npm run check && npm test
```

`frontend/.env` sets `PUBLIC_API_URL` for the browser (defaults to
`http://localhost:8001`). Regenerate the protobuf bindings after editing
`backend/app/proto/readsb.proto` with `backend/scripts/gen_proto.sh`.

## Deploy

`docker compose up -d --build` on the host is all it takes. To push from a
workstation instead:

```bash
DEPLOY_HOST=user@radar-host ./deploy.sh --deploy   # rsync + compose build/up
./deploy.sh --status | --logs-be | --verify
```

The `.env` on the host is never overwritten by a deploy. There's also an
optional GitHub Actions workflow
([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)) for a
self-hosted runner, enabled by setting the `DEPLOY_HOST` repository variable;
[`ci.yml`](.github/workflows/ci.yml) lints, type-checks and tests every push.

## Ideas

[IDEAS.md](IDEAS.md) is the backlog. Pull requests welcome.

## License

[MIT](LICENSE).
