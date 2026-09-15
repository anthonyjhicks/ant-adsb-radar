<script lang="ts">
	// One airport: a north-up runway schematic with the wind-favoured ends lit
	// and approach chevrons streaming onto them, the wind vector on the rim,
	// head/crosswind components per active end, and the raw METAR.
	import type { Metar } from '$lib/api/metar';
	import { RUNWAY_LAYOUTS, layoutGeometry } from '$lib/data/runways';
	import { categoryClass, fmtVisibility, fmtWind } from '$lib/utils/weather';

	let { icao, metar }: { icao: string; metar?: Metar } = $props();

	const RAD = Math.PI / 180;
	const WIND = 'rgb(125 211 252)'; // sky-300, distinct from the phosphor runways

	let layout = $derived(RUNWAY_LAYOUTS[icao]);
	let strips = $derived(layout ? layoutGeometry(layout, 72) : []);
	let active = $derived(new Set(metar?.runways ?? []));
	let activeWinds = $derived((metar?.runway_winds ?? []).filter((w) => w.active));
	let name = $derived(metar?.name ?? layout?.name ?? icao);
	// Helipad marker at the FATO's midpoint.
	let pad = $derived.by(() => {
		const st = layout?.heliport ? strips[0] : null;
		return st ? { x: (st.x1 + st.x2) / 2, y: (st.y1 + st.y2) / 2 } : null;
	});

	let wdir = $derived(metar?.wind?.dir ?? null);
	let hasWind = $derived(
		wdir != null && wdir !== 0 && !metar?.wind?.variable && (metar?.wind?.speed ?? 0) > 0
	);

	function pt(deg: number, r: number) {
		return { x: r * Math.sin(deg * RAD), y: -r * Math.cos(deg * RAD) };
	}

	// Arrow from the rim at the wind's source, pointing inward (the way it blows).
	let windArrow = $derived.by(() => {
		if (!hasWind || wdir == null) return null;
		const a = pt(wdir, 92);
		const b = pt(wdir, 60);
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const L = Math.hypot(dx, dy) || 1;
		const ux = dx / L;
		const uy = dy / L;
		const head = `${b.x},${b.y} ${b.x - ux * 9 - uy * 4.5},${b.y - uy * 9 + ux * 4.5} ${b.x - ux * 9 + uy * 4.5},${b.y - uy * 9 - ux * 4.5}`;
		return { a, b, head };
	});

	// The reported variability range (e.g. 250V330) as an arc on the rim.
	let varArc = $derived.by(() => {
		const f = metar?.wind?.var_from;
		const t = metar?.wind?.var_to;
		if (f == null || t == null) return null;
		const a = pt(f, 92);
		const b = pt(t, 92);
		const sweep = (((t - f) % 360) + 360) % 360;
		return `M ${a.x} ${a.y} A 92 92 0 ${sweep > 180 ? 1 : 0} 1 ${b.x} ${b.y}`;
	});

	function headwind(v: number | null): string {
		if (v == null) return 'HW —';
		return v >= 0 ? `HW ${v} kt` : `TW ${-v} kt`;
	}
	function crosswind(v: number | null, from: 'L' | 'R' | null): string {
		if (v == null) return 'XW —';
		return `XW ${v} kt${from ? ` ${from}` : ''}`;
	}
</script>

