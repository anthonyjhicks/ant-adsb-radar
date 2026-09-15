// Scope geometry + altitude coloring for the PPI radar.

export interface XY {
	x: number;
	y: number;
}

/**
 * Project a contact onto the scope from its bearing (deg true, clockwise from
 * north) and distance (nm), given the scope center and scale. North is up.
 */
export function polarToXY(
	bearingDeg: number,
	distNm: number,
	cx: number,
	cy: number,
	pxPerNm: number
): XY {
	const rad = (bearingDeg * Math.PI) / 180;
	const r = distNm * pxPerNm;
	return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}

/**
 * Project a geographic point (lat/lon) onto the scope using a flat
 * equirectangular approximation centered on the receiver. Consistent with the
 * blip placement at scope ranges (≤~240nm), where curvature is negligible.
 */
export function geoToXY(
	lat: number,
	lon: number,
	rxLat: number,
	rxLon: number,
	cx: number,
	cy: number,
	pxPerNm: number
): XY {
	const northNm = (lat - rxLat) * 60;
	const eastNm = (lon - rxLon) * 60 * Math.cos((rxLat * Math.PI) / 180);
	return { x: cx + eastNm * pxPerNm, y: cy - northNm * pxPerNm };
}

/** Endpoint of a velocity leader line: `minutesAhead` of travel along `track`. */
export function leaderEnd(
	from: XY,
	trackDeg: number,
	gsKt: number,
	pxPerNm: number,
	minutesAhead = 1
): XY {
	const distNm = (gsKt / 60) * minutesAhead;
	const rad = (trackDeg * Math.PI) / 180;
	const r = distNm * pxPerNm;
	return { x: from.x + r * Math.sin(rad), y: from.y - r * Math.cos(rad) };
}

/** Sample `n+1` points along the great-circle between two lat/lon points. */
export function greatCircle(
	lat1: number,
	lon1: number,
	lat2: number,
	lon2: number,
	n = 64
): [number, number][] {
	const φ1 = (lat1 * Math.PI) / 180;
	const λ1 = (lon1 * Math.PI) / 180;
	const φ2 = (lat2 * Math.PI) / 180;
	const λ2 = (lon2 * Math.PI) / 180;
	const d =
		2 *
		Math.asin(
			Math.sqrt(
				Math.sin((φ2 - φ1) / 2) ** 2 +
					Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2
			)
		);
	if (d === 0) return [[lat1, lon1]];
	const pts: [number, number][] = [];
	for (let i = 0; i <= n; i++) {
		const f = i / n;
		const A = Math.sin((1 - f) * d) / Math.sin(d);
		const B = Math.sin(f * d) / Math.sin(d);
		const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
		const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
		const z = A * Math.sin(φ1) + B * Math.sin(φ2);
		const φ = Math.atan2(z, Math.sqrt(x * x + y * y));
		const λ = Math.atan2(y, x);
		pts.push([(φ * 180) / Math.PI, (λ * 180) / Math.PI]);
	}
	return pts;
}

/** Great-circle distance between two lat/lon points, in nautical miles. */
export function haversineNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
	const R = 3440.065; // Earth radius in nm
	const φ1 = (lat1 * Math.PI) / 180;
	const φ2 = (lat2 * Math.PI) / 180;
	const dφ = ((lat2 - lat1) * Math.PI) / 180;
	const dλ = ((lon2 - lon1) * Math.PI) / 180;
	const a = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
	return R * 2 * Math.asin(Math.sqrt(a));
}

