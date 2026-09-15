<script lang="ts">
	import { onMount } from 'svelte';
	import { getCoverage, getRecords, type Coverage, type Records } from '$lib/api/history';
	import { fmtBearing } from '$lib/utils/geo';

	// Receiver coverage + range records. The polar shows the best range achieved
	// per bearing today vs all-time (two lobes); the side cards call out the
	// furthest-contact records (today / all-time / by octant) and 24h uptime.
	let cov = $state<Coverage | null>(null);
	let rec = $state<Records | null>(null);

	async function load() {
		try {
			[cov, rec] = await Promise.all([getCoverage(), getRecords()]);
		} catch {
			// ignore
		}
	}
	onMount(() => {
		load();
		const t = setInterval(load, 60_000);
		return () => clearInterval(t);
	});

	const SIZE = 1000;
	const C = SIZE / 2;
	const R = 440;

	let maxNm = $derived(
		Math.max(10, ...(cov?.best ?? []).map((p) => p[1]), ...(cov?.today ?? []).map((p) => p[1]))
	);
	let rings = $derived.by(() => {
		const step = maxNm <= 60 ? 20 : maxNm <= 150 ? 50 : 100;
		const out: number[] = [];
		for (let v = step; v <= maxNm; v += step) out.push(v);
		return out;
	});

	function poly(points: [number, number][]): string {
		if (points.length < 3) return '';
		return points
			.map(([deg, nm]) => {
				const r = (nm / maxNm) * R;
				const rad = (deg * Math.PI) / 180;
				return `${(C + r * Math.sin(rad)).toFixed(1)},${(C - r * Math.cos(rad)).toFixed(1)}`;
			})
			.join(' ');
	}
	let bestPath = $derived(poly(cov?.best ?? []));
	let todayPath = $derived(poly(cov?.today ?? []));

	// Prefer the record figures (they carry the exact bearing); fall back to the
	// lobe maxima so the numbers still render before /records has data.
	let todayMax = $derived(rec?.today?.range_nm ?? Math.max(0, ...(cov?.today ?? []).map((p) => p[1])));
	let bestMax = $derived(rec?.alltime?.range_nm ?? Math.max(0, ...(cov?.best ?? []).map((p) => p[1])));

	let octants = $derived(rec?.octants ?? []);
	let longest = $derived.by(() => {
		let best: string | null = null;
		let bestNm = 0;
		for (const o of octants) {
			if (o.range_nm > bestNm) {
				bestNm = o.range_nm;
				best = o.octant;
			}
		}
		return best;
	});
	let newRecord = $derived(
		(rec?.today?.range_nm ?? 0) > 0 &&
			rec?.alltime != null &&
			(rec?.today?.range_nm ?? 0) >= rec.alltime.range_nm
	);

	function shortDate(epoch: number): string {
		return new Date(epoch * 1000).toLocaleDateString('en-GB', {
			day: '2-digit',
			month: 'short',
			year: 'numeric',
			timeZone: 'UTC'
		});
	}
</script>

