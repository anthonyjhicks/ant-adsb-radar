import { apiGet } from './client';

export interface Airport {
	iata: string | null;
	icao: string | null;
	name: string | null;
	city: string | null;
	country: string | null;
	lat: number | null;
	lon: number | null;
	elevation?: number | null; // feet
}

export interface FlightRoute {
	origin: Airport | null;
	midpoint: Airport | null; // scheduled stopover, when the route has one
	destination: Airport | null;
	airline: string | null; // airline name
	airline_icao?: string | null;
	airline_iata?: string | null;
	airline_country?: string | null;
	airline_callsign?: string | null; // R/T telephony, e.g. "SPEEDBIRD"
	flight_iata?: string | null; // e.g. "BA283"
	flight_icao?: string | null; // e.g. "BAW283"
}

// Shared cache by callsign so cards + scope don't refetch the same route.
export const routeCache = new Map<string, FlightRoute>();

export function getRoute(callsign: string, fetchFn: typeof fetch = fetch): Promise<FlightRoute> {
	return apiGet<FlightRoute>(`/api/route/${encodeURIComponent(callsign)}`, fetchFn);
}

const pending = new Set<string>();

/** Fire-and-forget populate of routeCache for a callsign (deduped). */
export function ensureRoute(callsign: string | null | undefined): void {
	const cs = (callsign ?? '').trim();
	if (!cs || routeCache.has(cs) || pending.has(cs)) return;
	pending.add(cs);
	getRoute(cs)
		.then((r) => routeCache.set(cs, r))
		.catch(() => {})
		.finally(() => pending.delete(cs));
}

/** Short label for an airport: IATA preferred, else ICAO, else city/dash. */
export function airportCode(a: Airport | null): string {
	if (!a) return '—';
	return a.iata || a.icao || a.city || '—';
}
