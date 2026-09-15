import { apiGet, apiPut } from './client';

/** Kiosk display config, stored on the backend so it's shared and durable. */
export interface PanelConfig {
	/** Saved view order (panel ids). Empty means "no preference — use defaults". */
	order: string[];
	/** Panel ids kept out of the rotation. Absent in configs saved before hiding existed. */
	hidden?: string[];
	/** Per-view dwell overrides in ms, keyed by panel id. Only the views actually changed. */
	dwell?: Record<string, number>;
	/** Unix seconds of the last save, or null if never saved. */
	updated_at: number | null;
}

export function getPanelConfig(fetchFn: typeof fetch = fetch): Promise<PanelConfig> {
	return apiGet(`/api/config/panels`, fetchFn);
}

export function savePanelConfig(
	order: string[],
	hidden: string[],
	dwell: Record<string, number>,
	fetchFn: typeof fetch = fetch
): Promise<PanelConfig> {
	return apiPut(`/api/config/panels`, { order, hidden, dwell }, fetchFn);
}

// --- Station settings --------------------------------------------------------

/**
 * The station document: what the kiosk calls itself, where the receiver is,
 * the fixed-range scopes and the weather stations. Stored on the backend next
 * to the panel config, so every screen agrees and it survives a redeploy.
 * Bounds and defaults mirror backend/app/services/station_config.py — keep
 * them in step.
 */
export interface StationConfig {
	/** Header title (and page title). */
	name: string;
	/** Manual receiver position; both null = use what readsb reports. */
	lat: number | null;
	lon: number | null;
	/** Print the receiver coordinates in the kiosk header. */
	show_coords: boolean;
	/** The wide fixed-range scope is "Local · <label>", or "Local · <n> nm" when empty. */
	local_label: string;
	local_nm: number;
	/** Range of the tight "Local · Home" scope. */
	home_nm: number;
	/** ICAO codes of the Weather & Runways cards, in order (max 4). */
	metar_stations: string[];
	/** Unix seconds of the last save, or null if never saved. */
	updated_at: number | null;
	/** GET only: the position readsb itself reports, so the editor can show what "automatic" is. */
	readsb?: { lat: number | null; lon: number | null };
}

export const DEFAULT_STATION: StationConfig = {
	name: 'Ant ADS-B Radar',
	lat: null,
	lon: null,
	show_coords: false,
	local_label: '',
	local_nm: 40,
	home_nm: 10,
	metar_stations: ['EGLL', 'EGKK', 'EGLW', 'EGLC'],
	updated_at: null
};

export const MAX_STATION_NAME_LEN = 40;
export const MAX_LOCAL_LABEL_LEN = 32;
export const MIN_LOCAL_NM = 5;
export const MAX_LOCAL_NM = 240;
export const MIN_HOME_NM = 2;
export const MAX_HOME_NM = 100;
export const MAX_METAR_STATIONS = 4;

/** What the editor sends: every field, with null meaning "back to the default". */
export type StationInput = Omit<StationConfig, 'updated_at' | 'readsb'>;

export function getStationConfig(fetchFn: typeof fetch = fetch): Promise<StationConfig> {
	return apiGet(`/api/config/station`, fetchFn);
}

export function saveStationConfig(
	station: StationInput,
	fetchFn: typeof fetch = fetch
): Promise<StationConfig> {
	return apiPut(`/api/config/station`, station, fetchFn);
}
