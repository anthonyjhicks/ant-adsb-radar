<script lang="ts">
	// Configuration: the station (name, position, scope ranges, weather
	// airports) and the rotation — drag (or nudge with the arrow buttons) to set
	// the order the kiosk cycles through its views. Both are saved on the
	// backend rather than in localStorage so the wall display, a phone and a
	// tablet all agree, and so they survive a redeploy.
	import { untrack } from 'svelte';
	import {
		EMERGENCY_PANEL_ID,
		MAX_DWELL_MS,
		MIN_DWELL_MS,
		PANELS,
		applyOrder,
		applyStation,
		type Panel
	} from '$lib/panels';
	import {
		DEFAULT_STATION,
		MAX_HOME_NM,
		MAX_LOCAL_LABEL_LEN,
		MAX_LOCAL_NM,
		MAX_METAR_STATIONS,
		MAX_STATION_NAME_LEN,
		MIN_HOME_NM,
		MIN_LOCAL_NM,
		savePanelConfig,
		saveStationConfig,
		type StationConfig,
		type StationInput
	} from '$lib/api/config';
	import { RUNWAY_LAYOUTS } from '$lib/data/runways';

	let { data } = $props();

	// --- station settings ------------------------------------------------------
	// Its own card and its own Save: the station and the rotation change for
	// different reasons, and neither should hold the other's unsaved edits
	// hostage. Seeded once, like the rotation below.
	const initialStation: StationConfig = untrack(() => ({
		...DEFAULT_STATION,
		...(data.station ?? {})
	}));
	const readsbPos = initialStation.readsb ?? { lat: null, lon: null };
	let stName = $state(initialStation.name);
	let stManual = $state(initialStation.lat != null && initialStation.lon != null);
	let stLat = $state(initialStation.lat != null ? String(initialStation.lat) : '');
	let stLon = $state(initialStation.lon != null ? String(initialStation.lon) : '');
	let stShowCoords = $state(initialStation.show_coords);
	let stLocalLabel = $state(initialStation.local_label);
	let stLocalNm = $state(initialStation.local_nm);
	let stHomeNm = $state(initialStation.home_nm);
	let stMetar = $state(initialStation.metar_stations.join(' '));

	function numberOrNull(text: string): number | null {
		const t = text.trim();
		const v = Number(t);
		return t && Number.isFinite(v) ? v : null;
	}
	const asInput = (s: StationConfig): StationInput => ({
		name: s.name,
		lat: s.lat,
		lon: s.lon,
		show_coords: s.show_coords,
		local_label: s.local_label,
		local_nm: s.local_nm,
		home_nm: s.home_nm,
		metar_stations: s.metar_stations
	});
	let stationPayload = $derived.by(
		(): StationInput => ({
			name: stName.trim(),
			lat: stManual ? numberOrNull(stLat) : null,
			lon: stManual ? numberOrNull(stLon) : null,
			show_coords: stShowCoords,
			local_label: stLocalLabel.trim(),
			local_nm: stLocalNm,
			home_nm: stHomeNm,
			metar_stations: stMetar.toUpperCase().split(/[\s,]+/).filter(Boolean)
		})
	);
	// A client-side check so the Save button can say why it's disabled; the
	// backend validates again and its message is shown if it disagrees.
	let stationProblem = $derived.by((): string | null => {
		const p = stationPayload;
		if (!p.name) return 'Give the station a name';
		if (p.name.length > MAX_STATION_NAME_LEN)
			return `The name is limited to ${MAX_STATION_NAME_LEN} characters`;
		if (stManual) {
			if (p.lat == null || p.lon == null)
				return 'Enter a latitude and longitude, or switch back to automatic';
			if (Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180)
				return 'Latitude runs −90…90 and longitude −180…180';
		}
		if (p.local_label.length > MAX_LOCAL_LABEL_LEN)
			return `The local scope label is limited to ${MAX_LOCAL_LABEL_LEN} characters`;
		if (!Number.isFinite(p.local_nm) || p.local_nm < MIN_LOCAL_NM || p.local_nm > MAX_LOCAL_NM)
			return `The local scope range is ${MIN_LOCAL_NM}–${MAX_LOCAL_NM} nm`;
		if (!Number.isFinite(p.home_nm) || p.home_nm < MIN_HOME_NM || p.home_nm > MAX_HOME_NM)
			return `The home scope range is ${MIN_HOME_NM}–${MAX_HOME_NM} nm`;
		if (p.metar_stations.length > MAX_METAR_STATIONS)
			return `Up to ${MAX_METAR_STATIONS} weather airports`;
		if (p.metar_stations.some((c) => !/^[A-Z0-9]{4}$/.test(c)))
			return 'Weather airports are 4-character ICAO codes (EGLL, KJFK…)';
		if (new Set(p.metar_stations).size !== p.metar_stations.length)
			return 'A weather airport is listed twice';
		return null;
	});
	const stationSig = (p: StationInput) => JSON.stringify(p);
	const DEFAULT_STATION_SIG = stationSig(asInput(DEFAULT_STATION));
	let savedStationSig = $state(stationSig(asInput(initialStation)));
	let stationDirty = $derived(stationSig(stationPayload) !== savedStationSig);
	let stationIsDefault = $derived(stationSig(stationPayload) === DEFAULT_STATION_SIG);
	let stationSaving = $state(false);
	let stationStatus = $state<{ ok: boolean; text: string } | null>(null);

	function seedStation(s: StationConfig) {
		stName = s.name;
		stManual = s.lat != null && s.lon != null;
		stLat = s.lat != null ? String(s.lat) : '';
		stLon = s.lon != null ? String(s.lon) : '';
		stShowCoords = s.show_coords;
		stLocalLabel = s.local_label;
		stLocalNm = s.local_nm;
		stHomeNm = s.home_nm;
		stMetar = s.metar_stations.join(' ');
	}
	async function saveStation() {
		stationSaving = true;
		stationStatus = null;
		try {
			const saved = await saveStationConfig(stationPayload);
			// Re-seed from what the backend kept (it trims text and upper-cases codes).
			seedStation(saved);
			savedStationSig = stationSig(asInput(saved));
			stationStatus = { ok: true, text: 'Saved. The kiosk picks this up next time it loads.' };
		} catch (e) {
			stationStatus = { ok: false, text: e instanceof Error ? e.message : 'Save failed' };
		} finally {
			stationSaving = false;
		}
	}
	function resetStation() {
		seedStation(DEFAULT_STATION);
		stationStatus = null;
	}
	const LAYOUT_CODES = Object.keys(RUNWAY_LAYOUTS).join(' ');
	const INPUT =
		'rounded border border-border/60 bg-background/60 px-2 py-1.5 text-sm normal-case tracking-normal text-foreground transition-colors focus:border-cyan-400/60 focus:outline-none disabled:opacity-40';
	const FIELD = 'flex flex-col gap-1 text-[10px] uppercase tracking-widest text-muted-foreground';

	// --- rotation --------------------------------------------------------------
	// Seeded once, deliberately: this is an editor, so a refresh of the page
	// data must not reset the list under someone's half-finished reorder.
	// The emergency view isn't part of the rotation — the kiosk raises it only
	// while something is squawking — so it isn't orderable, hideable or timed.
	// It's left out of this list entirely and explained in its own card below;
	// applyOrder() splices it back at its registry position on load, where it's
	// then filtered out of the rotation, so its absence here is harmless.
	// The saved station settings are applied so the scope names match the kiosk.
	const REGISTRY = untrack(() => applyStation(PANELS, data.station));
	const ROTATING = REGISTRY.filter((p) => p.id !== EMERGENCY_PANEL_ID);
	const emergencyPanel = REGISTRY.find((p) => p.id === EMERGENCY_PANEL_ID)!;

	const initial = untrack(() =>
		applyOrder(data.config?.order, REGISTRY).filter((p) => p.id !== EMERGENCY_PANEL_ID)
	);
	const initialHidden = untrack(() => new Set(data.config?.hidden ?? []));
	let order = $state<Panel[]>(initial);
	// Hidden ids as a set: the rows render every view either way, greyed out
	// when hidden, so hiding never makes a view hard to find again.
	let hidden = $state<Set<string>>(new Set(initialHidden));
	// Dwell in ms for every view, seeded from the registry default and then the
	// saved override. Held for all views so the editor is a plain lookup; only
	// the ones that differ from the default get saved.
	const seedDwell = () => {
		const saved = untrack(() => data.config?.dwell ?? {});
		return Object.fromEntries(ROTATING.map((p) => [p.id, clampDwell(saved[p.id] ?? p.ms, p.ms)]));
	};
	function clampDwell(ms: unknown, fallback: number): number {
		if (typeof ms !== 'number' || !Number.isFinite(ms)) return fallback;
		return Math.min(MAX_DWELL_MS, Math.max(MIN_DWELL_MS, Math.round(ms)));
	}
	let dwell = $state<Record<string, number>>(seedDwell());

	const DEFAULT_MS = new Map(ROTATING.map((p) => [p.id, p.ms]));
	/** Only the views actually changed — an untouched view keeps following the code. */
	const overrides = (d: Record<string, number>) =>
		Object.fromEntries(Object.entries(d).filter(([id, ms]) => ms !== DEFAULT_MS.get(id)));

	function setDwell(id: string, seconds: number) {
		const fallback = DEFAULT_MS.get(id) ?? MIN_DWELL_MS;
		dwell = { ...dwell, [id]: clampDwell(seconds * 1000, fallback) };
		status = null;
	}

	// One string covering order + hidden, so the unsaved-changes state tracks
	// both. Hidden is sorted so toggling a view off and on again isn't "dirty".
	const signature = (o: Panel[], h: Set<string>, d: Record<string, number>) =>
		[
			o.map((p) => p.id).join(','),
			[...h].sort().join(','),
			Object.entries(overrides(d))
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([id, ms]) => `${id}:${ms}`)
				.join(',')
		].join('|');
	const DEFAULT_SIGNATURE = signature(ROTATING, new Set(), {});

	let savedSignature = $state(signature(initial, initialHidden, untrack(seedDwell)));
	let currentSignature = $derived(signature(order, hidden, dwell));
	let dirty = $derived(currentSignature !== savedSignature);
	let isDefault = $derived(currentSignature === DEFAULT_SIGNATURE);

	let visibleCount = $derived(order.filter((p) => !hidden.has(p.id)).length);
	// The kiosk falls back to showing everything if nothing is visible, so the
	// last remaining view can't be switched off from here.
	let canHideMore = $derived(visibleCount > 1);

	function toggleHidden(id: string) {
		const next = new Set(hidden);
		if (next.has(id)) next.delete(id);
		else if (canHideMore) next.add(id);
		else return;
		hidden = next;
		status = null;
	}

	let saving = $state(false);
	let status = $state<{ ok: boolean; text: string } | null>(null);

	function move(from: number, to: number) {
		if (to < 0 || to >= order.length || from === to) return;
		const next = [...order];
		const [item] = next.splice(from, 1);
		next.splice(to, 0, item);
		order = next;
		status = null;
	}

	function resetToDefault() {
		order = [...ROTATING];
		hidden = new Set();
		dwell = Object.fromEntries(ROTATING.map((p) => [p.id, p.ms]));
		status = null;
	}

	async function save() {
		saving = true;
		status = null;
		try {
			await savePanelConfig(
				order.map((p) => p.id),
				[...hidden],
				overrides(dwell)
			);
			savedSignature = currentSignature;
			status = { ok: true, text: 'Saved. The kiosk picks this up next time it loads.' };
		} catch (e) {
			status = { ok: false, text: e instanceof Error ? e.message : 'Save failed' };
		} finally {
			saving = false;
		}
	}

	// --- drag & drop ---------------------------------------------------------
	// Row-to-row reordering. The arrow buttons do the same job for keyboards and
	// touchscreens, so drag is an enhancement rather than the only way in.
	let dragFrom = $state<number | null>(null);
	let dragOver = $state<number | null>(null);

	function onDragStart(i: number, e: DragEvent) {
		dragFrom = i;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			// Firefox won't start a drag without a payload.
			e.dataTransfer.setData('text/plain', String(i));
		}
	}
	function onDragOver(i: number, e: DragEvent) {
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		dragOver = i;
	}
	function onDrop(i: number, e: DragEvent) {
		e.preventDefault();
		if (dragFrom !== null) move(dragFrom, i);
		dragFrom = null;
		dragOver = null;
	}
	function onDragEnd() {
		dragFrom = null;
		dragOver = null;
	}

	const accentBar: Record<string, string> = {
		emerald: 'bg-emerald-400',
		cyan: 'bg-cyan-400',
		amber: 'bg-amber-400',
		violet: 'bg-violet-400',
		sky: 'bg-sky-400',
		red: 'bg-red-400'
	};

	// Only views still in the rotation contribute to the cycle length.
	let totalMs = $derived(
		order.reduce((sum, p) => (hidden.has(p.id) ? sum : sum + (dwell[p.id] ?? p.ms)), 0)
	);
	function mmss(ms: number): string {
		const s = Math.round(ms / 1000);
		return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
	}
