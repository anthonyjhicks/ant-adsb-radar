<script lang="ts">
	import { radarStore } from '$lib/stores/radar.svelte';
	import { altColor } from '$lib/utils/geo';
	import type { Aircraft } from '$lib/types/radar';

	// Range-vs-height scatter of the airborne picture — the approach/departure
	// stack. Two colour lenses, toggled in the header:
	//   band  — by altitude band (the classic profile)
	//   trend — by vertical motion, so climbing departures and descending
	//           arrivals separate into distinct corridors.
	let mode = $state<'band' | 'trend'>('band');

	let snap = $derived(radarStore.snapshot);

	// Contacts with a range and a barometric altitude — the airborne picture.
	let contacts = $derived(
		(snap?.aircraft ?? []).filter(
			(a) => a.distance_nm != null && a.alt_baro != null && !a.on_ground
		)
	);

	// Split by vertical motion: descending = arriving, climbing = departing.
	let descending = $derived(contacts.filter((a) => a.vert_trend < 0).length);
	let climbing = $derived(contacts.filter((a) => a.vert_trend > 0).length);
	let level = $derived(contacts.filter((a) => a.vert_trend === 0).length);

	const W = 1280;
	const H = 620;
	const padL = 64;
	const padR = 24;
	const padT = 24;
	const padB = 44;
	const plotW = W - padL - padR;
	const plotH = H - padT - padB;

	function niceCeil(v: number, step: number): number {
		return Math.max(step, Math.ceil(v / step) * step);
	}
	let maxX = $derived(
		niceCeil(Math.max(20, ...contacts.map((a) => a.distance_nm as number)), 20)
	);
	let maxY = $derived(
		niceCeil(Math.max(38000, ...contacts.map((a) => a.alt_baro as number)), 5000)
	);
	let xStep = $derived(maxX <= 40 ? 10 : maxX <= 100 ? 20 : 40);

	function px(d: number): number {
		return padL + (d / maxX) * plotW;
	}
	function py(alt: number): number {
		return padT + plotH - (Math.max(0, alt) / maxY) * plotH;
	}

	let xTicks = $derived(Array.from({ length: Math.floor(maxX / xStep) + 1 }, (_, i) => i * xStep));
	let yTicks = $derived(Array.from({ length: Math.floor(maxY / 10000) + 1 }, (_, i) => i * 10000));

	// Label only the nearest contacts to limit clutter.
	let labelHexes = $derived(
		new Set(
			[...contacts]
				.sort((a, b) => (a.distance_nm as number) - (b.distance_nm as number))
				.slice(0, 20)
				.map((a) => a.hex)
		)
	);

	function pt(a: Aircraft) {
		return { x: px(a.distance_nm as number), y: py(a.alt_baro as number) };
	}

	// Colour by vertical motion (trend lens): climb green, descent amber, level grey.
	function trendColor(a: Aircraft): string {
		if (a.emergency) return 'var(--alt-emergency)';
		if (a.vert_trend > 0) return 'var(--alt-mid)';
		if (a.vert_trend < 0) return 'var(--alt-low)';
		return 'var(--alt-ground)';
	}
	function color(a: Aircraft): string {
		return mode === 'trend' ? trendColor(a) : altColor(a.flight_level, false, !!a.emergency);
	}

	// Vertical-rate tick, length ∝ |baro_rate| clamped to a sane px range; a
	// ~3000 ft/min climb/descent saturates it.
	const minTick = 4;
	const maxTick = 22;
	function tickLen(a: Aircraft): number {
		const rate = a.baro_rate == null ? 0 : Math.abs(a.baro_rate);
		return Math.min(maxTick, minTick + (rate / 3000) * (maxTick - minTick));
	}

	const TABS = [
		['band', 'Altitude'],
		['trend', 'Vertical']
	] as const;
</script>

