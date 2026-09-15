"""ReadsbService — polls Mictronics readsb-protobuf and normalizes its
aircraft / receiver / statistics protobuf feeds into plain dicts that match
the Pydantic models in app.models.radar.
"""

import asyncio
import logging
import math

from app.proto import readsb_pb2
from app.services.aircraft_db import AircraftDB
from app.services.base import HTTPService
from app.services.flown import FlownRegistry
from app.services.station_config import StationConfigStore

logger = logging.getLogger(__name__)

# Emitter category codes (A0-D7) -> short human label.
CATEGORY_LABELS: dict[str, str] = {
    "A0": "No info",
    "A1": "Light",
    "A2": "Small",
    "A3": "Large",
    "A4": "High-vortex",
    "A5": "Heavy",
    "A6": "High-perf",
    "A7": "Rotorcraft",
    "B1": "Glider",
    "B2": "Lighter-than-air",
    "B3": "Parachutist",
    "B4": "Ultralight",
    "B6": "UAV",
    "B7": "Spacecraft",
    "C1": "Emergency veh.",
    "C2": "Service veh.",
    "C3": "Point obstacle",
    "C4": "Cluster obstacle",
    "C5": "Line obstacle",
}

# proto Emergency enum value -> label
EMERGENCY_LABELS: dict[int, str] = {
    1: "General",
    2: "Lifeguard",
    3: "Min fuel",
    4: "No comms",
    5: "Unlawful interference",
    6: "Downed",
}

# Special Mode A squawk codes that signal an emergency.
SQUAWK_EMERGENCY: dict[str, str] = {
    "7500": "Hijack",
    "7600": "Radio failure",
    "7700": "Emergency",
}

# readsb datasource enum (per-field provenance in valid_source); we read it for
# the position (lat) to distinguish how a contact's location was determined.
SOURCE_LABELS: dict[int, str] = {
    1: "Mode-A/C",
    2: "MLAT",
    3: "Mode-S",
    4: "Mode-S",
    5: "TIS-B",
    6: "ADS-R",
    7: "ADS-B",
}

AG_GROUND = 1


def _bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Initial great-circle bearing from point 1 (receiver) to point 2, in degrees true."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlon = math.radians(lon2 - lon1)
    x = math.sin(dlon) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dlon)
    return (math.degrees(math.atan2(x, y)) + 360.0) % 360.0


def _haversine_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two points, in nautical miles."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 3440.065 * 2 * math.asin(math.sqrt(a))


