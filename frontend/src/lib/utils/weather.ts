// METAR → what the Weather & Runways view shows: the parameters that drive the
// animated sky over the station (cloud decks, precipitation, fog, wind), plus
// the human-readable summaries and formatters shared by the scene HUD and the
// runway cards. Pure functions — see weather.test.ts.

import type { Metar, WeatherGroup } from '$lib/api/metar';
import { bearingTo, haversineNm } from '$lib/utils/geo';

export type PrecipKind = 'none' | 'rain' | 'drizzle' | 'snow' | 'sleet' | 'hail';

export interface SceneLayer {
	/** METAR cover code (FEW/SCT/BKN/OVC/VV). */
	code: string;
	baseFt: number;
	/** Fraction of sky covered, 0–1 (oktas / 8). */
	cover: number;
	/** Cumulonimbus / towering cumulus: drawn as a tower, darker. */
	cb: boolean;
}

export interface SceneConditions {
	/** Sorted lowest first. */
	layers: SceneLayer[];
	precip: PrecipKind;
	/** 0 none · 1 light · 2 moderate · 3 heavy. */
	intensity: 0 | 1 | 2 | 3;
	/** Showers (SH): precipitation falls from a moving cell rather than everywhere. */
	showers: boolean;
	/** Weather in the vicinity (VC…): a cell parked at the upwind edge. */
	vicinity: boolean;
	thunder: boolean;
	/** Ground obscuration 0–1, from fog/mist/haze codes and the visibility. */
	fog: number;
	/** Haze / smoke / dust reads warmer than mist / fog. */
	fogTint: 'grey' | 'warm';
	/** Where the wind blows from (deg true); null when calm or variable. */
	windFromDeg: number | null;
	windKt: number;
	gustKt: number | null;
	tempC: number | null;
	freezing: boolean;
}

export const CALM_CONDITIONS: SceneConditions = {
	layers: [],
	precip: 'none',
	intensity: 0,
	showers: false,
	vicinity: false,
	thunder: false,
	fog: 0,
	fogTint: 'grey',
	windFromDeg: null,
	windKt: 0,
	gustKt: null,
	tempC: null,
	freezing: false
};

const OKTAS: Record<string, number> = { FEW: 1.5, SCT: 3.5, BKN: 6, OVC: 8, VV: 8 };
const INTENSITY: Record<WeatherGroup['intensity'], 0 | 1 | 2 | 3> = {
	light: 1,
	moderate: 2,
	heavy: 3,
	vicinity: 0
};
const PRECIP_RANK: Record<PrecipKind, number> = {
	none: 0,
	drizzle: 1,
	rain: 2,
	sleet: 3,
	snow: 4,
	hail: 5
};

function precipKind(codes: string[]): PrecipKind {
	const has = (...c: string[]) => c.some((x) => codes.includes(x));
	if (has('GR', 'GS', 'PL')) return 'hail';
	const snow = has('SN', 'SG', 'IC');
	const rain = has('RA', 'UP');
	const drizzle = has('DZ');
	if (snow && (rain || drizzle)) return 'sleet';
	if (snow) return 'snow';
	if (rain) return 'rain';
	if (drizzle) return 'drizzle';
	return 'none';
}

function layersOf(m: Metar): SceneLayer[] {
	const parsed = m.cloud_layers;
	const out: SceneLayer[] = parsed?.length
		? parsed.map((l) => ({
				code: l.cover,
				baseFt: l.base_ft ?? 1000,
				cover: (l.oktas ?? OKTAS[l.cover] ?? 4) / 8,
				cb: l.type === 'CB' || l.type === 'TCU'
			}))
		: (m.clouds ?? [])
				.filter((c) => c.cover != null && OKTAS[c.cover] != null)
				.map((c) => ({
					code: c.cover as string,
					baseFt: c.base ?? 1000,
					cover: OKTAS[c.cover as string] / 8,
					cb: false
				}));
	return out.sort((a, b) => a.baseFt - b.baseFt);
}

