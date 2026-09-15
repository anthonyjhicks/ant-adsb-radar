import { apiGet, apiUrl } from './client';

export interface AircraftPhoto {
	thumbnail: string | null;
	link: string | null;
	photographer: string | null;
}

// Shared client-side cache (by ICAO hex) so the Spotlight and the scope card
// don't refetch the same aircraft.
export const photoCache = new Map<string, AircraftPhoto>();

export interface PhotoCacheStats {
	hits: number;
	misses: number;
	hit_rate: number | null; // 0..1, or null before any lookups
	cached_aircraft: number;
	bytes_used: number;
	bytes_max: number;
}

export function getPhotoStats(fetchFn: typeof fetch = fetch): Promise<PhotoCacheStats> {
	return apiGet<PhotoCacheStats>('/api/photo/stats', fetchFn);
}

export async function getPhoto(hex: string, fetchFn: typeof fetch = fetch): Promise<AircraftPhoto> {
	const photo = await apiGet<AircraftPhoto>(`/api/photo/${encodeURIComponent(hex)}`, fetchFn);
	// The backend serves the thumbnail from its own disk as a relative path;
	// resolve it to an absolute backend URL so the <img> loads it directly.
	if (photo.thumbnail?.startsWith('/')) {
		photo.thumbnail = apiUrl(photo.thumbnail);
	}
	return photo;
}
