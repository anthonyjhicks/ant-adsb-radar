# Ant ADS-B Radar — ideas & backlog

Candidate views and enhancements, grouped roughly by effort. Check one off
when it lands. The shipped views are listed in the README and documented one
by one in [docs/DOCUMENTATION.md](docs/DOCUMENTATION.md).

Each rotating view is a `frontend/src/lib/components/panels/Panel*.svelte`
registered in the `PANELS` array in `frontend/src/lib/panels.ts` (see
ARCHITECTURE.md). Its place in that array is its default slot in the rotation;
users reorder, hide and time them at `/config`. Every view is deep-linkable
with `?view=<id>`.

## Easy — built from the current snapshot, no new backend state

- [ ] **Arrivals / Departures board** — split traffic into inbound (descending,
  slowing, near a configured airport) vs outbound (climbing), airport
  flip-board style. Altitude trend and the airport list exist; add
  nearest-airport matching.
- [ ] **CPA / closest-approach alerts** — extrapolate velocity vectors to flag
  the aircraft about to pass closest to the station, or two aircraft
  converging. The Closest Aircraft view already computes CPA for one contact.
- [ ] Brighter airport labels on the scope, and a few more regional fields.

## Medium — needs the backend to retain more history

- [ ] **Traffic timeline** — contacts-in-range and message rate over the last
  hour with a busiest-time marker (a ring buffer of per-poll counts).

## Bigger — new subsystems

- [ ] **Notification push** — Telegram / Discord / ntfy webhook when an
  emergency squawk, a flown-on registration, or a rare type appears overhead.
- [ ] **Multi-receiver aggregation** — merge a second feeder for wider
  coverage. The biggest lift: it touches the single-upstream assumption in the
  collector.
- [ ] **Region packs** — ship the airport markers, airspace rings, runway
  layouts and map extract for an area as one data bundle selectable at
  `/config`, instead of editing the data files.
- [ ] **Container images** — publish backend and frontend images from CI so a
  deploy is a `docker compose pull` rather than a build on the host.
- [ ] **Offline photos** — a type-based silhouette already stands in when no
  photo is cached; proxying the full-size photo bytes too would make the
  Spotter Photos view work with no internet at all.

## Done

- [x] Track trails, velocity leaders, toggleable scope layers.
- [x] Sunrise / sunset & day-night (`PanelDaylight`, NOAA solar equations).
- [x] First-seen log and new-airframes counter (SQLite `seen`).
- [x] Military / interesting highlighting from the Mictronics db flags.
- [x] Flight routes (adsbdb) on the scope, strips and cards; great-circle line.
- [x] Interesting Airframes, Movers & Extremes, Fleet & Operators (now / 7d / 30d).
- [x] Activity Trends (SQLite `hourly`), Coverage & Health with range records.
- [x] MLAT vs ADS-B position source badges.
- [x] Emergency Watch takeover with klaxon and screen flash.
- [x] Spotter Photos slideshow with a permanent on-disk photo cache.
- [x] Signal vs Range, Heading Rose, Altitude Profile (band / trend lens), Type-Dex.
- [x] Weather & Runways: animated METAR sky + runway cards with wind components.
- [x] CTR/TMA airspace rings.
- [x] Station settings at `/config`: name, receiver position override, scope
  ranges, weather airports.
- [x] CI: lint, type-check and tests on every push.

**Tried and removed:** Sky mix (wake/position-source donuts), Sky density
(session-accumulated position heatmap) and Traffic rhythm (weekday × hour
diurnal heatmap) were built and dropped from the rotation — not interesting
enough to earn a dwell slot. Don't re-add them.