</script>

<svelte:head><title>Config · {initialStation.name}</title></svelte:head>

<!-- The kiosk pins the body (overflow: hidden) for its fixed stage, so this page
     scrolls inside its own full-height container; the sticky header and save
     bar stick to that container's edges. -->
<div
	class="h-dvh w-full overflow-y-auto font-mono text-foreground"
	style="background: radial-gradient(ellipse at top, oklch(0.18 0.02 220) 0%, oklch(0.12 0.015 240) 70%, oklch(0.1 0.01 250) 100%);"
>
	<header
		class="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border/40 bg-background/80 px-6 py-3 backdrop-blur max-lg:px-3"
	>
		<div class="flex items-baseline gap-4">
			<span class="text-xs uppercase tracking-[0.3em] text-muted-foreground">{initialStation.name}</span>
			<h1 class="text-sm uppercase tracking-widest text-cyan-300">Configuration</h1>
		</div>
		<a
			href="/"
			class="rounded border border-border/60 px-3 py-1.5 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-cyan-400/60 hover:text-cyan-300"
		>
			← Back to kiosk
		</a>
	</header>

	<main class="mx-auto max-w-4xl px-6 py-8 max-lg:px-3 max-lg:py-4">
		<section class="mb-10">
			<h2 class="text-[11px] uppercase tracking-[0.3em] text-cyan-300">Station</h2>
			<p class="mt-1 text-xs leading-relaxed text-muted-foreground">
				What this kiosk calls itself and where it is. The receiver position normally comes
				from readsb; set it by hand if readsb has none, or to show a deliberately rounded
				location — range and bearing to every contact are then computed from what you
				enter. The two local scopes are fixed-range views around the station, and the
				weather view shows a runway card per airport listed. Saved on the receiver, like
				the rotation below.
			</p>

			<div
				class="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 rounded border border-border/40 bg-background/40 p-4 max-lg:grid-cols-1"
			>
				<label class={FIELD}>
					Station name
					<input type="text" bind:value={stName} maxlength={MAX_STATION_NAME_LEN} class={INPUT} />
				</label>
				<label class="flex items-center gap-2 self-end pb-2 text-[10px] uppercase tracking-widest text-muted-foreground">
					<input type="checkbox" bind:checked={stShowCoords} class="accent-cyan-400" />
					Show coordinates in the kiosk header
				</label>

				<fieldset class="col-span-2 flex flex-col gap-2 max-lg:col-span-1">
					<legend class="text-[10px] uppercase tracking-widest text-muted-foreground">Receiver position</legend>
					<label class="flex items-center gap-2 text-xs">
						<input type="radio" bind:group={stManual} value={false} class="accent-cyan-400" />
						<span>
							From readsb
							{#if readsbPos.lat != null && readsbPos.lon != null}
								<span class="text-muted-foreground">
									(currently {readsbPos.lat.toFixed(3)}°, {readsbPos.lon.toFixed(3)}°)
								</span>
							{:else}
								<span class="text-amber-300">(readsb reports no position — set one below)</span>
							{/if}
						</span>
					</label>
					<label class="flex items-center gap-2 text-xs">
						<input type="radio" bind:group={stManual} value={true} class="accent-cyan-400" />
						Manual
					</label>
					<div class="ml-6 flex gap-4 max-lg:flex-col">
						<label class={FIELD}>
							Latitude
							<input type="text" inputmode="decimal" bind:value={stLat} disabled={!stManual} placeholder="51.5000" class="{INPUT} w-36" />
						</label>
						<label class={FIELD}>
							Longitude
							<input type="text" inputmode="decimal" bind:value={stLon} disabled={!stManual} placeholder="-0.1200" class="{INPUT} w-36" />
						</label>
					</div>
				</fieldset>

				<label class={FIELD}>
					Local scope label
					<input type="text" bind:value={stLocalLabel} maxlength={MAX_LOCAL_LABEL_LEN} placeholder="e.g. London → “Local · London”" class={INPUT} />
				</label>
				<div class="flex gap-4">
					<label class={FIELD}>
						Local range (nm)
						<input type="number" bind:value={stLocalNm} min={MIN_LOCAL_NM} max={MAX_LOCAL_NM} step="1" class="{INPUT} w-24 text-right tabular-nums" />
					</label>
					<label class={FIELD}>
						Home range (nm)
						<input type="number" bind:value={stHomeNm} min={MIN_HOME_NM} max={MAX_HOME_NM} step="1" class="{INPUT} w-24 text-right tabular-nums" />
					</label>
				</div>

				<label class="{FIELD} col-span-2 max-lg:col-span-1">
					Weather airports (ICAO codes, up to {MAX_METAR_STATIONS})
					<input type="text" bind:value={stMetar} placeholder="EGLL EGKK EGLW EGLC" class={INPUT} />
					<span class="normal-case tracking-normal text-muted-foreground/70">
						Runway schematics are built in for {LAYOUT_CODES}; any other airport gets its weather
						without a diagram (add a layout in frontend/src/lib/data/runways.ts and the backend
						station catalogue).
					</span>
				</label>
			</div>

			<div class="mt-3 flex items-center gap-3">
				<button
					onclick={saveStation}
					disabled={stationSaving || !stationDirty || !!stationProblem}
					class="rounded bg-cyan-500/20 px-4 py-2 text-[11px] uppercase tracking-widest text-cyan-300 transition-colors hover:bg-cyan-500/30 disabled:cursor-not-allowed disabled:bg-muted-foreground/10 disabled:text-muted-foreground/50"
				>
					{stationSaving ? 'Saving…' : stationDirty ? 'Save station' : 'Saved'}
				</button>
				<button
					onclick={resetStation}
					disabled={stationIsDefault}
					class="rounded border border-border/60 px-4 py-2 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-amber-400/60 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-30"
				>
					Reset to default
				</button>
				<span class="ml-auto text-right text-[11px] tracking-wide">
					{#if stationStatus}
						<span class={stationStatus.ok ? 'text-emerald-300' : 'text-red-400'}>{stationStatus.text}</span>
					{:else if stationDirty && stationProblem}
						<span class="text-red-400">{stationProblem}</span>
					{:else if stationDirty}
						<span class="text-amber-300">Unsaved changes</span>
					{/if}
				</span>
			</div>
		</section>

		<h2 class="text-[11px] uppercase tracking-[0.3em] text-cyan-300">Rotation</h2>
		<p class="mt-1 text-xs leading-relaxed text-muted-foreground">
			Drag a row, or use the arrows, to set the order the kiosk rotates through its views, and
			use <span class="text-cyan-300">Hide</span> to drop one from the rotation without losing
			its place in the list. Both are saved on the receiver — so every screen showing this
			station shares them, and they survive a redeploy. The seconds box sets how long each view
			stays up ({MIN_DWELL_MS / 1000}–{MAX_DWELL_MS / 1000}s); only the ones you change are
			saved, so the rest keep following the defaults in the code. One full cycle currently
			runs
			<span class="text-cyan-300">{mmss(totalMs)}</span>
			across {visibleCount}
			{visibleCount === 1 ? 'view' : 'views'}{#if visibleCount < order.length}<span
					class="text-muted-foreground/70"
				>
					({order.length - visibleCount} hidden)</span
				>{/if}.
		</p>

		<div
			class="mt-4 flex items-center gap-3 rounded border border-red-500/40 bg-red-500/10 px-3 py-2"
		>
			<span class="h-6 w-1 shrink-0 rounded-full bg-red-400"></span>
			<span class="min-w-0 flex-1">
				<span class="block truncate text-sm">{emergencyPanel.name}</span>
				<span class="block text-[10px] uppercase tracking-widest text-red-300/80">
					Automatic · {emergencyPanel.id} · outside the rotation
				</span>
			</span>
			<span class="max-w-[52%] text-right text-[11px] leading-snug text-muted-foreground">
				Shown only while an aircraft is squawking an emergency, and held until it clears — so it
				has no place in the order, no dwell, and can't be hidden.
			</span>
		</div>

		<ol class="mt-6 flex flex-col gap-1.5">
			{#each order as panel, i (panel.id)}
				<li
					draggable="true"
					ondragstart={(e) => onDragStart(i, e)}
					ondragover={(e) => onDragOver(i, e)}
					ondrop={(e) => onDrop(i, e)}
					ondragend={onDragEnd}
					class="flex items-center gap-3 rounded border bg-background/40 px-3 py-2 transition-colors {dragOver ===
						i && dragFrom !== i
						? 'border-cyan-400/80 bg-cyan-400/10'
						: 'border-border/40'} {dragFrom === i ? 'opacity-40' : ''} {hidden.has(panel.id)
						? 'opacity-45'
						: ''}"
				>
					<span class="cursor-grab select-none text-muted-foreground/50" aria-hidden="true">⠿</span>
					<span class="w-6 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
					<span class="h-6 w-1 shrink-0 rounded-full {accentBar[panel.accent]}"></span>

					<span class="min-w-0 flex-1">
						<span class="block truncate text-sm {hidden.has(panel.id) ? 'line-through' : ''}"
							>{panel.name}</span
						>
						<span class="block truncate text-[10px] uppercase tracking-widest text-muted-foreground">
							{panel.group} · {panel.id}{#if hidden.has(panel.id)} · hidden{/if}
						</span>
					</span>

					<label
						class="flex shrink-0 items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground"
						title="Seconds this view stays up ({MIN_DWELL_MS / 1000}–{MAX_DWELL_MS /
							1000}). Default {panel.ms / 1000}s."
					>
						<span class="sr-only">Dwell for {panel.name} in seconds</span>
						<input
							type="number"
							min={MIN_DWELL_MS / 1000}
							max={MAX_DWELL_MS / 1000}
							step="1"
							value={Math.round((dwell[panel.id] ?? panel.ms) / 1000)}
							onchange={(e) => setDwell(panel.id, e.currentTarget.valueAsNumber)}
							class="w-14 rounded border border-border/60 bg-background/60 px-1.5 py-1 text-right text-xs tabular-nums transition-colors focus:border-cyan-400/60 focus:outline-none {(dwell[
								panel.id
							] ?? panel.ms) !== panel.ms
								? 'text-cyan-300'
								: 'text-muted-foreground'}"
						/>
						<span aria-hidden="true">s</span>
					</label>

					<span class="flex gap-1">
						<button
							onclick={() => toggleHidden(panel.id)}
							disabled={!hidden.has(panel.id) && !canHideMore}
							class="h-7 rounded border px-2 text-[10px] uppercase tracking-widest transition-colors disabled:cursor-not-allowed disabled:opacity-25 {hidden.has(
								panel.id
							)
								? 'border-amber-400/60 text-amber-300 hover:border-amber-400 hover:text-amber-200'
								: 'border-border/60 text-muted-foreground hover:border-cyan-400/60 hover:text-cyan-300'}"
							aria-pressed={hidden.has(panel.id)}
							title={!hidden.has(panel.id) && !canHideMore
								? 'At least one view has to stay in the rotation'
								: hidden.has(panel.id)
									? `Put ${panel.name} back in the rotation`
									: `Drop ${panel.name} from the rotation`}
							aria-label={hidden.has(panel.id)
								? `Show ${panel.name}`
								: `Hide ${panel.name}`}
						>
							{hidden.has(panel.id) ? 'Show' : 'Hide'}
						</button>
						<button
							onclick={() => move(i, i - 1)}
							disabled={i === 0}
							class="h-7 w-7 rounded border border-border/60 text-xs text-muted-foreground transition-colors hover:border-cyan-400/60 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-25"
							aria-label="Move {panel.name} up"
						>
							↑
						</button>
						<button
							onclick={() => move(i, i + 1)}
							disabled={i === order.length - 1}
							class="h-7 w-7 rounded border border-border/60 text-xs text-muted-foreground transition-colors hover:border-cyan-400/60 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-25"
							aria-label="Move {panel.name} down"
						>
							↓
						</button>
					</span>
				</li>
			{/each}
		</ol>
	</main>

	<!-- Action bar: pinned so Save stays reachable without scrolling back. -->
	<div
		class="sticky bottom-0 border-t border-border/40 bg-background/80 px-6 py-3 backdrop-blur max-lg:px-3"
	>
		<div class="mx-auto flex max-w-4xl items-center gap-3">
			<button
				onclick={save}
				disabled={saving || !dirty}
				class="rounded bg-cyan-500/20 px-4 py-2 text-[11px] uppercase tracking-widest text-cyan-300 transition-colors hover:bg-cyan-500/30 disabled:cursor-not-allowed disabled:bg-muted-foreground/10 disabled:text-muted-foreground/50"
			>
				{saving ? 'Saving…' : dirty ? 'Save order' : 'Saved'}
			</button>
			<button
				onclick={resetToDefault}
				disabled={isDefault}
				class="rounded border border-border/60 px-4 py-2 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-amber-400/60 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-30"
			>
				Reset to default
			</button>

			<span class="ml-auto text-[11px] tracking-wide">
				{#if status}
					<span class={status.ok ? 'text-emerald-300' : 'text-red-400'}>{status.text}</span>
				{:else if dirty}
					<span class="text-amber-300">Unsaved changes</span>
				{/if}
			</span>
		</div>
	</div>
</div>
