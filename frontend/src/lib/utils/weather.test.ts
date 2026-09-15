import { describe, expect, it } from 'vitest';
import type { Metar } from '$lib/api/metar';
import { RUNWAY_LAYOUTS, layoutGeometry } from '$lib/data/runways';
import {
	CALM_CONDITIONS,
	compass16,
	conditionsHeadline,
	driftDirection,
	fmtAge,
	fmtVisibility,
	fmtWind,
	nearestStation,
	obsAgeMin,
	sceneConditions,
	skyLine
} from './weather';

const showers: Metar = {
	icao: 'EGLL',
	available: true,
	name: 'Heathrow',
	lat: 51.4775,
	lon: -0.4614,
	wind: { dir: 240, speed: 12, gust: 22, variable: false, var_from: 210, var_to: 270 },
	temp: 14,
	dewp: 12,
	visibility_m: 4000,
	cavok: false,
	qnh: 998,
	flight_category: 'MVFR',
	cloud_layers: [
		{ cover: 'OVC', base_ft: 2500, type: 'CB', oktas: 8 },
		{ cover: 'BKN', base_ft: 1200, type: null, oktas: 6 }
	],
	ceiling_ft: 1200,
	sky: 'overcast',
	weather: [
		{
			code: '-SHRA',
			intensity: 'light',
			descriptor: 'SH',
			precip: ['RA'],
			obscuration: null,
			other: null,
			label: 'light rain showers'
		}
	],
	runways: ['27L', '27R'],
	mode: 'Westerly'
};

describe('sceneConditions', () => {
	it('is calm for a missing report', () => {
		expect(sceneConditions(null)).toBe(CALM_CONDITIONS);
		expect(sceneConditions({ icao: 'EGLL', available: false })).toBe(CALM_CONDITIONS);
	});

	it('maps showers, cloud decks and wind', () => {
		const c = sceneConditions(showers);
		expect(c.precip).toBe('rain');
		expect(c.intensity).toBe(1);
		expect(c.showers).toBe(true);
		expect(c.thunder).toBe(false);
		expect(c.windFromDeg).toBe(240);
		expect(c.windKt).toBe(12);
		expect(c.gustKt).toBe(22);
		// Sorted lowest first, cover as a fraction, CB flagged.
		expect(c.layers.map((l) => [l.code, l.baseFt, l.cover, l.cb])).toEqual([
			['BKN', 1200, 0.75, false],
			['OVC', 2500, 1, true]
		]);
		// 4 km visibility hazes the scene a little even without a fog code.
		expect(c.fog).toBeCloseTo(0.3);
		expect(c.fogTint).toBe('grey');
	});

	it('takes the strongest precipitation and merges rain + snow into sleet', () => {
		const wx = (code: string, intensity: 'light' | 'moderate' | 'heavy' | 'vicinity', precip: string[], descriptor: string | null = null) => ({
			code,
			intensity,
			descriptor,
			precip,
			obscuration: null,
			other: null,
			label: code
		});
		const m = (weather: Metar['weather']): Metar => ({ icao: 'X', available: true, weather });
		expect(sceneConditions(m([wx('-RA', 'light', ['RA']), wx('+SN', 'heavy', ['SN'])]))).toMatchObject({
			precip: 'sleet',
			intensity: 3
		});
		expect(sceneConditions(m([wx('RASN', 'moderate', ['RA', 'SN'])])).precip).toBe('sleet');
		expect(sceneConditions(m([wx('+TSGR', 'heavy', ['GR'], 'TS')]))).toMatchObject({
			precip: 'hail',
			intensity: 3,
			thunder: true
		});
		expect(sceneConditions(m([wx('-DZ', 'light', ['DZ'])])).precip).toBe('drizzle');
		// Vicinity showers: nothing falls here, but a cell sits at the edge.
		expect(sceneConditions(m([wx('VCSH', 'vicinity', [], 'SH')]))).toMatchObject({
			precip: 'none',
			intensity: 0,
			vicinity: true
		});
		expect(sceneConditions(m([wx('VCTS', 'vicinity', [], 'TS')])).thunder).toBe(true);
	});

	it('fogs the ground from codes and from visibility, warm for haze', () => {
		const fog: Metar = {
			icao: 'X',
			available: true,
			visibility_m: 300,
			weather: [
				{ code: 'FZFG', intensity: 'moderate', descriptor: 'FZ', precip: [], obscuration: 'FG', other: null, label: 'freezing fog' }
			]
		};
		const c = sceneConditions(fog);
		expect(c.fog).toBe(0.9);
		expect(c.freezing).toBe(true);
		const haze: Metar = {
			icao: 'X',
			available: true,
			visibility_m: 6000,
			weather: [{ code: 'HZ', intensity: 'moderate', descriptor: null, precip: [], obscuration: 'HZ', other: null, label: 'haze' }]
		};
		expect(sceneConditions(haze)).toMatchObject({ fog: 0.35, fogTint: 'warm' });
		expect(sceneConditions({ icao: 'X', available: true, visibility_m: 10000 }).fog).toBe(0);
	});

	it('treats calm and variable winds as directionless', () => {
		expect(sceneConditions({ icao: 'X', available: true, wind: { dir: 0, speed: 0, gust: null, variable: false } }).windFromDeg).toBeNull();
		expect(sceneConditions({ icao: 'X', available: true, wind: { dir: null, speed: 3, gust: null, variable: true } })).toMatchObject({ windFromDeg: null, windKt: 3 });
		expect(sceneConditions({ icao: 'X', available: true, temp: -1 }).freezing).toBe(true);
	});
});

