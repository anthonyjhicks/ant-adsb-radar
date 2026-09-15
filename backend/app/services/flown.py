"""FlownRegistry — the set of aircraft registrations you have flown on.

Sourced read-only from an optional personal flights database (Postgres, via
FLIGHTS_DB_URL). It expects two tables:

  aircraft  (registration text)
  flight    (aircraft_registration text, end_country text, status text,
             deleted_at timestamp null, grouping_id text null, id)

`aircraft` gives the registrations, and `flight` gives, per registration, the
countries those flights landed in (rows with status 'approved' and no
deleted_at; rows sharing a grouping_id count as one flight). Loaded at startup
and refreshed periodically; both are small (a few hundred rows) and change
rarely. If no DB URL is configured the feature is simply inert (empty set).
"""

import logging

import asyncpg

from app.services.countries import iso2

logger = logging.getLogger(__name__)

_REGS_SQL = "select registration from aircraft where coalesce(registration, '') <> ''"

# Destination countries per airframe, commonest first. Flights sharing a
# grouping_id are one flight recorded more than once, so count the group.
_COUNTRIES_SQL = """
select upper(trim(aircraft_registration)) as reg,
       end_country as country,
       count(distinct coalesce(grouping_id, id::text)) as flights
  from flight
 where coalesce(aircraft_registration, '') <> ''
   and coalesce(end_country, '') <> ''
   and deleted_at is null
   and status = 'approved'
 group by 1, 2
 order by 1, 3 desc, 2
"""


class FlownRegistry:
    def __init__(self, db_url: str = "") -> None:
        self.db_url = db_url
        self.regs: set[str] = set()
        self.countries: dict[str, list[str]] = {}

    @property
    def enabled(self) -> bool:
        return bool(self.db_url)

    def _key(self, registration: str | None) -> str:
        return (registration or "").strip().upper()

    def has(self, registration: str | None) -> bool:
        key = self._key(registration)
        return bool(key) and key in self.regs

    def countries_for(self, registration: str | None) -> list[str]:
        """Alpha-2 codes of the countries the user has flown this airframe to."""
        return self.countries.get(self._key(registration), [])

    async def refresh(self) -> None:
        if not self.db_url:
            return
        try:
            conn = await asyncpg.connect(self.db_url, timeout=10)
            try:
                regs = await conn.fetch(_REGS_SQL)
                countries = await conn.fetch(_COUNTRIES_SQL)
            finally:
                await conn.close()
        except Exception as exc:  # noqa: BLE001
            logger.warning("FlownRegistry refresh failed (keeping %d): %s", len(self.regs), exc)
            return

        self.regs = {r["registration"].strip().upper() for r in regs if r["registration"]}

        # Rows arrive grouped by registration, commonest country first; keep
        # that order and drop names we have no flag for.
        by_reg: dict[str, list[str]] = {}
        for row in countries:
            code = iso2(row["country"])
            if not code:
                continue
            codes = by_reg.setdefault(row["reg"], [])
            if code not in codes:
                codes.append(code)
        self.countries = by_reg

        logger.info(
            "FlownRegistry loaded: %d registrations, %d with destination countries",
            len(self.regs),
            len(self.countries),
        )
