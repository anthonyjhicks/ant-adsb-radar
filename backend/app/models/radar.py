"""Pydantic models for the normalized radar snapshot served to the frontend."""

from pydantic import BaseModel


class Aircraft(BaseModel):
    hex: str  # ICAO 24-bit address as 6 hex digits (may be prefixed '~' for non-ICAO)
    flight: str | None = None  # trimmed callsign
    registration: str | None = None  # from aircraft DB
    type: str | None = None  # ICAO type designator from aircraft DB, e.g. "B738"
    type_long: str | None = None  # full model name, e.g. "BOEING 737-800"
    wake: str | None = None  # wake turbulence category L/M/H/J
    operator: str | None = None  # airline name from callsign prefix
    flown: bool = False  # you have flown on this airframe (optional flights DB)
    flown_countries: list[str] = []  # ISO-3166 alpha-2 of countries flown to on it
    mil: bool = False  # military airframe (Mictronics db flag)
    interesting: bool = False  # flagged "interesting" in the Mictronics db
    squawk: str | None = None  # 4-digit Mode A code, e.g. "7000"

    # Position
    lat: float | None = None
    lon: float | None = None
    distance_nm: float | None = None  # distance to receiver
    bearing: float | None = None  # bearing from receiver, degrees true

    # Altitude / vertical
    alt_baro: int | None = None  # feet
    alt_geom: int | None = None  # feet
    flight_level: int | None = None  # alt_baro / 100
    on_ground: bool = False
    baro_rate: int | None = None  # ft/min
    vert_trend: int = 0  # -1 descending, 0 level, +1 climbing

    # Velocity / track
    gs: int | None = None  # ground speed, knots
    track: int | None = None  # true track over ground, degrees
    mag_heading: int | None = None

    # Classification
    category: str | None = None  # e.g. "A3"
    category_label: str | None = None  # e.g. "Large"
    pos_source: str | None = None  # position source: ADS-B / ADS-R / TIS-B / MLAT / Mode-S

    # Status
    emergency: str | None = None  # emergency kind if any (squawk or ADS-B flag)
    alert: bool = False
    spi: bool = False

    # Signal / freshness
    rssi: float | None = None  # dBFS (negative)
    seen: float | None = None  # seconds since last message
    messages: int | None = None


class ReceiverInfo(BaseModel):
    version: str | None = None
    lat: float | None = None
    lon: float | None = None
    altitude: int | None = None
    refresh_ms: float | None = None
    # Where lat/lon came from: "readsb" (its own site position) or "manual"
    # (the override set at /config).
    source: str | None = None


class Counts(BaseModel):
    total: int = 0
    positioned: int = 0
    airborne: int = 0
    on_ground: int = 0
    with_callsign: int = 0
    emergencies: int = 0


class RadarSnapshot(BaseModel):
    now: float  # epoch seconds, when readsb generated the data
    receiver: ReceiverInfo
    aircraft: list[Aircraft]
    counts: Counts
    nearest: list[Aircraft]  # closest N with a position, by distance
    emergencies: list[Aircraft]
    polar_range: list[tuple[int, float]]  # [bearing_deg, max_range_nm] points, sorted by bearing
    max_range_nm: float = 0.0  # all-time max range record
    messages_total: int = 0  # cumulative Mode S messages since readsb start
    messages_per_sec: float = 0.0  # instantaneous rate (collector computes from delta)


class StatPeriod(BaseModel):
    messages: int = 0
    max_distance_nm: float = 0.0
    tracks_new: int = 0
    tracks_with_position: int = 0
    tracks_mlat: int = 0
    cpr_global_ok: int = 0
    cpr_global_bad: int = 0
    local_modes: int = 0
    local_accepted: int = 0
    local_signal: float | None = None
    local_noise: float | None = None
    local_peak_signal: float | None = None
    local_strong_signals: int = 0
    duration_s: float = 0.0
    messages_per_sec: float = 0.0


class RadarStats(BaseModel):
    latest: StatPeriod
    last_1min: StatPeriod
    last_5min: StatPeriod
    last_15min: StatPeriod
    total: StatPeriod
