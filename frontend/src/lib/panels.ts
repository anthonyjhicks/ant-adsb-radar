import type { Component } from 'svelte';
import PanelScope from '$lib/components/panels/PanelScope.svelte';
import PanelStrips from '$lib/components/panels/PanelStrips.svelte';
import PanelSpotlight from '$lib/components/panels/PanelSpotlight.svelte';
import PanelAltitude from '$lib/components/panels/PanelAltitude.svelte';
import PanelAirspace3D from '$lib/components/panels/PanelAirspace3D.svelte';
import PanelFleet from '$lib/components/panels/PanelFleet.svelte';
import PanelWatch from '$lib/components/panels/PanelWatch.svelte';
import PanelMovers from '$lib/components/panels/PanelMovers.svelte';
import PanelMetar from '$lib/components/panels/PanelMetar.svelte';
import PanelStats from '$lib/components/panels/PanelStats.svelte';
import PanelNewToday from '$lib/components/panels/PanelNewToday.svelte';
import PanelInteresting from '$lib/components/panels/PanelInteresting.svelte';
import PanelTrends from '$lib/components/panels/PanelTrends.svelte';
import PanelCoverage from '$lib/components/panels/PanelCoverage.svelte';
import PanelPhotos from '$lib/components/panels/PanelPhotos.svelte';
import PanelSignal from '$lib/components/panels/PanelSignal.svelte';
import PanelTrackRose from '$lib/components/panels/PanelTrackRose.svelte';
import PanelLifelist from '$lib/components/panels/PanelLifelist.svelte';
import PanelDaylight from '$lib/components/panels/PanelDaylight.svelte';
import {
	DEFAULT_STATION,
	MAX_HOME_NM,
	MAX_LOCAL_NM,
	MIN_HOME_NM,
	MIN_LOCAL_NM,
	type StationConfig
} from '$lib/api/config';

export type Accent = 'emerald' | 'cyan' | 'amber' | 'violet' | 'sky' | 'red';

/**
 * The one panel with behaviour beyond the rotation: a new emergency squawk
 * jumps the kiosk to it. Named here so the kiosk and the config page agree on
 * which view that is (hiding it costs the auto-jump, not the klaxon).
 */
export const EMERGENCY_PANEL_ID = 'watch';

/**
 * Dwell bounds in milliseconds, for the /config editor and as a guard on what
 * comes back from the backend. Mirrored in backend/app/services/panel_config.py
 * — keep them in step.
 */
export const MIN_DWELL_MS = 3_000;
export const MAX_DWELL_MS = 600_000;

export type PanelGroup =
	| 'Scopes'
	| 'Live tactical'
	| 'Live instruments'
	| 'Durable history'
	| 'Environment'
	| 'Receiver stats';

export interface Panel {
	/** Stable slug — used by ?view=, and the id persisted in the saved order. */
	id: string;
	name: string;
	/** Any panel component; each carries its own prop shape via `props`. */
	component: Component<any>;
	accent: Accent;
	/** Dwell time in ms before the rotation advances. */
	ms: number;
	group: PanelGroup;
	props: Record<string, unknown>;
}

