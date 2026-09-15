import { apiGet } from './client';

export type CloudCover = 'FEW' | 'SCT' | 'BKN' | 'OVC' | 'VV';

export interface MetarWind {
	dir: number | null;
	speed: number | null;
	gust: number | null;
	variable: boolean;
	/** `250V330` variability range, when reported. */
	var_from?: number | null;
	var_to?: number | null;
}

/** One decoded present-weather group, e.g. `-SHRA` → light rain showers. */
export interface WeatherGroup {
	code: string;
	intensity: 'light' | 'moderate' | 'heavy' | 'vicinity';
	descriptor: string | null; // SH, TS, FZ, MI, BC, PR, DR, BL
	precip: string[]; // RA, DZ, SN, SG, IC, PL, GR, GS, UP
	obscuration: string | null; // BR, FG, FU, VA, DU, SA, HZ, PY
	other: string | null; // PO, SQ, FC, SS, DS
	label: string;
}

export interface CloudLayer {
	cover: CloudCover;
	base_ft: number | null;
	type: 'CB' | 'TCU' | null;
	oktas: number;
}

/** Wind components on one runway end (kt); null when the wind is variable. */
export interface RunwayWind {
	name: string;
	heading: number;
	active: boolean;
	/** Negative = tailwind. */
	headwind: number | null;
	crosswind: number | null;
	crosswind_from: 'L' | 'R' | null;
}

export type SkySummary =
	| 'few'
	| 'scattered'
	| 'broken'
	| 'overcast'
	| 'obscured'
	| 'cavok'
	| 'clear'
	| 'unknown';

export interface Metar {
	icao: string;
	available: boolean;
	name?: string | null;
	lat?: number | null;
	lon?: number | null;
	elev_ft?: number | null;
	raw?: string | null;
	obs_time?: string | null;
	wind?: MetarWind;
	temp?: number | null;
	dewp?: number | null;
	/** Upstream's own visibility field (statute miles, "6+"); prefer visibility_m. */
	visibility?: string | number | null;
	visibility_m?: number | null;
	cavok?: boolean;
	qnh?: number | null;
	flight_category?: string | null;
	clouds?: { cover?: string; base?: number | null }[];
	cloud_layers?: CloudLayer[];
	ceiling_ft?: number | null;
	sky?: SkySummary;
	wx?: string | null;
	weather?: WeatherGroup[];
	runways?: string[];
	mode?: string | null;
	runway_winds?: RunwayWind[];
}

export function getMetar(icao: string, fetchFn: typeof fetch = fetch): Promise<Metar> {
	return apiGet<Metar>(`/api/metar/${encodeURIComponent(icao)}`, fetchFn);
}

/** Several stations in one round trip (one upstream call for the uncached ones). */
export async function getMetars(icaos: string[], fetchFn: typeof fetch = fetch): Promise<Metar[]> {
	const res = await apiGet<{ stations?: Metar[] }>(
		`/api/metar?ids=${encodeURIComponent(icaos.join(','))}`,
		fetchFn
	);
	return res.stations ?? [];
}