<div class="flex h-full flex-col px-6 py-4 max-lg:h-auto max-lg:min-h-full max-lg:px-3">
	<div class="mb-1 flex items-baseline justify-between">
		<div>
			<span class="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">Altitude profile</span>
			<span class="ml-3 text-xs text-muted-foreground">
				{mode === 'trend'
					? "coloured by climb / descent — arrival & departure corridors"
					: 'range vs height · the approach / departure stack'}
			</span>
		</div>
		<div class="flex items-center gap-3">
			<span class="text-xs text-muted-foreground tabular-nums max-lg:hidden">
				▼{descending} arriving · ▲{climbing} departing · {level} level
			</span>
			<div class="flex items-center gap-1">
				{#each TABS as [key, name] (key)}
					<button
						type="button"
						onclick={() => (mode = key)}
						class="rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider transition-colors {mode ===
						key
							? 'bg-sky-500/70 text-foreground'
							: 'bg-muted/40 text-muted-foreground hover:text-foreground'}"
					>
						{name}
					</button>
				{/each}
			</div>
		</div>
	</div>

	<div class="min-h-0 flex-1 max-lg:h-[60vh] max-lg:flex-none">
		{#if contacts.length === 0}
			<div class="flex h-full items-center justify-center text-xs text-muted-foreground">
				no airborne contacts
			</div>
		{:else}
			<svg viewBox="0 0 {W} {H}" class="h-full w-full" preserveAspectRatio="xMidYMid meet">
				<!-- Y grid + FL labels -->
				{#each yTicks as alt (alt)}
					<line x1={padL} y1={py(alt)} x2={W - padR} y2={py(alt)} stroke="var(--scope-line)" stroke-opacity="0.14" stroke-width="1" />
					<text x={padL - 8} y={py(alt) + 4} fill="var(--scope-line)" fill-opacity="0.6" font-size="13" font-family="monospace" text-anchor="end">
						{alt === 0 ? 'GND' : 'FL' + alt / 100}
					</text>
				{/each}

				<!-- X grid + range labels -->
				{#each xTicks as d (d)}
					<line x1={px(d)} y1={padT} x2={px(d)} y2={padT + plotH} stroke="var(--scope-line)" stroke-opacity="0.1" stroke-width="1" />
					<text x={px(d)} y={H - padB + 18} fill="var(--scope-line)" fill-opacity="0.6" font-size="12" font-family="monospace" text-anchor="middle">
						{d}
					</text>
				{/each}
				<text x={W - padR} y={H - 6} fill="var(--scope-line)" fill-opacity="0.5" font-size="12" font-family="monospace" text-anchor="end">range from station (nm)</text>

				<!-- station baseline marker -->
				<circle cx={px(0)} cy={py(0)} r="4" fill="var(--scope-sweep)" />

				<!-- contacts -->
				{#each contacts as a (a.hex)}
					{@const p = pt(a)}
					{@const c = color(a)}
					{@const labelled = labelHexes.has(a.hex)}
					<g class={a.emergency ? 'emerg' : ''}>
						<!-- vertical-rate tick: up for climb, down for descent, length ∝ rate -->
						{#if a.vert_trend !== 0}
							<line
								x1={p.x}
								y1={p.y}
								x2={p.x}
								y2={p.y - a.vert_trend * tickLen(a)}
								stroke={c}
								stroke-width="1.5"
								stroke-opacity="0.8"
							/>
						{/if}
						{#if a.flown}
							<circle cx={p.x} cy={p.y} r="8" fill="none" stroke="var(--flown)" stroke-width="1.5" />
						{/if}
						<circle cx={p.x} cy={p.y} r="4.5" fill={c} />
						{#if labelled}
							<text x={p.x + 7} y={p.y + 4} fill={c} fill-opacity="0.9" font-size="12" font-family="monospace">
								{a.flight ?? a.hex}
							</text>
						{/if}
					</g>
				{/each}
			</svg>
		{/if}
	</div>

	<!-- legend (switches with the colour lens) -->
	<div class="mt-1 flex items-center gap-5 text-[11px] text-muted-foreground">
		{#if mode === 'trend'}
			<span class="flex items-center gap-1.5"><span style="color: var(--alt-mid)">▲</span> climbing</span>
			<span class="flex items-center gap-1.5"><span style="color: var(--alt-low)">▼</span> descending</span>
			<span class="flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-full" style="background: var(--alt-ground)"></span> level</span>
		{:else}
			{#each [['< FL100', 'var(--alt-low)'], ['FL100–250', 'var(--alt-mid)'], ['> FL250', 'var(--alt-high)']] as [label, c] (label)}
				<span class="flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-full" style="background:{c}"></span>{label}</span>
			{/each}
		{/if}
		<span class="flex items-center gap-1.5"><span style="color: var(--flown)">○</span> flown</span>
		<span class="ml-auto">tick length = vertical rate ↑ climb / ↓ descend</span>
	</div>
</div>