/** The visual parameters for the sky scene, from one station's report. */
export function sceneConditions(m: Metar | null | undefined): SceneConditions {
	if (!m?.available) return CALM_CONDITIONS;

	let precip: PrecipKind = 'none';
	let intensity: 0 | 1 | 2 | 3 = 0;
	let showers = false;
	let vicinity = false;
	let thunder = false;
	let freezing = false;
	let fog = 0;
	let fogTint: 'grey' | 'warm' = 'grey';

	for (const g of m.weather ?? []) {
		const kind = precipKind(g.precip);
		if (g.intensity === 'vicinity') {
			if (kind !== 'none' || g.descriptor === 'SH') vicinity = true;
			if (g.descriptor === 'TS') thunder = true;
			continue;
		}
		if (kind !== 'none') {
			if ((precip === 'rain' && kind === 'snow') || (precip === 'snow' && kind === 'rain')) {
				precip = 'sleet';
			} else if (PRECIP_RANK[kind] > PRECIP_RANK[precip]) {
				precip = kind;
			}
			intensity = Math.max(intensity, INTENSITY[g.intensity]) as 0 | 1 | 2 | 3;
		}
		if (g.descriptor === 'SH') showers = true;
		if (g.descriptor === 'TS') thunder = true;
		if (g.descriptor === 'FZ') freezing = true;
		if (g.obscuration === 'FG') fog = Math.max(fog, 0.9);
		else if (g.obscuration === 'BR') fog = Math.max(fog, 0.45);
		else if (g.obscuration) {
			fog = Math.max(fog, 0.35);
			fogTint = 'warm';
		}
	}

	// A low visibility without a code (or a partial one) still hazes the scene.
	const vis = m.visibility_m;
	if (vis != null) {
		const byVis = vis < 1000 ? 0.85 : vis < 2000 ? 0.55 : vis < 5000 ? 0.3 : vis < 8000 ? 0.12 : 0;
		fog = Math.max(fog, byVis);
	}

	const wind = m.wind;
	const dir = wind?.dir ?? null;
	const speed = wind?.speed ?? 0;
	const windFromDeg = wind?.variable || dir == null || dir === 0 || speed === 0 ? null : dir;
	const tempC = m.temp ?? null;

	return {
		layers: layersOf(m),
		precip,
		intensity,
		showers,
		vicinity,
		thunder,
		fog,
		fogTint,
		windFromDeg,
		windKt: speed,
		gustKt: wind?.gust ?? null,
		tempC,
		freezing: freezing || (tempC != null && tempC <= 0)
	};
}

/**
 * Which way things drift across a scene that looks SOUTH from the station
 * (east on the left, west on the right): -1 = leftwards, +1 = rightwards.
 * A westerly moves air eastward, i.e. to the left. Calm / variable defaults
 * to a gentle leftward drift.
 */
export function driftDirection(windFromDeg: number | null): -1 | 1 {
	if (windFromDeg == null) return -1;
	const toward = (windFromDeg + 180) % 360;
	return Math.sin((toward * Math.PI) / 180) >= -1e-6 ? -1 : 1;
}

// --- summaries & formatting --------------------------------------------------

const SKY_HEADLINE: Record<string, string> = {
	cavok: 'CAVOK',
	clear: 'Clear skies',
	few: 'Fair',
	scattered: 'Partly cloudy',
	broken: 'Mostly cloudy',
	overcast: 'Overcast',
	obscured: 'Sky obscured',
	unknown: 'No significant weather'
};
const COVER_WORD: Record<string, string> = {
	FEW: 'Few',
	SCT: 'Scattered',
	BKN: 'Broken',
	OVC: 'Overcast',
	VV: 'Vertical vis'
};

