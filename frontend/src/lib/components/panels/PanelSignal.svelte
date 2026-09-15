<script lang="ts">
	import { radarStore } from '$lib/stores/radar.svelte';
	import { altColor } from '$lib/utils/geo';
	import type { Aircraft } from '$lib/types/radar';

	let snap = $derived(radarStore.snapshot);

	// Contacts that report both a signal level and a range — the link budget.
	let contacts = $derived(
		(snap?.aircraft ?? []).filter((a) => a.rssi != null && a.distance_nm != null)
	);

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
	let xStep = $derived(maxX <= 40 ? 10 : maxX <= 100 ? 20 : 40);

	// RSSI in dBFS is negative; 0 is the strongest possible. Floor auto-fits the
	// weakest contact but never shows less detail than -36 dBFS.
	const yTop = 0;
	let yBottom = $derived(
		Math.min(-36, Math.floor(Math.min(0, ...contacts.map((a) => a.rssi as number)) / 6) * 6)
	);

	function px(d: number): number {
		return padL + (d / maxX) * plotW;
	}
	function py(rssi: number): number {
		const clamped = Math.min(yTop, Math.max(yBottom, rssi));
		return padT + ((yTop - clamped) / (yTop - yBottom)) * plotH;
	}

	let xTicks = $derived(Array.from({ length: Math.floor(maxX / xStep) + 1 }, (_, i) => i * xStep));
	let yTicks = $derived(
		Array.from({ length: Math.floor((yTop - yBottom) / 6) + 1 }, (_, i) => yTop - i * 6)
	);

	function pt(a: Aircraft) {
		return { x: px(a.distance_nm as number), y: py(a.rssi as number) };
	}

	// Median signal per 10nm range bucket — the falloff envelope.
	function median(values: number[]): number {
		const s = [...values].sort((a, b) => a - b);
		const m = Math.floor(s.length / 2);
		return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
	}

	let trend = $derived.by(() => {
		const bucketNm = 10;
		const buckets = new Map<number, number[]>();
		for (const a of contacts) {
			const b = Math.floor((a.distance_nm as number) / bucketNm);
			const arr = buckets.get(b);
			if (arr) arr.push(a.rssi as number);
			else buckets.set(b, [a.rssi as number]);
		}
		return [...buckets.entries()]
			.filter(([, v]) => v.length > 0)
			.map(([b, v]) => ({
				x: px((b + 0.5) * bucketNm),
				y: py(median(v))
			}))
			.sort((a, b) => a.x - b.x);
	});

	let trendPoints = $derived(trend.map((p) => `${p.x},${p.y}`).join(' '));
</script>

<div class="flex h-full flex-col px-6 py-4 max-lg:h-auto max-lg:min-h-full max-lg:px-3">
	<div class="mb-1 flex items-baseline justify-between">
		<div>
			<span class="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">Signal vs range</span>
			<span class="ml-3 text-xs text-muted-foreground">
				received power falls off with distance — outliers are terrain shadow or strong nearby traffic
			</span>
		</div>
		<div class="text-xs text-muted-foreground">{contacts.length} plotted</div>
	</div>

	<div class="min-h-0 flex-1 max-lg:h-[60vh] max-lg:flex-none">
		{#if contacts.length === 0}
			<div class="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
				no contacts reporting signal level
			</div>
		{:else}
			<svg viewBox="0 0 {W} {H}" class="h-full w-full" preserveAspectRatio="xMidYMid meet">
				<!-- Y grid + dBFS labels -->
				{#each yTicks as r (r)}
					<line x1={padL} y1={py(r)} x2={W - padR} y2={py(r)} stroke="var(--scope-line)" stroke-opacity="0.14" stroke-width="1" />
					<text x={padL - 8} y={py(r) + 4} fill="var(--scope-line)" fill-opacity="0.6" font-size="13" font-family="monospace" text-anchor="end">
						{r} dBFS
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
				<text x={padL} y={padT - 8} fill="var(--scope-line)" fill-opacity="0.5" font-size="12" font-family="monospace" text-anchor="start">signal (dBFS)</text>

				<!-- median falloff trend -->
				{#if trend.length >= 2}
					<polyline points={trendPoints} fill="none" stroke="var(--scope-sweep)" stroke-opacity="0.4" stroke-width="2" />
				{/if}

				<!-- contacts -->
				{#each contacts as a (a.hex)}
					{@const p = pt(a)}
					{@const color = altColor(a.flight_level, a.on_ground, !!a.emergency)}
					<circle cx={p.x} cy={p.y} r="4" fill={color} />
				{/each}
			</svg>
		{/if}
	</div>

	<!-- legend -->
	<div class="mt-1 flex items-center gap-5 text-[11px] text-muted-foreground">
		{#each [['< FL100', 'var(--alt-low)'], ['FL100–250', 'var(--alt-mid)'], ['> FL250', 'var(--alt-high)']] as [label, c] (label)}
			<span class="flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-full" style="background:{c}"></span>{label}</span>
		{/each}
		<span class="ml-auto flex items-center gap-1.5">
			<span class="h-0.5 w-5" style="background:var(--scope-sweep);opacity:0.6"></span>median signal
		</span>
	</div>
</div>
