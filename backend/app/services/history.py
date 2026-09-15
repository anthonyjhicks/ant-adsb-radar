"""HistoryStore — small SQLite-backed rollup of what the receiver has seen.

readsb's own period stats span days but are coarse and reset with the daemon.
This keeps a durable, queryable history on disk (a docker volume) so the kiosk
can show trends that outlive a redeploy:

  - hourly        : per-hour message volume, unique aircraft, peak contacts,
                    max range, and receiver health (polls vs failures).
  - seen          : first-seen-today log, one row per (aircraft, day).
  - coverage      : best range achieved per bearing, per day.

The collector calls record() once per successful poll (off the event loop, via a
thread executor) and record_gap() when a poll fails. Routers read the query
helpers. All access is guarded by a lock since writes happen on a worker thread
and reads on the request thread.
"""

import logging
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

HOUR = 3600
DAY = 86400


def _hour(ts: float) -> int:
    return int(ts // HOUR) * HOUR


def _day(ts: float) -> int:
    return int(ts // DAY) * DAY


class HistoryStore:
    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        self._lock = threading.Lock()
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(db_path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA journal_mode=WAL")
        self._init_schema()

        # In-memory accumulators for the hour currently being written, so we
        # don't recompute unique counts from disk on every 1 Hz tick.
        self._hour: int | None = None
        self._hexes: set[str] = set()
        self._messages = 0
        self._peak = 0
        self._max_range = 0.0
        self._samples = 0
        self._polls = 0
        self._failures = 0
        self._prev_total: int | None = None

    def _init_schema(self) -> None:
        with self._db:
            self._db.executescript(
                """
                CREATE TABLE IF NOT EXISTS hourly (
                    hour          INTEGER PRIMARY KEY,
                    messages      INTEGER NOT NULL DEFAULT 0,
                    unique_ac     INTEGER NOT NULL DEFAULT 0,
                    peak_contacts INTEGER NOT NULL DEFAULT 0,
                    max_range_nm  REAL    NOT NULL DEFAULT 0,
                    samples       INTEGER NOT NULL DEFAULT 0,
                    polls         INTEGER NOT NULL DEFAULT 0,
                    failures      INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS seen (
                    hex          TEXT NOT NULL,
                    day          INTEGER NOT NULL,
                    first_seen   INTEGER NOT NULL,
                    flight       TEXT,
                    registration TEXT,
                    type         TEXT,
                    operator     TEXT,
                    category     TEXT,
                    mil          INTEGER NOT NULL DEFAULT 0,
                    interesting  INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (hex, day)
                );
                CREATE TABLE IF NOT EXISTS coverage (
                    day          INTEGER NOT NULL,
                    bearing      INTEGER NOT NULL,
                    max_range_nm REAL    NOT NULL DEFAULT 0,
                    PRIMARY KEY (day, bearing)
                );
                CREATE TABLE IF NOT EXISTS counters (
                    name  TEXT    PRIMARY KEY,
                    value INTEGER NOT NULL DEFAULT 0
                );
                """
            )

    # --- write path -------------------------------------------------------

    def record(self, snapshot: dict) -> None:
        """Fold one radar snapshot into the rollups. Safe to call ~1 Hz."""
        try:
            now = float(snapshot.get("now") or time.time())
            hour = _hour(now)
            day = _day(now)
            aircraft = snapshot.get("aircraft") or []

            with self._lock:
                if hour != self._hour:
                    self._roll_hour(hour)

                # Accumulate this hour's running figures.
                for a in aircraft:
                    self._hexes.add(a["hex"])
                    d = a.get("distance_nm")
                    if d and d > self._max_range:
                        self._max_range = d
                total = (snapshot.get("counts") or {}).get("total", len(aircraft))
                if total > self._peak:
                    self._peak = total
                msgs = snapshot.get("messages_total")
                if msgs is not None:
                    if self._prev_total is not None and msgs >= self._prev_total:
                        self._messages += msgs - self._prev_total
                    self._prev_total = msgs
                self._samples += 1
                self._polls += 1

                self._upsert_hour(hour)
                self._record_seen(aircraft, day, int(now))
                self._record_coverage(snapshot.get("polar_range") or [], day)
                self._db.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("history record failed: %s", exc)

    def record_gap(self) -> None:
        """Note a failed poll for receiver-health accounting."""
        try:
            now = time.time()
            hour = _hour(now)
            with self._lock:
                if hour != self._hour:
                    self._roll_hour(hour)
                self._failures += 1
                self._upsert_hour(hour)
                self._db.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("history gap record failed: %s", exc)

    def bump_photo(self, hit: bool) -> None:
        """Count a photo-metadata lookup as a cache hit or a miss (durable)."""
        name = "photo_hits" if hit else "photo_misses"
        try:
            with self._lock:
                self._db.execute(
                    """
                    INSERT INTO counters (name, value) VALUES (?, 1)
                    ON CONFLICT(name) DO UPDATE SET value = value + 1
                    """,
                    (name,),
                )
                self._db.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("photo counter bump failed: %s", exc)

    def _roll_hour(self, hour: int) -> None:
        # New hour: reset the running accumulators. The previous hour's row is
        # already persisted from prior upserts.
        self._hour = hour
        self._hexes = set()
        self._messages = 0
        self._peak = 0
        self._max_range = 0.0
        self._samples = 0
        self._polls = 0
        self._failures = 0

    def _upsert_hour(self, hour: int) -> None:
        self._db.execute(
            """
            INSERT INTO hourly (hour, messages, unique_ac, peak_contacts,
                                max_range_nm, samples, polls, failures)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(hour) DO UPDATE SET
                messages=excluded.messages,
                unique_ac=excluded.unique_ac,
                peak_contacts=excluded.peak_contacts,
                max_range_nm=excluded.max_range_nm,
                samples=excluded.samples,
                polls=excluded.polls,
                failures=excluded.failures
            """,
            (
                hour,
                self._messages,
                len(self._hexes),
                self._peak,
                round(self._max_range, 1),
                self._samples,
                self._polls,
                self._failures,
            ),
        )

    def _record_seen(self, aircraft: list[dict], day: int, now: int) -> None:
        rows = [
            (
                a["hex"],
                day,
                now,
                a.get("flight"),
                a.get("registration"),
                a.get("type"),
                a.get("operator"),
                a.get("category"),
                1 if a.get("mil") else 0,
                1 if a.get("interesting") else 0,
            )
            for a in aircraft
        ]
        if not rows:
            return
        # Keep the original first_seen; backfill enrichment that arrives later.
        self._db.executemany(
            """
            INSERT INTO seen (hex, day, first_seen, flight, registration, type,
                              operator, category, mil, interesting)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(hex, day) DO UPDATE SET
                flight=COALESCE(seen.flight, excluded.flight),
                registration=COALESCE(seen.registration, excluded.registration),
                type=COALESCE(seen.type, excluded.type),
                operator=COALESCE(seen.operator, excluded.operator),
                category=COALESCE(seen.category, excluded.category),
                mil=MAX(seen.mil, excluded.mil),
                interesting=MAX(seen.interesting, excluded.interesting)
            """,
            rows,
        )

    def _record_coverage(self, polar: list, day: int) -> None:
        rows = [
            (day, int(bearing), float(nm))
            for bearing, nm in polar
            if nm
        ]
        if not rows:
            return
        self._db.executemany(
            """
            INSERT INTO coverage (day, bearing, max_range_nm)
            VALUES (?, ?, ?)
            ON CONFLICT(day, bearing) DO UPDATE SET
                max_range_nm=MAX(coverage.max_range_nm, excluded.max_range_nm)
            """,
            rows,
        )

    # --- read path --------------------------------------------------------

    def hourly(self, hours: int = 48) -> list[dict]:
        cutoff = _hour(time.time()) - (hours - 1) * HOUR
        with self._lock:
            rows = self._db.execute(
                "SELECT * FROM hourly WHERE hour >= ? ORDER BY hour ASC", (cutoff,)
            ).fetchall()
        return [dict(r) for r in rows]

    def summary(self) -> dict:
        """Today-so-far vs the same accounting for yesterday."""
        today = _day(time.time())
        yesterday = today - DAY

        def day_stats(day: int) -> dict:
            row = self._db.execute(
                """
                SELECT COALESCE(SUM(messages), 0)      AS messages,
                       COALESCE(MAX(peak_contacts), 0) AS peak_contacts,
                       COALESCE(MAX(max_range_nm), 0)  AS max_range_nm
                FROM hourly WHERE hour >= ? AND hour < ?
                """,
                (day, day + DAY),
            ).fetchone()
            uniq = self._db.execute(
                "SELECT COUNT(*) AS n FROM seen WHERE day = ?", (day,)
            ).fetchone()
            return {
                "messages": row["messages"],
                "peak_contacts": row["peak_contacts"],
                "max_range_nm": round(row["max_range_nm"], 1),
                "unique_ac": uniq["n"],
            }

        with self._lock:
            return {"today": day_stats(today), "yesterday": day_stats(yesterday)}

    def seen_today(self, limit: int = 80) -> list[dict]:
        """Aircraft first seen today, newest first; `rare` = type unseen before today."""
        today = _day(time.time())
        with self._lock:
            rows = self._db.execute(
                """
                SELECT s.*, NOT EXISTS (
                    SELECT 1 FROM seen p
                    WHERE p.type IS NOT NULL AND p.type = s.type AND p.day < ?
                ) AS rare
                FROM seen s
                WHERE s.day = ?
                ORDER BY s.first_seen DESC
                LIMIT ?
                """,
                (today, today, limit),
            ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["mil"] = bool(d["mil"])
            d["interesting"] = bool(d["interesting"])
            d["rare"] = bool(d["rare"]) and d["type"] is not None
            out.append(d)
        return out

    def aircraft_history(self, hexid: str) -> dict:
        """This station's own sighting log for one airframe (by ICAO hex).

        adsbdb has no flight-history feed, but our `seen` table records one row
        per (aircraft, day) — so we can show how often *this* receiver has seen
        the airframe, when it first/last appeared here, and the callsigns it has
        flown under overhead.
        """
        h = (hexid or "").lstrip("~").strip().upper()
        empty = {
            "hex": h,
            "days_seen": 0,
            "first_seen": None,
            "last_seen": None,
            "callsigns": [],
            "mil": False,
            "interesting": False,
        }
        if not h:
            return empty
        with self._lock:
            agg = self._db.execute(
                """
                SELECT COUNT(*)         AS days_seen,
                       MIN(first_seen)  AS first_seen,
                       MAX(day)         AS last_day,
                       MAX(mil)         AS mil,
                       MAX(interesting) AS interesting
                FROM seen WHERE hex = ?
                """,
                (h,),
            ).fetchone()
            calls = self._db.execute(
                """
                SELECT flight, MAX(day) AS last_day
                FROM seen
                WHERE hex = ? AND flight IS NOT NULL AND flight != ''
                GROUP BY flight
                ORDER BY last_day DESC
                LIMIT 8
                """,
                (h,),
            ).fetchall()
        if not agg or not agg["days_seen"]:
            return empty
        return {
            "hex": h,
            "days_seen": agg["days_seen"],
            "first_seen": agg["first_seen"],
            "last_seen": agg["last_day"],  # day-truncated epoch seconds
            "callsigns": [r["flight"].strip() for r in calls],
            "mil": bool(agg["mil"]),
            "interesting": bool(agg["interesting"]),
        }

    def coverage(self) -> dict:
        """Per-bearing best range today vs all-time, plus 24h receiver health."""
        today = _day(time.time())
        cutoff = _hour(time.time()) - 23 * HOUR
        with self._lock:
            today_rows = self._db.execute(
                "SELECT bearing, max_range_nm FROM coverage WHERE day = ? ORDER BY bearing",
                (today,),
            ).fetchall()
            best_rows = self._db.execute(
                """
                SELECT bearing, MAX(max_range_nm) AS max_range_nm
                FROM coverage GROUP BY bearing ORDER BY bearing
                """
            ).fetchall()
            health = self._db.execute(
                """
                SELECT COALESCE(SUM(polls), 0)    AS polls,
                       COALESCE(SUM(failures), 0) AS failures
                FROM hourly WHERE hour >= ?
                """,
                (cutoff,),
            ).fetchone()
        polls = health["polls"]
        failures = health["failures"]
        attempts = polls + failures
        uptime = round(100.0 * polls / attempts, 2) if attempts else 100.0
        return {
            "today": [[r["bearing"], round(r["max_range_nm"], 1)] for r in today_rows],
            "best": [[r["bearing"], round(r["max_range_nm"], 1)] for r in best_rows],
            "uptime_pct": uptime,
            "polls": polls,
            "failures": failures,
        }

    def airframe_stats(self) -> dict:
        """New airframes (first-ever sighting) today / this week / this month,
        against the all-time count of distinct airframes seen.

        Each airframe's debut is its earliest `seen.day`; an airframe counts as
        "new" in a period when that debut falls within it. Week and month are
        calendar-aligned in UTC (week starts Monday)."""
        now = time.time()
        now_dt = datetime.now(timezone.utc)
        today = _day(now)
        week_start = today - now_dt.weekday() * DAY
        month_start = int(
            datetime(now_dt.year, now_dt.month, 1, tzinfo=timezone.utc).timestamp()
        )
        with self._lock:
            row = self._db.execute(
                """
                SELECT
                    COUNT(*) AS total,
                    COALESCE(SUM(first_day >= ?), 0) AS today,
                    COALESCE(SUM(first_day >= ?), 0) AS week,
                    COALESCE(SUM(first_day >= ?), 0) AS month
                FROM (SELECT MIN(day) AS first_day FROM seen GROUP BY hex)
                """,
                (today, week_start, month_start),
            ).fetchone()
        return {
            "today": row["today"],
            "week": row["week"],
            "month": row["month"],
            "total": row["total"],
        }

    def diurnal(self, weeks: int = 8) -> dict:
        """Average unique-aircraft intensity by weekday × hour-of-day (UTC).

        Folds the last `weeks` of the `hourly` rollup into a 7×24 grid so the
        kiosk can render a calendar heatmap of when the sky is busy."""
        cutoff = _hour(time.time()) - weeks * 7 * 24 * HOUR
        with self._lock:
            rows = self._db.execute(
                "SELECT hour, unique_ac, peak_contacts FROM hourly WHERE hour >= ?",
                (cutoff,),
            ).fetchall()
        # (dow, hod) -> [sum_unique, sum_peak, samples]; dow 0=Mon … 6=Sun.
        acc: dict[tuple[int, int], list[float]] = {}
        for r in rows:
            dt = datetime.fromtimestamp(r["hour"], timezone.utc)
            key = (dt.weekday(), dt.hour)
            cell = acc.setdefault(key, [0.0, 0.0, 0])
            cell[0] += r["unique_ac"]
            cell[1] += r["peak_contacts"]
            cell[2] += 1
        grid = [
            {
                "dow": dow,
                "hod": hod,
                "unique": round(s[0] / s[2], 1),
                "peak": round(s[1] / s[2], 1),
                "samples": int(s[2]),
            }
            for (dow, hod), s in sorted(acc.items())
        ]
        return {"weeks": weeks, "grid": grid}

    def leaders(self, top: int = 12) -> dict:
        """Most-seen operators and types over rolling 7-day and 30-day windows,
        counting distinct airframes (hexes), not raw sightings."""
        today = _day(time.time())
        windows = {"week": today - 6 * DAY, "month": today - 29 * DAY}

        def board(start: int, column: str) -> list[dict]:
            rows = self._db.execute(
                f"""
                SELECT {column} AS label, COUNT(DISTINCT hex) AS count
                FROM seen
                WHERE day >= ? AND {column} IS NOT NULL AND {column} <> ''
                GROUP BY {column}
                ORDER BY count DESC, label ASC
                LIMIT ?
                """,
                (start, top),
            ).fetchall()
            return [{"label": r["label"], "count": r["count"]} for r in rows]

        with self._lock:
            return {
                name: {"operators": board(start, "operator"), "types": board(start, "type")}
                for name, start in windows.items()
            }

    def lifelist(self, limit: int = 80) -> dict:
        """The 'type-dex': every aircraft type ever logged, with how many distinct
        airframes and days it has appeared, plus first/last seen. Sorted rarest
        (fewest days) first so the unusual visitors surface."""
        with self._lock:
            rows = self._db.execute(
                """
                SELECT type AS label,
                       COUNT(DISTINCT hex) AS airframes,
                       COUNT(DISTINCT day) AS days,
                       MIN(day) AS first_day,
                       MAX(day) AS last_day,
                       MAX(mil) AS mil,
                       MAX(interesting) AS interesting
                FROM seen
                WHERE type IS NOT NULL AND type <> ''
                GROUP BY type
                """
            ).fetchall()
            total_airframes = self._db.execute(
                "SELECT COUNT(DISTINCT hex) AS n FROM seen"
            ).fetchone()["n"]
        types = [
            {
                "label": r["label"],
                "airframes": r["airframes"],
                "days": r["days"],
                "first_day": r["first_day"],
                "last_day": r["last_day"],
                "mil": bool(r["mil"]),
                "interesting": bool(r["interesting"]),
            }
            for r in rows
        ]
        # Rarest first: fewest days seen, then fewest distinct airframes.
        types.sort(key=lambda t: (t["days"], t["airframes"]))
        return {
            "total_types": len(types),
            "total_airframes": total_airframes,
            "types": types[:limit],
        }

    def records(self) -> dict:
        """Furthest-contact records: today's best, the all-time best, and the
        all-time best in each 45° compass octant (with the exact bearing)."""
        today = _day(time.time())
        octants = [
            ("N", 337.5, 360.0, 0.0, 22.5),
            ("NE", 22.5, 67.5),
            ("E", 67.5, 112.5),
            ("SE", 112.5, 157.5),
            ("S", 157.5, 202.5),
            ("SW", 202.5, 247.5),
            ("W", 247.5, 292.5),
            ("NW", 292.5, 337.5),
        ]
        with self._lock:
            today_row = self._db.execute(
                """
                SELECT bearing, max_range_nm FROM coverage
                WHERE day = ? ORDER BY max_range_nm DESC LIMIT 1
                """,
                (today,),
            ).fetchone()
            all_row = self._db.execute(
                """
                SELECT bearing, max_range_nm, day FROM coverage
                ORDER BY max_range_nm DESC LIMIT 1
                """
            ).fetchone()
            sectors = []
            for name, *bounds in octants:
                if len(bounds) == 4:  # N wraps 337.5–360 ∪ 0–22.5
                    where = "(bearing >= ? OR bearing < ?)"
                    params: tuple = (bounds[0], bounds[3])
                else:
                    where = "(bearing >= ? AND bearing < ?)"
                    params = (bounds[0], bounds[1])
                row = self._db.execute(
                    f"""
                    SELECT bearing, MAX(max_range_nm) AS max_range_nm
                    FROM coverage WHERE {where} GROUP BY bearing
                    ORDER BY max_range_nm DESC LIMIT 1
                    """,
                    params,
                ).fetchone()
                sectors.append(
                    {
                        "octant": name,
                        "range_nm": (
                            round(row["max_range_nm"], 1) if row and row["max_range_nm"] else 0.0
                        ),
                        "bearing": row["bearing"] if row else None,
                    }
                )

        def fmt(row, with_day=False):
            if not row or not row["max_range_nm"]:
                return None
            out = {"range_nm": round(row["max_range_nm"], 1), "bearing": row["bearing"]}
            if with_day:
                out["day"] = row["day"]
            return out

        return {
            "today": fmt(today_row),
            "alltime": fmt(all_row, with_day=True),
            "octants": sectors,
        }

    def photo_stats(self) -> dict:
        """Durable photo-cache hit/miss totals since the store was created."""
        with self._lock:
            rows = self._db.execute(
                "SELECT name, value FROM counters WHERE name IN ('photo_hits', 'photo_misses')"
            ).fetchall()
        by_name = {r["name"]: r["value"] for r in rows}
        return {"hits": by_name.get("photo_hits", 0), "misses": by_name.get("photo_misses", 0)}

    def close(self) -> None:
        with self._lock:
            self._db.close()