describe('driftDirection', () => {
	it('moves a westerly leftwards (eastward) in the south-facing scene', () => {
		expect(driftDirection(270)).toBe(-1);
		expect(driftDirection(240)).toBe(-1);
		expect(driftDirection(90)).toBe(1);
		expect(driftDirection(120)).toBe(1);
		expect(driftDirection(null)).toBe(-1);
	});
});

describe('summaries', () => {
	it('headline prefers present weather, else the sky', () => {
		expect(conditionsHeadline(showers)).toBe('Light rain showers');
		expect(conditionsHeadline({ icao: 'X', available: true, sky: 'few' })).toBe('Fair');
		expect(conditionsHeadline({ icao: 'X', available: true, sky: 'cavok' })).toBe('CAVOK');
		expect(conditionsHeadline({ icao: 'X', available: true })).toBe('No significant weather');
		expect(conditionsHeadline(null)).toBe('No report');
	});

	it('lists cloud layers with bases', () => {
		expect(skyLine(showers)).toBe('Overcast 2,500 ft CB · Broken 1,200 ft');
		expect(skyLine({ icao: 'X', available: true, cavok: true })).toBe('Ceiling and visibility OK');
		expect(skyLine({ icao: 'X', available: true, sky: 'clear', cloud_layers: [] })).toBe('No significant cloud');
	});

	it('formats visibility in metres / km', () => {
		expect(fmtVisibility(showers)).toBe('4.0 km');
		expect(fmtVisibility({ icao: 'X', available: true, visibility_m: 10000 })).toBe('10 km+');
		expect(fmtVisibility({ icao: 'X', available: true, visibility_m: 300 })).toBe('300 m');
		expect(fmtVisibility({ icao: 'X', available: true, cavok: true })).toBe('10 km+ (CAVOK)');
		expect(fmtVisibility({ icao: 'X', available: true, visibility: '6+' })).toBe('6+');
		expect(fmtVisibility(null)).toBe('—');
	});

	it('formats wind with gusts, calm and variable', () => {
		expect(fmtWind(showers)).toBe('240° 12 kt G22');
		expect(fmtWind({ icao: 'X', available: true, wind: { dir: 0, speed: 0, gust: null, variable: false } })).toBe('calm');
		expect(fmtWind({ icao: 'X', available: true, wind: { dir: null, speed: 3, gust: null, variable: true } })).toBe('VRB 3 kt');
		expect(fmtWind({ icao: 'X', available: true, wind: { dir: 7, speed: 5, gust: null, variable: false } })).toBe('007° 5 kt');
	});

	it('compass points and observation age', () => {
		expect(compass16(0)).toBe('N');
		expect(compass16(236)).toBe('SW');
		expect(compass16(359)).toBe('N');
		const now = Date.parse('2026-09-09T10:32:00Z');
		expect(obsAgeMin('2026-09-09T10:20:00Z', now)).toBe(12);
		expect(obsAgeMin(null, now)).toBeNull();
		expect(obsAgeMin('garbage', now)).toBeNull();
		expect(fmtAge(0)).toBe('just now');
		expect(fmtAge(12)).toBe('12 min ago');
		expect(fmtAge(65)).toBe('1 h 05 ago');
	});
});

describe('nearestStation', () => {
	it('picks the closest station with range and bearing from the receiver', () => {
		const stations = [
			{ icao: 'EGLL', lat: 51.4775, lon: -0.4614 },
			{ icao: 'EGKK', lat: 51.1481, lon: -0.1903 },
			{ icao: 'EGLC', lat: 51.5053, lon: 0.0553 },
			{ icao: 'NOPE', lat: null, lon: null }
		];
		// A receiver in west London: Heathrow is nearest, to the west, ~9 nm.
		const n = nearestStation(stations, 51.46, -0.22);
		expect(n?.station.icao).toBe('EGLL');
		expect(n?.nm).toBeGreaterThan(8);
		expect(n?.nm).toBeLessThan(12);
		expect(compass16(n!.bearing)).toBe('W');
		expect(nearestStation([{ lat: null, lon: null }], 51, 0)).toBeNull();
	});
});

describe('layoutGeometry', () => {
	it('lays runways out north-up with the approach outward from each end', () => {
		const [north, south] = layoutGeometry(RUNWAY_LAYOUTS.EGLL, 78);
		// East–west runways: level lines, the 09 end on the left (west).
		expect(north.y1).toBeCloseTo(north.y2);
		expect(north.x1).toBeLessThan(north.x2);
		expect(north.ends[0].name).toBe('09L');
		expect(north.ends[0].ox).toBeCloseTo(-1); // approach to 09L comes from the west
		expect(north.ends[1].name).toBe('27R');
		expect(north.ends[1].ox).toBeCloseTo(1);
		// The northern runway sits above (smaller y) the southern one.
		expect(north.y1).toBeLessThan(south.y1);
		// Everything fits inside the radius.
		for (const s of [north, south]) {
			for (const [x, y] of [[s.x1, s.y1], [s.x2, s.y2]]) expect(Math.hypot(x, y)).toBeLessThanOrEqual(78.01);
		}
		const [stn] = layoutGeometry(RUNWAY_LAYOUTS.EGSS, 78);
		expect(stn.ends[0].name).toBe('04');
		expect(stn.ends[0].oy).toBeGreaterThan(0); // approach to 04 comes from the south-west (below)
		expect(layoutGeometry(RUNWAY_LAYOUTS.EGKK)[1].standby).toBe(true);
	});
});