function capitalise(s: string): string {
	return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** "Light rain showers", "Mist", "Partly cloudy" … */
export function conditionsHeadline(m: Metar | null | undefined): string {
	if (!m?.available) return 'No report';
	const wx = (m.weather ?? []).map((w) => w.label).filter(Boolean);
	if (wx.length) return capitalise(wx.join(', '));
	return SKY_HEADLINE[m.sky ?? 'unknown'] ?? SKY_HEADLINE.unknown;
}

export function fmtFt(ft: number): string {
	return `${ft.toLocaleString('en-GB')} ft`;
}

/** "Broken 1,200 ft · Overcast 2,500 ft CB", or why there's nothing to list. */
export function skyLine(m: Metar | null | undefined): string {
	if (!m?.available) return '—';
	if (m.cavok) return 'Ceiling and visibility OK';
	const layers = m.cloud_layers ?? [];
	if (!layers.length) return m.sky === 'clear' ? 'No significant cloud' : 'No cloud reported';
	return layers
		.map(
			(l) =>
				`${COVER_WORD[l.cover] ?? l.cover} ${l.base_ft != null ? fmtFt(l.base_ft) : '—'}${l.type ? ` ${l.type}` : ''}`
		)
		.join(' · ');
}

export function fmtVisibility(m: Metar | null | undefined): string {
	if (!m?.available) return '—';
	if (m.cavok) return '10 km+ (CAVOK)';
	const v = m.visibility_m;
	if (v == null) return m.visibility != null ? String(m.visibility) : '—';
	if (v >= 10000) return '10 km+';
	if (v >= 1000) return `${(v / 1000).toFixed(1)} km`;
	return `${v} m`;
}

export function fmtWind(m: Metar | null | undefined): string {
	const w = m?.wind;
	if (!m?.available || !w || w.speed == null) return '—';
	if (w.speed === 0) return 'calm';
	const gust = w.gust ? ` G${w.gust}` : '';
	if (w.variable || w.dir == null || w.dir === 0) return `VRB ${w.speed} kt${gust}`;
	return `${String(w.dir).padStart(3, '0')}° ${w.speed} kt${gust}`;
}

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export function compass16(deg: number): string {
	return POINTS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

/** Minutes since the observation, or null if the time is missing/unparseable. */
export function obsAgeMin(obsTime: string | null | undefined, nowMs: number): number | null {
	if (!obsTime) return null;
	const t = Date.parse(obsTime);
	if (Number.isNaN(t)) return null;
	return Math.max(0, Math.round((nowMs - t) / 60000));
}

export function fmtAge(min: number | null): string {
	if (min == null) return '—';
	if (min < 1) return 'just now';
	if (min < 60) return `${min} min ago`;
	const h = Math.floor(min / 60);
	return `${h} h ${String(min % 60).padStart(2, '0')} ago`;
}

export const CATEGORY_CLASS: Record<string, string> = {
	VFR: 'bg-emerald-500/15 text-emerald-300',
	MVFR: 'bg-sky-500/15 text-sky-300',
	IFR: 'bg-amber-500/15 text-amber-300',
	LIFR: 'bg-red-500/15 text-red-300'
};
export function categoryClass(cat: string | null | undefined): string {
	return (cat && CATEGORY_CLASS[cat]) || 'bg-muted/40 text-muted-foreground';
}

export interface Nearest<T> {
	station: T;
	nm: number;
	bearing: number;
}

/** The station closest to a point, with range (nm) and bearing from that point. */
export function nearestStation<T extends { lat?: number | null; lon?: number | null }>(
	stations: T[],
	lat: number,
	lon: number
): Nearest<T> | null {
	let best: Nearest<T> | null = null;
	for (const s of stations) {
		if (s.lat == null || s.lon == null) continue;
		const nm = haversineNm(lat, lon, s.lat, s.lon);
		if (!best || nm < best.nm) best = { station: s, nm, bearing: bearingTo(lat, lon, s.lat, s.lon) };
	}
	return best;
}
