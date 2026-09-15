// Major airports near the receiver (SW London). Projected onto the scope and
// clipped to the visible range — regional fields only show on the wide scope.
export interface Airport {
	code: string;
	name: string;
	lat: number;
	lon: number;
}

export const AIRPORTS: Airport[] = [
	// London terminal area
	{ code: 'LHR', name: 'Heathrow', lat: 51.47, lon: -0.4543 },
	{ code: 'LGW', name: 'Gatwick', lat: 51.1537, lon: -0.1821 },
	{ code: 'LCY', name: 'London City', lat: 51.5053, lon: 0.0553 },
	{ code: 'STN', name: 'Stansted', lat: 51.885, lon: 0.235 },
	{ code: 'LTN', name: 'Luton', lat: 51.8747, lon: -0.3683 },
	{ code: 'SEN', name: 'Southend', lat: 51.5714, lon: 0.6956 },
	{ code: 'BQH', name: 'Biggin Hill', lat: 51.3307, lon: 0.0325 },
	{ code: 'FAB', name: 'Farnborough', lat: 51.2758, lon: -0.7763 },
	{ code: 'NHT', name: 'Northolt', lat: 51.553, lon: -0.4181 },
	// Regional (wide scope)
	{ code: 'ESH', name: 'Shoreham', lat: 50.8356, lon: -0.2972 },
	{ code: 'LYX', name: 'Lydd', lat: 50.9561, lon: 0.9394 },
	{ code: 'BHX', name: 'Birmingham', lat: 52.4539, lon: -1.748 },
	{ code: 'BRS', name: 'Bristol', lat: 51.3827, lon: -2.7191 },
	{ code: 'NWI', name: 'Norwich', lat: 52.6758, lon: 1.2828 },
	{ code: 'BOH', name: 'Bournemouth', lat: 50.78, lon: -1.8425 },
	{ code: 'CBG', name: 'Cambridge', lat: 52.205, lon: 0.175 }
];
