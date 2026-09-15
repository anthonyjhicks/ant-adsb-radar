// Mirrors backend app/models/radar.py

export interface Aircraft {
	hex: string;
	flight: string | null;
	registration: string | null;
	type: string | null;
	type_long: string | null;
	wake: string | null;
	operator: string | null;
	flown: boolean;
	flown_countries: string[]; // ISO-3166 alpha-2 of countries flown to on it
	mil: boolean;
	interesting: boolean;
	squawk: string | null;

	lat: number | null;
	lon: number | null;
	distance_nm: number | null;
	bearing: number | null;

	alt_baro: number | null;
	alt_geom: number | null;
	flight_level: number | null;
	on_ground: boolean;
	baro_rate: number | null;
	vert_trend: number; // -1 / 0 / +1

	gs: number | null;
	track: number | null;
	mag_heading: number | null;

	category: string | null;
	category_label: string | null;
	pos_source: string | null; // ADS-B / ADS-R / TIS-B / MLAT / Mode-S

	emergency: string | null;
	alert: boolean;
	spi: boolean;

	rssi: number | null;
	seen: number | null;
	messages: number | null;
}

export interface ReceiverInfo {
	version: string | null;
	lat: number | null;
	lon: number | null;
	altitude: number | null;
	refresh_ms: number | null;
	/** "readsb" (its own site position) or "manual" (the override set at /config). */
	source?: string | null;
}

export interface Counts {
	total: number;
	positioned: number;
	airborne: number;
	on_ground: number;
	with_callsign: number;
	emergencies: number;
}

export interface RadarSnapshot {
	now: number;
	receiver: ReceiverInfo;
	aircraft: Aircraft[];
	counts: Counts;
	nearest: Aircraft[];
	emergencies: Aircraft[];
	polar_range: [number, number][]; // [bearingDeg, maxRangeNm]
	max_range_nm: number;
	messages_total: number;
	messages_per_sec: number;
}

export interface StatPeriod {
	messages: number;
	max_distance_nm: number;
	tracks_new: number;
	tracks_with_position: number;
	tracks_mlat: number;
	cpr_global_ok: number;
	cpr_global_bad: number;
	local_modes: number;
	local_accepted: number;
	local_signal: number | null;
	local_noise: number | null;
	local_peak_signal: number | null;
	local_strong_signals: number;
	duration_s: number;
	messages_per_sec: number;
}

export interface RadarStats {
	latest: StatPeriod;
	last_1min: StatPeriod;
	last_5min: StatPeriod;
	last_15min: StatPeriod;
	total: StatPeriod;
}
