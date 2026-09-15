// Runway layouts for the Weather & Runways cards: each strip's centre offset
// from the airport reference point (metres east / north), the true heading of
// the first-named end, and its length. Approximate — a schematic for showing
// which ends the wind favours, not a chart. Headings mirror the backend's
// station catalogue (backend/app/routers/metar.py), which does the wind maths.

const RAD = Math.PI / 180;

export interface RunwayStrip {
	/** Designators of the two ends; landing on `ends[0]` means flying `hdg`. */
	ends: [string, string];
	/** True heading (deg) when using ends[0]. */
	hdg: number;
	lengthM: number;
	/** Centre offset from the reference point, metres east / north. */
	x: number;
	y: number;
	/** Drawn thin + dashed: an emergency/standby runway. */
	standby?: boolean;
}

export interface AirportLayout {
	icao: string;
	iata?: string;
	name: string;
	/** A heliport: the one "runway" is its FATO, drawn with a helipad marker. */
	heliport?: boolean;
	runways: RunwayStrip[];
}

export const RUNWAY_LAYOUTS: Record<string, AirportLayout> = {
	EGLL: {
		icao: 'EGLL',
		iata: 'LHR',
		name: 'Heathrow',
		runways: [
			{ ends: ['09L', '27R'], hdg: 90, lengthM: 3902, x: 150, y: 700 },
			{ ends: ['09R', '27L'], hdg: 90, lengthM: 3660, x: -150, y: -715 }
		]
	},
	EGKK: {
		icao: 'EGKK',
		iata: 'LGW',
		name: 'Gatwick',
		runways: [
			{ ends: ['08R', '26L'], hdg: 78, lengthM: 3316, x: 0, y: -100 },
			{ ends: ['08L', '26R'], hdg: 78, lengthM: 2565, x: 0, y: 100, standby: true }
		]
	},
	EGSS: {
		icao: 'EGSS',
		iata: 'STN',
		name: 'Stansted',
		runways: [{ ends: ['04', '22'], hdg: 43, lengthM: 3049, x: 0, y: 0 }]
	},
	EGLC: {
		icao: 'EGLC',
		iata: 'LCY',
		name: 'London City',
		runways: [{ ends: ['09', '27'], hdg: 93, lengthM: 1508, x: 0, y: 0 }]
	},
	EGLW: {
		icao: 'EGLW',
		name: 'London Heliport',
		heliport: true,
		// Battersea: one FATO strip along the Thames; helicopters land into wind on it.
		runways: [{ ends: ['04', '22'], hdg: 35, lengthM: 60, x: 0, y: 0 }]
	},
	EGGW: {
		icao: 'EGGW',
		iata: 'LTN',
		name: 'Luton',
		runways: [{ ends: ['07', '25'], hdg: 75, lengthM: 2162, x: 0, y: 0 }]
	},
	EGLF: {
		icao: 'EGLF',
		iata: 'FAB',
		name: 'Farnborough',
		runways: [{ ends: ['06', '24'], hdg: 61, lengthM: 2440, x: 0, y: 0 }]
	}
};

/** A runway threshold: its position plus the outward unit vector (the approach comes from there). */
export interface EndGeom {
	name: string;
	x: number;
	y: number;
	ox: number;
	oy: number;
}

export interface StripGeom {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	standby: boolean;
	ends: [EndGeom, EndGeom];
}

/**
 * Project a layout into a north-up box of the given radius (SVG units, y down,
 * origin at the reference point), scaled so the furthest runway end just fits.
 */
export function layoutGeometry(layout: AirportLayout, radius = 78): StripGeom[] {
	const extent = Math.max(
		1,
		...layout.runways.map((r) => Math.hypot(r.x, r.y) + r.lengthM / 2)
	);
	const s = radius / extent;
	return layout.runways.map((r) => {
		const dx = Math.sin(r.hdg * RAD);
		const dy = -Math.cos(r.hdg * RAD);
		const cx = r.x * s;
		const cy = -r.y * s;
		const half = (r.lengthM * s) / 2;
		const x1 = cx - dx * half;
		const y1 = cy - dy * half;
		const x2 = cx + dx * half;
		const y2 = cy + dy * half;
		return {
			x1,
			y1,
			x2,
			y2,
			standby: !!r.standby,
			ends: [
				{ name: r.ends[0], x: x1, y: y1, ox: -dx, oy: -dy },
				{ name: r.ends[1], x: x2, y: y2, ox: dx, oy: dy }
			]
		};
	});
}