class ReadsbService(HTTPService):
    def __init__(
        self,
        base_url: str,
        nearest_count: int = 12,
        db: AircraftDB | None = None,
        flown: FlownRegistry | None = None,
        station: StationConfigStore | None = None,
    ) -> None:
        super().__init__(base_url=base_url, timeout=8.0)
        self.nearest_count = nearest_count
        self.db = db
        self.flown = flown
        self.station = station
        # What readsb itself last reported as its site position, before any
        # manual override — the /config page shows it so you can see what
        # "automatic" resolves to.
        self.readsb_receiver: dict = {"lat": None, "lon": None}

    async def fetch_status(self) -> dict:
        """Return {"snapshot": <RadarSnapshot dict>, "stats": <RadarStats dict>}."""
        ac_bytes, rx_bytes, st_bytes = await asyncio.gather(
            self._get_bytes("/data/aircraft.pb"),
            self._get_bytes("/data/receiver.pb"),
            self._get_bytes("/data/stats.pb"),
        )

        update = readsb_pb2.AircraftsUpdate()
        update.ParseFromString(ac_bytes)
        receiver = readsb_pb2.Receiver()
        receiver.ParseFromString(rx_bytes)
        stats = readsb_pb2.Statistics()
        stats.ParseFromString(st_bytes)

        self.readsb_receiver = {
            "lat": receiver.latitude or None,
            "lon": receiver.longitude or None,
        }
        # A manual position set at /config wins over readsb's own. When it's in
        # use, range and bearing are computed from it for every contact so the
        # picture stays consistent with the centre of the scope.
        override = self.station.location() if self.station else None
        if override:
            rx_lat, rx_lon = override
        else:
            rx_lat = receiver.latitude or None
            rx_lon = receiver.longitude or None
        now = update.now

        aircraft = [
            self._normalize(a, now, rx_lat, rx_lon, manual=override is not None)
            for a in update.aircraft
        ]

        positioned = [a for a in aircraft if a["lat"] is not None]
        with_dist = [a for a in positioned if a["distance_nm"] is not None]
        with_dist.sort(key=lambda a: a["distance_nm"])
        emergencies = [a for a in aircraft if a["emergency"]]

        counts = {
            "total": len(aircraft),
            "positioned": len(positioned),
            "airborne": sum(1 for a in aircraft if not a["on_ground"]),
            "on_ground": sum(1 for a in aircraft if a["on_ground"]),
            "with_callsign": sum(1 for a in aircraft if a["flight"]),
            "emergencies": len(emergencies),
        }

        # polar_range keys are bucket indices (0..n-1); n buckets span 360°,
        # so the default 72 buckets => 5° resolution. Convert index -> bearing.
        n_buckets = len(stats.polar_range)
        step = 360 // n_buckets if n_buckets else 1
        polar = sorted(
            (
                (int(idx) * step, round(meters / 1852.0, 1))
                for idx, meters in stats.polar_range.items()
            ),
            key=lambda p: p[0],
        )

        snapshot = {
            "now": now,
            "receiver": {
                "version": receiver.version or None,
                "lat": rx_lat,
                "lon": rx_lon,
                "altitude": receiver.altitude or None,
                "refresh_ms": receiver.refresh or None,
                "source": "manual" if override else "readsb",
            },
            "aircraft": aircraft,
            "counts": counts,
            "nearest": with_dist[: self.nearest_count],
            "emergencies": emergencies,
            "polar_range": polar,
            "max_range_nm": float(stats.total.max_distance_in_nautical_miles or 0),
            "messages_total": update.messages,
            "messages_per_sec": 0.0,  # filled in by the collector from inter-poll delta
        }

        return {"snapshot": snapshot, "stats": self._normalize_stats(stats)}

    def _normalize(self, a, now: int, rx_lat, rx_lon, manual: bool = False) -> dict:
        addr = a.addr & 0xFFFFFF
        hexid = f"{addr:06X}"
        # addr_type 0/1/2 are ICAO; everything else is a non-ICAO/TIS-B/MLAT address.
        prefix = "" if a.addr_type in (0, 1, 2) else "~"

        flight = (a.flight or "").strip() or None

        lat = a.lat or None
        lon = a.lon or None
        have_rx = rx_lat is not None and rx_lon is not None
        # readsb precomputes each contact's distance to *its* site. That's only
        # right when its site is the one we're centred on, so under a manual
        # override (or when readsb has no site configured and reports 0) the
        # distance is computed here from the position instead.
        distance_nm = None
        if a.distance and not manual:
            distance_nm = round(a.distance / 1852.0, 1)
        elif lat is not None and lon is not None and have_rx:
            distance_nm = round(_haversine_nm(rx_lat, rx_lon, lat, lon), 1)
        bearing = None
        if lat is not None and lon is not None and have_rx:
            bearing = round(_bearing(rx_lat, rx_lon, lat, lon), 1)

        on_ground = a.air_ground == AG_GROUND
        alt_baro = None if a.air_ground == AG_GROUND else (a.alt_baro or None)
        flight_level = round(alt_baro / 100) if alt_baro else None

        rate = a.baro_rate or a.geom_rate or 0
        vert_trend = 1 if rate > 100 else (-1 if rate < -100 else 0)

        category = f"{a.category:02X}" if a.category else None
        category_label = CATEGORY_LABELS.get(category) if category else None

        squawk = f"{a.squawk:04X}" if a.squawk else None
        emergency = None
        if squawk in SQUAWK_EMERGENCY:
            emergency = SQUAWK_EMERGENCY[squawk]
        elif a.emergency in EMERGENCY_LABELS:
            emergency = EMERGENCY_LABELS[a.emergency]

        enrich = self.db.enrich(hexid, flight) if self.db else {}
        registration = enrich.get("registration")
        flown = bool(self.flown and self.flown.has(registration))
        flown_countries = self.flown.countries_for(registration) if flown else []

        # Position provenance from readsb's per-field source enum (only meaningful
        # when we actually have a position).
        pos_source = None
        if lat is not None and lon is not None:
            pos_source = SOURCE_LABELS.get(a.valid_source.lat)

        # seen is an absolute epoch-millisecond timestamp; derive age in seconds.
        seen_age = None
        if a.seen:
            seen_age = max(0.0, round(now - a.seen / 1000.0, 1))

        return {
            "hex": prefix + hexid,
            "flight": flight,
            "registration": registration,
            "type": enrich.get("type"),
            "type_long": enrich.get("type_long"),
            "wake": enrich.get("wake"),
            "operator": enrich.get("operator"),
            "flown": flown,
            "flown_countries": flown_countries,
            "mil": enrich.get("mil", False),
            "interesting": enrich.get("interesting", False),
            "squawk": squawk,
            "lat": lat,
            "lon": lon,
            "distance_nm": distance_nm,
            "bearing": bearing,
            "alt_baro": alt_baro,
            "alt_geom": a.alt_geom or None,
            "flight_level": flight_level,
            "on_ground": on_ground,
            "baro_rate": a.baro_rate or a.geom_rate or None,
            "vert_trend": vert_trend,
            "gs": a.gs or None,
            "track": a.track if (a.track or a.gs) else None,
            "mag_heading": a.mag_heading or None,
            "category": category,
            "category_label": category_label,
            "pos_source": pos_source,
            "emergency": emergency,
            "alert": bool(a.alert),
            "spi": bool(a.spi),
            "rssi": round(a.rssi, 1) if a.rssi else None,
            "seen": seen_age,
            "messages": a.messages or None,
        }

    @staticmethod
    def _stat_period(e) -> dict:
        duration = max(0, e.stop - e.start)
        return {
            "messages": e.messages,
            "max_distance_nm": float(e.max_distance_in_nautical_miles or 0),
            "tracks_new": e.tracks_new,
            "tracks_with_position": e.tracks_with_position,
            "tracks_mlat": e.tracks_mlat_position,
            "cpr_global_ok": e.cpr_global_ok,
            "cpr_global_bad": e.cpr_global_bad,
            "local_modes": e.local_modes,
            "local_accepted": e.local_accepted,
            "local_signal": round(e.local_signal, 1) if e.local_signal else None,
            "local_noise": round(e.local_noise, 1) if e.local_noise else None,
            "local_peak_signal": round(e.local_peak_signal, 1) if e.local_peak_signal else None,
            "local_strong_signals": e.local_strong_signals,
            "duration_s": float(duration),
            "messages_per_sec": round(e.messages / duration, 1) if duration else 0.0,
        }

    def _normalize_stats(self, s) -> dict:
        return {
            "latest": self._stat_period(s.latest),
            "last_1min": self._stat_period(s.last_1min),
            "last_5min": self._stat_period(s.last_5min),
            "last_15min": self._stat_period(s.last_15min),
            "total": self._stat_period(s.total),
        }
