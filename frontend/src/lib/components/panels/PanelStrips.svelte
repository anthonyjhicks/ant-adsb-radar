<script lang="ts">
	import { radarStore } from '$lib/stores/radar.svelte';
	import { altColor, fmtBearing } from '$lib/utils/geo';
	import { ensureRoute, routeCache, airportCode } from '$lib/api/route';
	import type { Aircraft } from '$lib/types/radar';

	let snap = $derived(radarStore.snapshot);

	// Controller strip board: closest contacts first, with a position.
	let strips = $derived(
		[...(snap?.aircraft ?? [])]
			.filter((a) => a.distance_nm != null)
			.sort((a, b) => (a.distance_nm as number) - (b.distance_nm as number))
			.slice(0, 34)
	);
	let extra = $derived(Math.max(0, (snap?.counts.positioned ?? 0) - strips.length));

	// Opportunistically resolve routes for the visible strips (cached + deduped);
	// the per-second re-render then surfaces them in the Type/Route column.
	$effect(() => {
		for (const a of strips) ensureRoute(a.flight);
	});

	function routeLabel(a: Aircraft): string | null {
		const r = a.flight ? routeCache.get(a.flight.trim()) : undefined;
		if (r && (r.origin || r.destination)) return `${airportCode(r.origin)}→${airportCode(r.destination)}`;
		return null;
	}

	function trendArrow(a: Aircraft): string {
		if (a.on_ground) return '⏚';
		if (a.vert_trend > 0) return '▲';
		if (a.vert_trend < 0) return '▼';
		return '—';
	}
	function age(a: Aircraft): string {
		const s = a.seen ?? 0;
		return s < 10 ? `${s.toFixed(0)}s` : `${Math.round(s)}s`;
	}

	// Position sources other than direct ADS-B are worth flagging — MLAT and
	// TIS-B/ADS-R positions are derived/relayed rather than transponder-reported.
	function altSource(a: Aircraft): string | null {
		return a.pos_source && a.pos_source !== 'ADS-B' ? a.pos_source : null;
	}
</script>

<div class="flex h-full flex-col px-6 py-3 max-lg:h-auto max-lg:min-h-full max-lg:px-3">
	<div class="mb-2 flex items-baseline justify-between">
		<div>
			<span class="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">Live traffic</span>
			<span class="ml-3 text-xs text-muted-foreground">sorted by range · nearest first</span>
		</div>
		<div class="text-xs text-muted-foreground">
			{strips.length} shown{#if extra > 0}<span class="text-muted-foreground/60"> · +{extra} more</span>{/if}
		</div>
	</div>

	<!-- column header -->
	<div
		class="grid grid-cols-[1.4fr_0.9fr_0.7fr_0.6fr_0.6fr_0.7fr_0.8fr_0.5fr] gap-2 border-b border-border/50 px-3 pb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground"
	>
		<div>Callsign</div>
		<div>Route / Type</div>
		<div class="text-right">Alt</div>
		<div class="text-right">Gs</div>
		<div class="text-right">Hdg</div>
		<div class="text-right">Sqk</div>
		<div class="text-right">Rng / Brg</div>
		<div class="text-right">Age</div>
	</div>

	<div class="grid flex-1 grid-cols-2 gap-x-6 gap-y-0.5 overflow-hidden pt-1 max-lg:flex-none max-lg:grid-cols-1 max-lg:overflow-visible">
		{#each strips as a (a.hex)}
			{@const color = altColor(a.flight_level, a.on_ground, !!a.emergency)}
			<div
				class="grid grid-cols-[1.4fr_0.9fr_0.7fr_0.6fr_0.6fr_0.7fr_0.8fr_0.5fr] items-center gap-2 rounded px-3 py-1 text-sm tabular-nums {a.emergency
					? 'animate-pulse bg-red-500/15'
					: 'odd:bg-white/[0.015]'}"
			>
				<div class="flex items-center gap-2 truncate">
					<span class="h-3 w-1 rounded-full" style="background:{color}"></span>
					<span class="truncate font-bold" style="color:{color}">{a.flight ?? a.hex}</span>
					{#if a.mil}
						<span class="rounded bg-lime-500/20 px-1 text-[9px] font-bold uppercase text-lime-300">MIL</span>
					{/if}
					{#if a.interesting}
						<span class="text-[10px] text-amber-300" title="Interesting airframe">★</span>
					{/if}
					{#if altSource(a)}
						<span class="rounded bg-violet-500/20 px-1 text-[9px] font-bold uppercase text-violet-300"
							>{altSource(a)}</span
						>
					{/if}
					{#if a.emergency}
						<span class="rounded bg-red-500/30 px-1 text-[9px] font-bold uppercase text-red-200"
							>{a.emergency}</span
						>
					{/if}
				</div>
				<div class="truncate text-xs">
					{#if routeLabel(a)}
						<span class="font-bold text-cyan-300">{routeLabel(a)}</span>
					{:else}
						{#if a.type}<span class="text-foreground/80">{a.type}</span>{/if}
						<span class="text-muted-foreground">{a.registration ?? (a.type ? '' : a.hex)}</span>
					{/if}
				</div>
				<div class="text-right">
					{#if a.flight_level}<span style="color:{color}">FL{a.flight_level}</span>{:else if a.on_ground}<span
							class="text-muted-foreground">GND</span
						>{:else}<span class="text-muted-foreground">—</span>{/if}
					<span class="ml-0.5 text-xs" style="color:{color}">{trendArrow(a)}</span>
				</div>
				<div class="text-right">{a.gs ?? '—'}</div>
				<div class="text-right text-muted-foreground">{fmtBearing(a.track)}</div>
				<div class="text-right {a.squawk && ['7500', '7600', '7700'].includes(a.squawk) ? 'font-bold text-red-400' : 'text-muted-foreground'}">
					{a.squawk ?? '----'}
				</div>
				<div class="text-right">
					<span class="text-cyan-300">{a.distance_nm?.toFixed(0)}</span><span
						class="text-muted-foreground/60">/{fmtBearing(a.bearing)}</span
					>
				</div>
				<div class="text-right text-xs {(a.seen ?? 0) > 15 ? 'text-amber-400/70' : 'text-muted-foreground/60'}">
					{age(a)}
				</div>
			</div>
		{/each}
	</div>
</div>