<div class="flex min-h-0 flex-col rounded-lg border border-border/50 bg-card/40 p-3">
	<div class="flex items-baseline justify-between gap-2">
		<div class="flex min-w-0 items-baseline gap-2">
			<span class="truncate text-base font-bold">{name}</span>
			<span class="text-[11px] text-muted-foreground">{icao}</span>
		</div>
		{#if metar?.available}
			<span class="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase {categoryClass(metar.flight_category)}">
				{metar.flight_category ?? '—'}
			</span>
		{/if}
	</div>

	{#if metar?.available}
		<div class="mt-1 flex min-h-0 flex-1 gap-3">
			<svg viewBox="-100 -100 200 200" class="h-[200px] w-[200px] shrink-0 max-lg:h-[160px] max-lg:w-[160px]" aria-label="{name} runway layout">
				<circle r="96" fill="var(--scope-bg)" stroke="var(--scope-line)" stroke-opacity="0.25" />
				{#each [['N', 0], ['E', 90], ['S', 180], ['W', 270]] as [label, deg] (label)}
					{@const p = pt(deg as number, 86)}
					<text x={p.x} y={p.y} fill="var(--scope-line)" fill-opacity="0.45" font-size="10" font-family="monospace" text-anchor="middle" dominant-baseline="middle">{label}</text>
				{/each}
				{#if varArc}
					<path d={varArc} fill="none" stroke={WIND} stroke-opacity="0.45" stroke-width="3" />
				{/if}

				{#each strips as st, i (i)}
					{@const on = active.has(st.ends[0].name) || active.has(st.ends[1].name)}
					{#if on}
						<line class="rwy-glow" x1={st.x1} y1={st.y1} x2={st.x2} y2={st.y2} stroke="var(--scope-sweep)" stroke-opacity="0.35" stroke-width="13" stroke-linecap="round" />
					{/if}
					<line
						x1={st.x1}
						y1={st.y1}
						x2={st.x2}
						y2={st.y2}
						stroke={on ? 'var(--scope-sweep)' : 'var(--scope-terrain)'}
						stroke-opacity={on ? 0.95 : st.standby ? 0.35 : 0.6}
						stroke-width={st.standby ? 4 : 7}
						stroke-dasharray={st.standby ? '4 3' : undefined}
					/>
					{#each st.ends as e (e.name)}
						{@const lit = active.has(e.name)}
						{#if lit}
							<!-- approach path: dashes stream toward the threshold -->
							<path class="approach" d="M {e.x + e.ox * 42} {e.y + e.oy * 42} L {e.x + e.ox * 7} {e.y + e.oy * 7}" stroke="var(--scope-sweep)" stroke-width="2.5" fill="none" stroke-linecap="round" />
							<line x1={e.x - e.oy * 5.5} y1={e.y + e.ox * 5.5} x2={e.x + e.oy * 5.5} y2={e.y - e.ox * 5.5} stroke="white" stroke-opacity="0.9" stroke-width="2" />
						{/if}
						{#if !st.standby}
						<text
							x={e.x + e.ox * 13 - e.oy * 12}
							y={e.y + e.oy * 13 + e.ox * 12}
							font-size="11"
							font-family="monospace"
							font-weight={lit ? 'bold' : 'normal'}
							fill={lit ? 'var(--scope-sweep)' : 'var(--scope-terrain)'}
							fill-opacity={lit ? 1 : 0.8}
							text-anchor="middle"
							dominant-baseline="middle">{e.name}</text>
						{/if}
					{/each}
				{/each}

				{#if pad}
					<circle cx={pad.x} cy={pad.y} r="12" fill="var(--scope-bg)" stroke="var(--scope-sweep)" stroke-width="2" />
					<text x={pad.x} y={pad.y} fill="var(--scope-sweep)" font-size="14" font-weight="bold" font-family="monospace" text-anchor="middle" dominant-baseline="central">H</text>
				{/if}

				{#if windArrow}
					<line x1={windArrow.a.x} y1={windArrow.a.y} x2={windArrow.b.x} y2={windArrow.b.y} stroke={WIND} stroke-width="2.5" />
					<polygon points={windArrow.head} fill={WIND} />
				{:else}
					<text y="72" fill={WIND} fill-opacity="0.8" font-size="10" font-family="monospace" text-anchor="middle" dominant-baseline="middle">{(metar.wind?.speed ?? 0) > 0 ? 'VRB' : 'CALM'}</text>
				{/if}
			</svg>

			<div class="flex min-w-0 flex-1 flex-col">
				<div class="text-[10px] uppercase tracking-widest text-muted-foreground">{layout?.heliport ? 'FATO' : 'Active'} · {metar.mode ?? '—'}</div>
				{#if !layout}
					<!-- Weather still shows; the schematic needs an entry in lib/data/runways.ts
					     (and the backend station catalogue for the wind maths). -->
					<div class="mt-1.5 text-[11px] leading-snug text-muted-foreground/70">no runway layout for {icao}</div>
				{/if}
				<div class="mt-1.5 flex flex-col gap-1.5">
					{#each activeWinds as w (w.name)}
						<div class="self-start rounded bg-emerald-500/15 px-2.5 py-1.5">
							<div class="text-3xl font-bold leading-none tabular-nums text-emerald-300">{w.name}</div>
							<div class="mt-1 whitespace-nowrap text-[11px] leading-tight tabular-nums text-muted-foreground">
								<div>{headwind(w.headwind)}</div>
								<div>{crosswind(w.crosswind, w.crosswind_from)}</div>
							</div>
						</div>
					{:else}
						{#each metar.runways ?? [] as rwy (rwy)}
							<span class="self-start rounded bg-emerald-500/15 px-2.5 py-1.5 text-3xl font-bold tabular-nums text-emerald-300">{rwy}</span>
						{/each}
					{/each}
				</div>
			</div>
		</div>

		<div class="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs tabular-nums">
			<div class="flex justify-between gap-2"><span class="text-muted-foreground">Wind</span><span class="text-sky-300">{fmtWind(metar)}</span></div>
			<div class="flex justify-between gap-2"><span class="text-muted-foreground">Temp / dew</span><span>{metar.temp ?? '—'}° / {metar.dewp ?? '—'}°</span></div>
			<div class="flex justify-between gap-2"><span class="text-muted-foreground">QNH</span><span>{metar.qnh ?? '—'} hPa</span></div>
			<div class="flex justify-between gap-2"><span class="text-muted-foreground">Vis</span><span>{fmtVisibility(metar)}</span></div>
		</div>
		<div class="mt-auto line-clamp-2 border-t border-border/30 pt-1.5 font-mono text-[10px] leading-snug text-muted-foreground">{metar.raw}</div>
	{:else}
		<div class="flex flex-1 items-center justify-center text-xs text-muted-foreground">
			{metar ? `${icao} unavailable` : 'Loading…'}
		</div>
	{/if}
</div>

<style>
	.approach {
		stroke-dasharray: 5 6;
		animation: approach 1.1s linear infinite;
	}
	@keyframes approach {
		to {
			stroke-dashoffset: -11;
		}
	}
	.rwy-glow {
		animation: glow 2.4s ease-in-out infinite;
	}
	@keyframes glow {
		50% {
			opacity: 0.3;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.approach,
		.rwy-glow {
			animation: none;
		}
	}
</style>
