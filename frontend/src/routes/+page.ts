import type { PageLoad } from './$types';
import { getSnapshot, getStats } from '$lib/api/radar';
import { getPanelConfig, getStationConfig } from '$lib/api/config';

export const load: PageLoad = async ({ fetch }) => {
	try {
		const [snapshot, stats, config, station] = await Promise.all([
			getSnapshot(fetch).catch(() => null),
			getStats(fetch).catch(() => null),
			// No saved order (or no backend) → the kiosk uses its default order.
			getPanelConfig(fetch).catch(() => null),
			// Likewise the station settings: nothing saved → the built-in defaults.
			getStationConfig(fetch).catch(() => null)
		]);
		return {
			snapshot,
			stats,
			panelOrder: config?.order ?? null,
			panelHidden: config?.hidden ?? null,
			panelDwell: config?.dwell ?? null,
			station
		};
	} catch {
		return {
			snapshot: null,
			stats: null,
			panelOrder: null,
			panelHidden: null,
			panelDwell: null,
			station: null
		};
	}
};