// The default rotation. Users can reorder it from /config (persisted on the
// backend); this array stays the source of truth for which views *exist*, their
// dwell times, and where a brand-new view lands before anyone reorders it.
//
// The scopes are the centrepiece, so they get the longest dwell. The local
// scope (position 2) is locked to a fixed range — 40 nm by default, enough to
// cover a terminal area's airports — with type designators on tags. The home
// scope (position 3) zooms right in — 10 nm by default — to just the traffic
// overhead the station. Both ranges, the local scope's label and the weather
// view's airports come from the station settings at /config (applyStation);
// the values here are the fallbacks when nothing has been saved.
export const PANELS: Panel[] = [
	// Scopes — the plan-position centrepieces (longest dwell).
	{ id: 'scope', name: 'Radar Scope', component: PanelScope, accent: 'emerald', ms: 20_000, group: 'Scopes', props: {} },
	{
		id: 'local',
		name: localScopeName(DEFAULT_STATION),
		component: PanelScope,
		accent: 'emerald',
		ms: 18_000,
		group: 'Scopes',
		props: { fixedNm: DEFAULT_STATION.local_nm, showType: true, hideCoverage: true }
	},
	{
		id: 'home',
		name: 'Local · Home',
		component: PanelScope,
		accent: 'emerald',
		ms: 16_000,
		group: 'Scopes',
		props: { fixedNm: DEFAULT_STATION.home_nm, showType: true, hideCoverage: true }
	},
	{ id: 'airspace3d', name: '3D Airspace', component: PanelAirspace3D, accent: 'sky', ms: 18_000, group: 'Scopes', props: {} },

	// Live tactical — who's out there right now.
	{ id: 'strips', name: 'Flight Strips', component: PanelStrips, accent: 'cyan', ms: 16_000, group: 'Live tactical', props: {} },
	{ id: 'spotlight', name: 'Closest Aircraft', component: PanelSpotlight, accent: 'amber', ms: 14_000, group: 'Live tactical', props: {} },
	{ id: 'photos', name: 'Spotter Photos', component: PanelPhotos, accent: 'amber', ms: 24_000, group: 'Live tactical', props: {} },
	{ id: 'interesting', name: 'Interesting Airframes', component: PanelInteresting, accent: 'amber', ms: 14_000, group: 'Live tactical', props: {} },
	{ id: 'movers', name: 'Movers & Extremes', component: PanelMovers, accent: 'cyan', ms: 14_000, group: 'Live tactical', props: {} },
	{ id: 'watch', name: 'Emergency Watch', component: PanelWatch, accent: 'red', ms: 12_000, group: 'Live tactical', props: {} },

	// Live instruments — analytics computed from the current snapshot.
	{ id: 'altitude', name: 'Altitude Profile', component: PanelAltitude, accent: 'sky', ms: 16_000, group: 'Live instruments', props: {} },
	{ id: 'signal', name: 'Signal vs Range', component: PanelSignal, accent: 'emerald', ms: 14_000, group: 'Live instruments', props: {} },
	{ id: 'trackrose', name: 'Heading Rose', component: PanelTrackRose, accent: 'cyan', ms: 14_000, group: 'Live instruments', props: {} },
	{ id: 'fleet', name: 'Fleet & Operators', component: PanelFleet, accent: 'violet', ms: 14_000, group: 'Live instruments', props: {} },

	// Durable history & trends — from the on-disk SQLite rollup.
	{ id: 'newtoday', name: 'First Seen Today', component: PanelNewToday, accent: 'cyan', ms: 14_000, group: 'Durable history', props: {} },
	{ id: 'trends', name: 'Activity Trends', component: PanelTrends, accent: 'sky', ms: 14_000, group: 'Durable history', props: {} },
	{ id: 'lifelist', name: 'Type-Dex', component: PanelLifelist, accent: 'cyan', ms: 16_000, group: 'Durable history', props: {} },

	// Environment.
	{ id: 'daylight', name: 'Daylight', component: PanelDaylight, accent: 'amber', ms: 14_000, group: 'Environment', props: {} },
	{ id: 'metar', name: 'Weather & Runways', component: PanelMetar, accent: 'sky', ms: 18_000, group: 'Environment', props: { icaos: DEFAULT_STATION.metar_stations } },

	// Receiver & data stats — last.
	{ id: 'coverage', name: 'Coverage & Health', component: PanelCoverage, accent: 'emerald', ms: 14_000, group: 'Receiver stats', props: {} },
	{ id: 'stats', name: 'Signal & Stats', component: PanelStats, accent: 'violet', ms: 14_000, group: 'Receiver stats', props: {} }
];

/** "Local · <label>", or "Local · <n> nm" when the station has no label. */
export function localScopeName(station: Pick<StationConfig, 'local_label' | 'local_nm'>): string {
	const label = station.local_label?.trim();
	return `Local · ${label || `${station.local_nm} nm`}`;
}

function clamp(value: unknown, lo: number, hi: number, fallback: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
	return Math.min(hi, Math.max(lo, Math.round(value)));
}

/**
 * Apply the station settings saved at /config: the fixed-range scopes' ranges
 * (and the wide one's label) and the airports on the weather view.
 *
 * Nothing saved, or an unreachable backend, means the defaults. Values are
 * clamped to the same bounds the backend enforces, since the file is
 * documented as hand-editable and a zero range would collapse the scope.
 */
