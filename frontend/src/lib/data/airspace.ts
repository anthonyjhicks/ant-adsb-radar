// Approximate control zones around the busiest London airports, drawn as
// circles on the scope for spatial context (not exact CTR boundaries).
export interface Airspace {
	label: string;
	lat: number;
	lon: number;
	radiusNm: number;
}

export const AIRSPACE: Airspace[] = [
	{ label: 'LHR', lat: 51.47, lon: -0.4543, radiusNm: 6 },
	{ label: 'LGW', lat: 51.1537, lon: -0.1821, radiusNm: 5 },
	{ label: 'STN', lat: 51.885, lon: 0.235, radiusNm: 5 },
	{ label: 'LCY', lat: 51.5053, lon: 0.0553, radiusNm: 3 }
];
