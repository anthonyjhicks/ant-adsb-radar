<script lang="ts">
	import { radarStore } from '$lib/stores/radar.svelte';

	// Polar histogram (compass rose) of the directions airborne contacts are
	// tracking — reveals the dominant airway flows and the arrival/departure
	// split at a glance.
	let snap = $derived(radarStore.snapshot);
	let ac = $derived(snap?.aircraft ?? []);

	// Airborne contacts with a known track over ground.
	let tracks = $derived(
		ac
			.filter((a) => a.track != null && !a.on_ground)
			.map((a) => ((a.track as number) % 360 + 360) % 360)
	);

	const BINS = 36; // 10° per bin
	const BIN_DEG = 360 / BINS;

	let counts = $derived.by(() => {
		const out = new Array(BINS).fill(0) as number[];
		for (const t of tracks) out[Math.floor(t / BIN_DEG) % BINS]++;
		return out;
	});
	let maxCount = $derived(Math.max(1, ...counts));
	let modalBin = $derived(counts.reduce((best, c, i) => (c > counts[best] ? i : best), 0));
	let modalHeading = $derived(tracks.length ? modalBin * BIN_DEG + BIN_DEG / 2 : 0);

	// Degrees -> 16-point compass label.
	const COMPASS = [
		'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
		'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'
	];
	function compass(deg: number): string {
		return COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
	}
	function hdg(deg: number): string {
		return String(Math.round(((deg % 360) + 360) % 360)).padStart(3, '0');
	}

	// Top heading bins for the side readout.
	let topBins = $derived(
		counts
			.map((count, i) => ({ count, center: i * BIN_DEG + BIN_DEG / 2 }))
			.filter((b) => b.count > 0)
			.sort((a, b) => b.count - a.count)
			.slice(0, 3)
	);

	const SIZE = 1000;
	const C = SIZE / 2;
	const R = 440;

	// Reference rings (count scale). Radius uses sqrt(count) so a few busy bins
	// don't dwarf the rest — sqrt keeps the rose readable when one flow spikes.
	let ringCounts = $derived.by(() => {
		const step = maxCount <= 4 ? 1 : maxCount <= 10 ? 2 : maxCount <= 25 ? 5 : 10;
		const out: number[] = [];
		for (let v = step; v <= maxCount; v += step) out.push(v);
		return out;
	});
	function radiusFor(count: number): number {
		return (Math.sqrt(count) / Math.sqrt(maxCount)) * R;
	}

	// Build a filled wedge path for a bin spanning its 10° sector, north-up
	// clockwise. Reuses PanelCoverage's convention: x = C + r·sin, y = C − r·cos.
	function wedge(binIndex: number, count: number): string {
		const r = radiusFor(count);
		if (r <= 0) return '';
		const a0 = ((binIndex * BIN_DEG) * Math.PI) / 180;
		const a1 = (((binIndex + 1) * BIN_DEG) * Math.PI) / 180;
		const x0 = C + r * Math.sin(a0);
		const y0 = C - r * Math.cos(a0);
		const x1 = C + r * Math.sin(a1);
		const y1 = C - r * Math.cos(a1);
		return `M ${C} ${C} L ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z`;
	}
</script>

