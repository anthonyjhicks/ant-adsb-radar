import { apiGet } from './client';

// adsbdb's static airframe record — complements the Mictronics enrichment on
// the live snapshot with owner/manufacturer/country detail.
export interface AircraftDetails {
	manufacturer: string | null;
	type: string | null;
	icao_type: string | null;
	owner: string | null; // registered owner (often richer than the callsign operator)
	owner_country: string | null;
	owner_country_iso: string | null;
	flag_code: string | null; // operator flag code
	photo: string | null; // planespotters thumbnail URL (we serve our own proxy separately)
}

// Shared client-side cache by ICAO hex.
export const aircraftCache = new Map<string, AircraftDetails>();

export function getAircraft(hex: string, fetchFn: typeof fetch = fetch): Promise<AircraftDetails> {
	const key = hex.replace(/^~/, '').toUpperCase();
	return apiGet<AircraftDetails>(`/api/aircraft/${encodeURIComponent(key)}`, fetchFn);
}
