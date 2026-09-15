import { sseConnection } from '$lib/stores/sse.svelte';
import type { RadarSnapshot, RadarStats } from '$lib/types/radar';

const RATE_HISTORY_LEN = 120; // ~2 min at 1Hz
const TRAIL_LEN = 40; // points kept per aircraft (~40s of history)

export type TrailPoint = { lat: number; lon: number };

class RadarStore {
	snapshot = $state<RadarSnapshot | null>(null);
	stats = $state<RadarStats | null>(null);

	// Rolling message-rate history for the stats sparkline.
	rateHistory = $state<number[]>([]);

	// Per-hex position history for scope track trails, accumulated from the ~1Hz
	// updates (readsb's own history is empty here). Plain Map — read each render.
	trails = new Map<string, TrailPoint[]>();

	constructor() {
		sseConnection.on('radar', (data) => {
			const snap = data as RadarSnapshot;
			this.snapshot = snap;
			const rate = snap.messages_per_sec ?? 0;
			this.rateHistory = [...this.rateHistory, rate].slice(-RATE_HISTORY_LEN);
			this.#accumulateTrails(snap);
		});
		sseConnection.on('stats', (data) => {
			this.stats = data as RadarStats;
		});
	}

	#accumulateTrails(snap: RadarSnapshot) {
		const present = new Set<string>();
		for (const a of snap.aircraft) {
			if (a.lat == null || a.lon == null) continue;
			present.add(a.hex);
			const trail = this.trails.get(a.hex) ?? [];
			const last = trail[trail.length - 1];
			// Skip duplicate consecutive positions.
			if (!last || last.lat !== a.lat || last.lon !== a.lon) {
				trail.push({ lat: a.lat, lon: a.lon });
				if (trail.length > TRAIL_LEN) trail.shift();
				this.trails.set(a.hex, trail);
			}
		}
		// Drop trails for aircraft no longer tracked.
		for (const hex of this.trails.keys()) {
			if (!present.has(hex)) this.trails.delete(hex);
		}
	}

	hydrate(snapshot: RadarSnapshot | null, stats: RadarStats | null) {
		if (snapshot && !this.snapshot) this.snapshot = snapshot;
		if (stats && !this.stats) this.stats = stats;
	}
}

export const radarStore = new RadarStore();