<div class="flex h-full w-full gap-6 px-8 py-4 max-lg:flex-col max-lg:px-4">
	<!-- polar coverage plot -->
	<div class="relative flex h-full flex-1 items-center justify-center">
		<svg viewBox="0 0 {SIZE} {SIZE}" class="h-full max-h-full" style="max-width:100%">
			<circle cx={C} cy={C} r={R} fill="var(--scope-bg)" />
			{#each rings as nm (nm)}
				{@const rr = (nm / maxNm) * R}
				<circle cx={C} cy={C} r={rr} fill="none" stroke="var(--scope-line)" stroke-opacity="0.25" stroke-width="1" />
				<text x={C + 4} y={C - rr + 16} fill="var(--scope-line)" fill-opacity="0.55" font-size="15" font-family="monospace">{nm}</text>
			{/each}
			{#each Array(12) as _, i (i)}
				{@const rad = (i * 30 * Math.PI) / 180}
				<line x1={C} y1={C} x2={C + R * Math.sin(rad)} y2={C - R * Math.cos(rad)} stroke="var(--scope-line)" stroke-opacity="0.1" stroke-width="1" />
			{/each}
			{#each [['N', 0], ['E', 90], ['S', 180], ['W', 270]] as [label, deg] (label)}
				{@const rad = ((deg as number) * Math.PI) / 180}
				<text x={C + (R + 22) * Math.sin(rad)} y={C - (R + 22) * Math.cos(rad)} fill="var(--scope-line)" fill-opacity="0.7" font-size="22" font-weight="bold" font-family="monospace" text-anchor="middle" dominant-baseline="middle">{label}</text>
			{/each}

			{#if bestPath}
				<polygon points={bestPath} fill="var(--scope-line)" fill-opacity="0.05" stroke="var(--scope-line)" stroke-opacity="0.4" stroke-width="1.5" stroke-dasharray="4 5" />
			{/if}
			{#if todayPath}
				<polygon points={todayPath} fill="var(--alt-mid)" fill-opacity="0.12" stroke="var(--alt-mid)" stroke-opacity="0.85" stroke-width="2" />
			{/if}

			<circle cx={C} cy={C} r="5" fill="var(--scope-sweep)" />
		</svg>
	</div>

	<!-- right column: records + health -->
	<div class="flex w-72 shrink-0 flex-col gap-3 pt-2 max-lg:w-full">
		<div class="rounded-lg border border-border/50 bg-card/40 p-4">
			<div class="flex items-center justify-between">
				<div class="text-[10px] uppercase tracking-widest text-muted-foreground">Max range</div>
				{#if newRecord}
					<span class="animate-pulse rounded bg-amber-400/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-amber-300">
						New record
					</span>
				{/if}
			</div>
			<div class="mt-2 flex items-center justify-between">
				<span class="flex items-center gap-2 text-sm"><span class="h-2 w-4 rounded" style="background:var(--alt-mid)"></span>Today</span>
				<span class="text-right">
					<span class="text-xl font-bold tabular-nums text-sky-300">{todayMax.toFixed(0)} nm</span>
					{#if rec?.today?.bearing != null}
						<span class="ml-1 text-[11px] text-muted-foreground tabular-nums">@ {fmtBearing(rec.today.bearing)}°</span>
					{/if}
				</span>
			</div>
			<div class="mt-1 flex items-center justify-between">
				<span class="flex items-center gap-2 text-sm text-muted-foreground"><span class="h-0.5 w-4 rounded border-t-2 border-dashed border-muted-foreground"></span>All-time</span>
				<span class="text-right">
					<span class="text-lg font-bold tabular-nums text-muted-foreground">{bestMax.toFixed(0)} nm</span>
					{#if rec?.alltime?.bearing != null}
						<span class="ml-1 text-[11px] text-muted-foreground/70 tabular-nums">@ {fmtBearing(rec.alltime.bearing)}°</span>
					{/if}
				</span>
			</div>
			{#if rec?.alltime?.day != null}
				<div class="mt-1 text-right text-[11px] text-muted-foreground/70 tabular-nums">record set {shortDate(rec.alltime.day)}</div>
			{/if}
		</div>

		<div class="rounded-lg border border-border/50 bg-card/40 p-4">
			<div class="text-[10px] uppercase tracking-widest text-muted-foreground">Furthest by octant · all-time</div>
			<div class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
				{#each octants as o (o.octant)}
					{@const isMax = o.octant === longest && o.range_nm > 0}
					<div class="flex items-baseline justify-between text-sm {o.range_nm > 0 ? '' : 'text-muted-foreground/40'}">
						<span class="w-7 font-mono {isMax ? 'font-bold text-amber-300' : 'text-muted-foreground'}">{o.octant}</span>
						<span class="tabular-nums {isMax ? 'font-bold text-amber-300' : 'text-foreground'}">
							{o.range_nm > 0 ? `${o.range_nm.toFixed(0)}` : '—'}
						</span>
					</div>
				{:else}
					<div class="col-span-2 text-xs text-muted-foreground">collecting data…</div>
				{/each}
			</div>
		</div>

		<div class="rounded-lg border border-border/50 bg-card/40 p-4">
			<div class="text-[10px] uppercase tracking-widest text-muted-foreground">Receiver uptime · 24h</div>
			<div class="mt-1 text-4xl font-bold tabular-nums {(cov?.uptime_pct ?? 100) >= 99 ? 'text-emerald-300' : (cov?.uptime_pct ?? 100) >= 95 ? 'text-amber-300' : 'text-red-300'}">
				{(cov?.uptime_pct ?? 100).toFixed(1)}%
			</div>
			<div class="mt-2 flex justify-between text-[11px] text-muted-foreground tabular-nums">
				<span>{cov?.polls ?? 0} polls</span>
				<span class={cov?.failures ? 'text-red-400/80' : ''}>{cov?.failures ?? 0} gaps</span>
			</div>
		</div>

		<p class="px-1 text-[11px] leading-relaxed text-muted-foreground/70">
			The shaded lobe is the farthest a contact was tracked in each direction today; the dashed
			outline is the best ever. Notches point to terrain or obstructions.
		</p>
	</div>
</div>