<div class="flex h-full w-full gap-6 px-8 py-4 max-lg:flex-col max-lg:px-4">
	<!-- polar heading rose -->
	<div class="relative flex h-full flex-1 items-center justify-center">
		{#if tracks.length === 0}
			<div class="text-sm text-muted-foreground">No airborne tracks right now</div>
		{:else}
			<svg viewBox="0 0 {SIZE} {SIZE}" class="h-full max-h-full" style="max-width:100%">
				<circle cx={C} cy={C} r={R} fill="var(--scope-bg)" />

				{#each ringCounts as n (n)}
					{@const rr = radiusFor(n)}
					<circle cx={C} cy={C} r={rr} fill="none" stroke="var(--scope-line)" stroke-opacity="0.25" stroke-width="1" />
					<text x={C + 4} y={C - rr + 16} fill="var(--scope-line)" fill-opacity="0.55" font-size="15" font-family="monospace">{n}</text>
				{/each}

				{#each Array(12) as _, i (i)}
					{@const rad = (i * 30 * Math.PI) / 180}
					<line x1={C} y1={C} x2={C + R * Math.sin(rad)} y2={C - R * Math.cos(rad)} stroke="var(--scope-line)" stroke-opacity="0.1" stroke-width="1" />
				{/each}

				<!-- heading wedges -->
				{#each counts as count, i (i)}
					{#if count > 0}
						<path
							d={wedge(i, count)}
							fill={i === modalBin ? 'var(--scope-sweep)' : 'var(--alt-mid)'}
							fill-opacity={i === modalBin ? 0.8 : 0.7}
							stroke={i === modalBin ? 'var(--scope-sweep)' : 'var(--alt-mid)'}
							stroke-opacity="0.95"
							stroke-width="1.5"
							stroke-linejoin="round"
						/>
					{/if}
				{/each}

				{#each [['N', 0], ['E', 90], ['S', 180], ['W', 270]] as [label, deg] (label)}
					{@const rad = ((deg as number) * Math.PI) / 180}
					<text x={C + (R + 22) * Math.sin(rad)} y={C - (R + 22) * Math.cos(rad)} fill="var(--scope-line)" fill-opacity="0.7" font-size="22" font-weight="bold" font-family="monospace" text-anchor="middle" dominant-baseline="middle">{label}</text>
				{/each}
				{#each [['045', 45], ['135', 135], ['225', 225], ['315', 315]] as [label, deg] (label)}
					{@const rad = ((deg as number) * Math.PI) / 180}
					<text x={C + (R + 20) * Math.sin(rad)} y={C - (R + 20) * Math.cos(rad)} fill="var(--scope-line)" fill-opacity="0.4" font-size="14" font-family="monospace" text-anchor="middle" dominant-baseline="middle">{label}</text>
				{/each}

				<circle cx={C} cy={C} r="5" fill="var(--scope-sweep)" />
			</svg>
		{/if}
	</div>

	<!-- right column: header + readout -->
	<div class="flex w-72 shrink-0 flex-col gap-3 pt-2 max-lg:w-full">
		<div class="flex items-baseline justify-between">
			<div>
				<div class="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">Heading rose</div>
				<div class="text-xs text-muted-foreground">which way traffic is flowing right now</div>
			</div>
		</div>
		<div class="text-xs text-muted-foreground tabular-nums">
			{tracks.length} tracked{#if tracks.length} · mode {hdg(modalHeading)}°{/if}
		</div>

		<div class="rounded-lg border border-border/50 bg-card/40 p-4">
			<div class="text-[10px] uppercase tracking-widest text-muted-foreground">Dominant flows</div>
			<div class="mt-2 flex flex-col gap-2">
				{#each topBins as b, i (b.center)}
					<div class="flex items-center gap-3">
						<span
							class="h-2 w-4 shrink-0 rounded"
							style="background:{i === 0 ? 'var(--scope-sweep)' : 'var(--alt-mid)'}"
						></span>
						<span class="text-sm tabular-nums">{hdg(b.center)}°</span>
						<span class="text-xs text-muted-foreground">{compass(b.center)}</span>
						<span class="ml-auto text-lg font-bold tabular-nums text-sky-300">{b.count}</span>
					</div>
				{:else}
					<div class="text-xs text-muted-foreground">No data</div>
				{/each}
			</div>
		</div>

		<p class="px-1 text-[11px] leading-relaxed text-muted-foreground/70">
			Each petal is a 10° band of true track over ground; its length grows with the
			√ of how many aircraft are heading that way. The bright petal is the busiest
			heading — opposing lobes reveal the arrival/departure split along the airways.
		</p>
	</div>
</div>
