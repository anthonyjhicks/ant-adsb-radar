import { apiGet } from './client';

export interface HourBucket {
	hour: number; // epoch seconds, hour-truncated
	messages: number;
	unique_ac: number;
	peak_contacts: number;
	max_range_nm: number;
	samples: number;
	polls: number;
	failures: number;
}

export interface DayStats {
	messages: number;
	peak_contacts: number;
	max_range_nm: number;
	unique_ac: number;
}

export interface HistorySummary {
	today: DayStats;
	yesterday: DayStats;
}

export interface SeenAircraft {
	hex: string;
	day: number;
	first_seen: number; // epoch seconds
	flight: string | null;
	registration: string | null;
	type: string | null;
	operator: string | null;
	category: string | null;
	mil: boolean;
	interesting: boolean;
	rare: boolean; // type not seen before today
}

export interface Coverage {
	today: [number, number][]; // [bearingDeg, maxRangeNm]
	best: [number, number][];
	uptime_pct: number;
	polls: number;
	failures: number;
}

export interface AirframeStats {
	today: number; // airframes seen for the first time ever today
	week: number; // first-ever this calendar week (Mon-aligned, UTC)
	month: number; // first-ever this calendar month (UTC)
	total: number; // distinct airframes seen all-time
}

export function getHourly(hours = 48, fetchFn: typeof fetch = fetch): Promise<{ hours: number; buckets: HourBucket[] }> {
	return apiGet(`/api/history/hourly?hours=${hours}`, fetchFn);
}

export function getSummary(fetchFn: typeof fetch = fetch): Promise<HistorySummary> {
	return apiGet(`/api/history/summary`, fetchFn);
}

export function getSeenToday(limit = 80, fetchFn: typeof fetch = fetch): Promise<{ aircraft: SeenAircraft[] }> {
	return apiGet(`/api/history/today?limit=${limit}`, fetchFn);
}

export interface LeaderEntry {
	label: string;
	count: number; // distinct airframes in the window
}
export interface LeaderBoard {
	operators: LeaderEntry[];
	types: LeaderEntry[];
}
export interface Leaders {
	week: LeaderBoard;
	month: LeaderBoard;
}

export interface LifelistType {
	label: string; // ICAO type designator
	airframes: number; // distinct hexes ever seen of this type
	days: number; // distinct days seen on
	first_day: number; // epoch seconds, day-truncated
	last_day: number;
	mil: boolean;
	interesting: boolean;
}
export interface Lifelist {
	total_types: number;
	total_airframes: number;
	types: LifelistType[]; // rarest (fewest days) first
}

export interface RangeRecord {
	range_nm: number;
	bearing: number | null;
	day?: number; // epoch seconds, only on the all-time record
}
export interface OctantRecord {
	octant: string; // N, NE, E, …
	range_nm: number;
	bearing: number | null;
}
export interface Records {
	today: RangeRecord | null;
	alltime: RangeRecord | null;
	octants: OctantRecord[];
}

export function getCoverage(fetchFn: typeof fetch = fetch): Promise<Coverage> {
	return apiGet(`/api/history/coverage`, fetchFn);
}

export function getLeaders(top = 12, fetchFn: typeof fetch = fetch): Promise<Leaders> {
	return apiGet(`/api/history/leaders?top=${top}`, fetchFn);
}

export function getLifelist(limit = 80, fetchFn: typeof fetch = fetch): Promise<Lifelist> {
	return apiGet(`/api/history/lifelist?limit=${limit}`, fetchFn);
}

export function getRecords(fetchFn: typeof fetch = fetch): Promise<Records> {
	return apiGet(`/api/history/records`, fetchFn);
}

export function getAirframeStats(fetchFn: typeof fetch = fetch): Promise<AirframeStats> {
	return apiGet(`/api/history/airframes`, fetchFn);
}

export interface AircraftHistory {
	hex: string;
	days_seen: number; // distinct days this station has logged this airframe
	first_seen: number | null; // epoch seconds, first-ever sighting here
	last_seen: number | null; // epoch seconds, day-truncated, most recent day
	callsigns: string[]; // recent distinct callsigns flown overhead
	mil: boolean;
	interesting: boolean;
}

// Shared client-side cache by ICAO hex.
export const aircraftHistoryCache = new Map<string, AircraftHistory>();

export function getAircraftHistory(hex: string, fetchFn: typeof fetch = fetch): Promise<AircraftHistory> {
	const key = hex.replace(/^~/, '').toUpperCase();
	return apiGet<AircraftHistory>(`/api/history/aircraft/${encodeURIComponent(key)}`, fetchFn);
}