export function applyStation(
	panels: Panel[],
	station?: Partial<StationConfig> | null
): Panel[] {
	const s: StationConfig = { ...DEFAULT_STATION, ...(station ?? {}) };
	const localNm = clamp(s.local_nm, MIN_LOCAL_NM, MAX_LOCAL_NM, DEFAULT_STATION.local_nm);
	const homeNm = clamp(s.home_nm, MIN_HOME_NM, MAX_HOME_NM, DEFAULT_STATION.home_nm);
	const icaos = Array.isArray(s.metar_stations) && s.metar_stations.length
		? s.metar_stations
		: DEFAULT_STATION.metar_stations;
	return panels.map((p) => {
		switch (p.id) {
			case 'local':
				return {
					...p,
					name: localScopeName({ local_label: s.local_label, local_nm: localNm }),
					props: { ...p.props, fixedNm: localNm }
				};
			case 'home':
				return { ...p, props: { ...p.props, fixedNm: homeNm } };
			case 'metar':
				return { ...p, props: { ...p.props, icaos } };
			default:
				return p;
		}
	});
}

/**
 * Drop the emergency view from a rotation.
 *
 * It isn't a rotation member: the kiosk shows it only while an emergency is
 * live, and holds on it until the emergency clears. Keeping it in the registry
 * (rather than out of PANELS entirely) is what lets `?view=watch` still reach
 * it, and gives it a name and accent like any other view.
 *
 * Guarded like visiblePanels: if it were somehow the only view left, the
 * rotation would be empty, so the input comes back untouched.
 */
export function withoutEmergency(panels: Panel[]): Panel[] {
	const out = panels.filter((p) => p.id !== EMERGENCY_PANEL_ID);
	return out.length ? out : [...panels];
}

/**
 * Apply saved per-view dwell overrides.
 *
 * Only the views actually changed at /config are stored, so a view nobody has
 * touched keeps following the default in the registry — which means changing a
 * default in code still reaches every installation that never overrode it.
 *
 * Entries for unknown views, and values outside the bounds or not finite, are
 * ignored rather than trusted: the file is documented as hand-editable, and a
 * zero or negative dwell would spin the rotation as fast as the tick fires.
 */
export function applyDwell(panels: Panel[], dwell?: Record<string, number> | null): Panel[] {
	if (!dwell) return [...panels];
	return panels.map((p) => {
		const ms = dwell[p.id];
		if (typeof ms !== 'number' || !Number.isFinite(ms)) return p;
		if (ms < MIN_DWELL_MS || ms > MAX_DWELL_MS) return p;
		return ms === p.ms ? p : { ...p, ms };
	});
}

/**
 * Panels still in the rotation once `hidden` ids are removed.
 *
 * Hiding is stored as an opt-out list, so a view added in code after a config
 * was saved is visible by default rather than silently swallowed.
 *
 * Hiding every view is degenerate — a hand-edited file, or a config whose only
 * visible ids have since been deleted from the registry — and would leave the
 * kiosk with nothing to render, so it is treated like "no preference" and the
 * full list comes back. The config page stops you reaching that state from the UI.
 */
export function visiblePanels(panels: Panel[], hidden?: string[] | null): Panel[] {
	if (!hidden?.length) return [...panels];
	const skip = new Set(hidden);
	const out = panels.filter((p) => !skip.has(p.id));
	return out.length ? out : [...panels];
}

/**
 * Merge a saved id order with the built-in registry.
 *
 * The saved config is just a list of ids, so it can drift from the code either
 * way. Ids that no longer exist (a view deleted since the config was saved) are
 * dropped, and views the config has never seen (added since) are spliced back
 * in at their default position, so a new view lands with its group instead of
 * at the end. An empty or missing order means "no preference" — the default
 * order is used as-is.
 *
 * Guarantees, whatever the config holds: every registered panel appears exactly
 * once, and the saved relative order of the ids it does know is preserved.
 */
export function applyOrder(
	order: string[] | null | undefined,
	panels: Panel[] = PANELS
): Panel[] {
	if (!order?.length) return [...panels];

	const byId = new Map(panels.map((p) => [p.id, p]));
	const placed = new Set<string>();
	const out: Panel[] = [];
	for (const id of order) {
		const panel = byId.get(id);
		if (panel && !placed.has(id)) {
			out.push(panel);
			placed.add(id);
		}
	}
	panels.forEach((panel, i) => {
		if (!placed.has(panel.id)) out.splice(Math.min(i, out.length), 0, panel);
	});
	return out;
}
