import type { PageLoad } from './$types';
import { getPanelConfig, getStationConfig } from '$lib/api/config';

export const load: PageLoad = async ({ fetch }) => {
	// A backend that's down or has no writable config dir just means "no saved
	// order yet" — the editor opens on the default order rather than erroring.
	// The same goes for the station settings.
	const [config, station] = await Promise.all([
		getPanelConfig(fetch).catch(() => null),
		getStationConfig(fetch).catch(() => null)
	]);
	return { config, station };
};
