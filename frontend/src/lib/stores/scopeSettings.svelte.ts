import { browser } from '$app/environment';

// Toggleable scope layers, shared across both scope panels and persisted to
// localStorage. All default on (the full radar look).
const KEY = 'ant-adsb-radar.scope';

export type ScopeLayer =
	| 'map'
	| 'airports'
	| 'airspace'
	| 'rings'
	| 'coverage'
	| 'sweep'
	| 'trails'
	| 'vectors'
	| 'labels';

// Order + labels for the on-screen toggle chips.
export const SCOPE_LAYERS: { key: ScopeLayer; label: string }[] = [
	{ key: 'map', label: 'Map' },
	{ key: 'airports', label: 'Airports' },
	{ key: 'airspace', label: 'Airspace' },
	{ key: 'rings', label: 'Rings' },
	{ key: 'coverage', label: 'Coverage' },
	{ key: 'sweep', label: 'Sweep' },
	{ key: 'trails', label: 'Trails' },
	{ key: 'vectors', label: 'Vectors' },
	{ key: 'labels', label: 'Labels' }
];

class ScopeSettings {
	layers = $state<Record<ScopeLayer, boolean>>({
		map: true,
		airports: true,
		airspace: true,
		rings: true,
		coverage: true,
		sweep: true,
		trails: true,
		vectors: true,
		labels: true
	});

	/** Load persisted prefs (call once on mount). */
	init() {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(KEY);
			if (raw) {
				const v = JSON.parse(raw);
				for (const k of Object.keys(this.layers) as ScopeLayer[]) {
					if (typeof v[k] === 'boolean') this.layers[k] = v[k];
				}
			}
		} catch {
			// ignore
		}
	}

	#save() {
		if (!browser) return;
		try {
			localStorage.setItem(KEY, JSON.stringify(this.layers));
		} catch {
			// ignore
		}
	}

	toggle(key: ScopeLayer) {
		this.layers[key] = !this.layers[key];
		this.#save();
	}

	set(key: ScopeLayer, value: boolean) {
		this.layers[key] = value;
		this.#save();
	}
}

export const scopeSettings = new ScopeSettings();