/** Initial great-circle bearing from point 1 to point 2, degrees true (0..360). */
export function bearingTo(lat1: number, lon1: number, lat2: number, lon2: number): number {
	const φ1 = (lat1 * Math.PI) / 180;
	const φ2 = (lat2 * Math.PI) / 180;
	const dλ = ((lon2 - lon1) * Math.PI) / 180;
	const y = Math.sin(dλ) * Math.cos(φ2);
	const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
	return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export interface RouteProgress {
	totalNm: number; // origin → destination great-circle length
	flownNm: number; // origin → current position
	remainingNm: number; // current position → destination
	pct: number; // 0..100, clamped
	bearingToDest: number; // degrees true from current position
	etaMin: number | null; // minutes to destination at ground speed, if known
}

/**
 * How far along its origin→destination great circle a contact is. Uses the sum
 * of the two legs (origin→now, now→dest) as the denominator so a contact off
 * the direct track — vectored, holding — still reads sensibly rather than >100%.
 */
export function routeProgress(
	oLat: number,
	oLon: number,
	cLat: number,
	cLon: number,
	dLat: number,
	dLon: number,
	gsKt: number | null
): RouteProgress {
	const flownNm = haversineNm(oLat, oLon, cLat, cLon);
	const remainingNm = haversineNm(cLat, cLon, dLat, dLon);
	const totalNm = haversineNm(oLat, oLon, dLat, dLon);
	const denom = flownNm + remainingNm;
	const pct = denom > 0 ? Math.min(100, Math.max(0, (flownNm / denom) * 100)) : 0;
	const etaMin = gsKt && gsKt > 30 ? (remainingNm / gsKt) * 60 : null;
	return {
		totalNm,
		flownNm,
		remainingNm,
		pct,
		bearingToDest: bearingTo(cLat, cLon, dLat, dLon),
		etaMin
	};
}

export interface CPA {
	minutes: number; // time to closest point of approach (negative = already past)
	distanceNm: number; // range to station at that closest point
	approaching: boolean; // still inbound (CPA is in the future)
}

/**
 * Closest point of approach of a contact to the receiver, assuming it holds its
 * current ground track and speed (straight-line extrapolation in a local
 * flat-earth frame — fine at scope ranges). Returns null without a position/
 * velocity to work from.
 */
export function cpaToStation(
	rxLat: number,
	rxLon: number,
	acLat: number,
	acLon: number,
	gsKt: number | null,
	trackDeg: number | null
): CPA | null {
	if (gsKt == null || gsKt <= 0 || trackDeg == null) return null;
	// Position of aircraft relative to station, in nm (east, north).
	const east = (acLon - rxLon) * 60 * Math.cos((rxLat * Math.PI) / 180);
	const north = (acLat - rxLat) * 60;
	// Velocity in nm/hr (knots), decomposed from the true track.
	const rad = (trackDeg * Math.PI) / 180;
	const vEast = gsKt * Math.sin(rad);
	const vNorth = gsKt * Math.cos(rad);
	const vv = vEast * vEast + vNorth * vNorth;
	if (vv === 0) return null;
	// t* minimises |r + v·t|; hours, then to minutes.
	const tHr = -(east * vEast + north * vNorth) / vv;
	const cx = east + vEast * tHr;
	const cy = north + vNorth * tHr;
	return {
		minutes: tHr * 60,
		distanceNm: Math.hypot(cx, cy),
		approaching: tHr > 0
	};
}

/** CSS color (custom property reference) for an altitude band. */
export function altColor(
	flightLevel: number | null,
	onGround: boolean,
	emergency: boolean
): string {
	if (emergency) return 'var(--alt-emergency)';
	if (onGround || flightLevel === null) return 'var(--alt-ground)';
	if (flightLevel < 100) return 'var(--alt-low)';
	if (flightLevel < 250) return 'var(--alt-mid)';
	return 'var(--alt-high)';
}

/** Nice round range-ring values (nm) that fit within `maxNm`. */
export function ringValues(maxNm: number): number[] {
	const candidates = [5, 10, 20, 40, 80, 120, 160, 240];
	const rings = candidates.filter((r) => r <= maxNm);
	if (rings.length === 0) return [Math.round(maxNm)];
	// Ensure the outer ring is at/above max so everything fits.
	if (rings[rings.length - 1] < maxNm) {
		const next = candidates.find((r) => r > maxNm);
		if (next) rings.push(next);
	}
	return rings;
}

export const COMPASS_POINTS = [
	{ deg: 0, label: 'N' },
	{ deg: 45, label: '045' },
	{ deg: 90, label: 'E' },
	{ deg: 135, label: '135' },
	{ deg: 180, label: 'S' },
	{ deg: 225, label: '225' },
	{ deg: 270, label: 'W' },
	{ deg: 315, label: '315' }
];

/** Format a bearing as a 3-digit heading string, e.g. 7 -> "007". */
export function fmtBearing(deg: number | null): string {
	if (deg === null || deg === undefined) return '---';
	return String(Math.round(deg) % 360).padStart(3, '0');
}
