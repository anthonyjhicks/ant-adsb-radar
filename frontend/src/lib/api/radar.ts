import { apiGet } from './client';
import type { RadarSnapshot, RadarStats } from '$lib/types/radar';

export function getSnapshot(fetchFn: typeof fetch = fetch): Promise<RadarSnapshot> {
	return apiGet<RadarSnapshot>('/api/radar/snapshot', fetchFn);
}

export function getStats(fetchFn: typeof fetch = fetch): Promise<RadarStats> {
	return apiGet<RadarStats>('/api/radar/stats', fetchFn);
}
