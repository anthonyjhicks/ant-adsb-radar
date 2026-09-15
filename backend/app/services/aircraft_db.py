"""AircraftDB — registration / type / operator enrichment.

Sources the Mictronics flat databases that readsb's own webapp ships and serves
over HTTP at READSB_URL/db/. Fetched once at startup, held in memory:

  aircrafts.json : {"<HEX>": [registration, typeDesignator, flags]}
  types.json     : {"<TD>":  [fullModel, engineCode, wakeCategory]}
  operators.json : {"<PFX>": [airline, country, telephony]}   PFX = first 3 of callsign

No file mounts and no committed datasets — it stays in sync with readsb.
"""

import logging

import httpx

logger = logging.getLogger(__name__)


class AircraftDB:
    def __init__(
        self,
        aircrafts: dict[str, list],
        types: dict[str, list],
        operators: dict[str, list],
    ) -> None:
        self.aircrafts = aircrafts
        self.types = types
        self.operators = operators

    @property
    def loaded(self) -> bool:
        return bool(self.aircrafts)

    @classmethod
    async def from_readsb(cls, base_url: str, timeout: float = 30.0) -> "AircraftDB":
        """Fetch the three db files from readsb's web server."""
        base = base_url.rstrip("/")
        async with httpx.AsyncClient(timeout=timeout) as client:

            async def grab(name: str) -> dict:
                resp = await client.get(f"{base}/db/{name}.json")
                resp.raise_for_status()
                return resp.json()

            aircrafts = await grab("aircrafts")
            types = await grab("types")
            operators = await grab("operators")
        logger.info(
            "AircraftDB loaded: %d aircraft, %d types, %d operators",
            len(aircrafts),
            len(types),
            len(operators),
        )
        return cls(aircrafts, types, operators)

    def enrich(self, hexid: str, flight: str | None) -> dict:
        """Return enrichment fields for an aircraft. Missing pieces are None."""
        out = {
            "registration": None,
            "type": None,
            "type_long": None,
            "wake": None,
            "operator": None,
            "mil": False,
            "interesting": False,
        }

        rec = self.aircrafts.get(hexid)
        if rec:
            out["registration"] = rec[0] or None
            td = (rec[1] or "").strip() if len(rec) > 1 else ""
            if td:
                out["type"] = td
                t = self.types.get(td)
                if t:
                    out["type_long"] = t[0] or None
                    out["wake"] = (t[2] or None) if len(t) > 2 else None
            # rec[2] is a hex-encoded flag bitfield: bit 0 = military,
            # bit 1 = "interesting" (warbirds, heads-of-state, test aircraft…).
            if len(rec) > 2 and rec[2]:
                try:
                    flags = int(rec[2], 16)
                    out["mil"] = bool(flags & 0x01)
                    out["interesting"] = bool(flags & 0x02)
                except (ValueError, TypeError):
                    pass

        # Operator from the first 3 letters of an airline callsign (e.g. BAW283).
        if flight and len(flight) >= 3:
            pfx = flight[:3].upper()
            if pfx.isalpha():
                op = self.operators.get(pfx)
                if op:
                    out["operator"] = op[0] or None

        return out
