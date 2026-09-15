<script lang="ts">
	import { radarStore } from '$lib/stores/radar.svelte';
	import { fmtBearing } from '$lib/utils/geo';
	import { getPhoto, photoCache, type AircraftPhoto } from '$lib/api/photo';
	import PhotoCell from '$lib/components/PhotoCell.svelte';
	import type { Aircraft } from '$lib/types/radar';

	// Out-of-the-ordinary contacts overhead right now: military, "interesting"
	// (warbirds, heads-of-state, test airframes) per the Mictronics flags, or an
	// unusual emitter category (gliders, rotorcraft, UAVs, balloons…).
	const UNUSUAL_CAT = new Set(['A6', 'A7', 'B1', 'B2', 'B3', 'B4', 'B6', 'B7']);

	let snap = $derived(radarStore.snapshot);

	function why(a: Aircraft): string | null {
		if (a.mil) return 'Military';
		if (a.interesting) return 'Interesting';
		if (a.category && UNUSUAL_CAT.has(a.category)) return a.category_label ?? 'Unusual';
		return null;
	}

	let items = $derived(
		(snap?.aircraft ?? [])
			.map((a) => ({ a, why: why(a) }))
			.filter((x): x is { a: Aircraft; why: string } => x.why != null)
			.sort((x, y) => (x.a.distance_nm ?? 9e9) - (y.a.distance_nm ?? 9e9))
			.slice(0, 12)
	);

	// Load photos for the visible set (cached + deduped across panels).
	let photos = $state<Record<string, AircraftPhoto>>({});
	$effect(() => {
		for (const { a } of items) {
			const key = a.hex.replace(/^~/, '');
			if (photos[key] || photoCache.has(key)) {
				if (!photos[key] && photoCache.has(key)) photos[key] = photoCache.get(key)!;
				continue;
			}
			getPhoto(key)
				.then((p) => {
					photoCache.set(key, p);
					photos[key] = p;
				})
				.catch(() => {});
		}
	});

	function badgeCls(label: string): string {
		if (label === 'Military') return 'bg-lime-500/20 text-lime-300';
		if (label === 'Interesting') return 'bg-amber-500/20 text-amber-300';
		return 'bg-cyan-500/20 text-cyan-300';
	}
</script>

<div class="flex h-full flex-col px-8 py-4 max-lg:h-auto max-lg:min-h-full max-lg:px-4">
	<div class="mb-3 flex items-baseline justify-between">
		<div>
			<span class="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">Interesting airframes</span>
			<span class="ml-3 text-xs text-muted-foreground">military · special · unusual type</span>
		</div>
		<div class="text-xs text-muted-foreground tabular-nums">{items.length} overhead</div>
	</div>

	{#if items.length === 0}
		<div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
			<div class="flex h-24 w-24 items-center justify-center rounded-full border-2 border-border/40 text-5xl opacity-40">✈</div>
			<div class="text-lg">Nothing unusual in range</div>
			<div class="text-sm">Routine traffic only right now.</div>
		</div>
	{:else}
		<div class="grid flex-1 grid-cols-4 content-start gap-3 overflow-hidden max-lg:grid-cols-2 max-lg:overflow-visible">
			{#each items as { a, why } (a.hex)}
				{@const key = a.hex.replace(/^~/, '')}
				{@const photo = photos[key]}
				<PhotoCell
					src={photo?.thumbnail}
					alt={a.type_long ?? a.type ?? 'aircraft'}
					credit={photo?.photographer}
					class="aspect-[3/2]"
				>
					{#snippet fallback()}
						<div class="absolute inset-0 flex items-center justify-center text-3xl opacity-30">✈</div>
					{/snippet}

					<div class="absolute inset-x-0 bottom-0 flex flex-col gap-1 p-2.5">
						<div class="flex items-center justify-between gap-1">
							<span class="truncate font-bold text-white">{a.flight ?? a.registration ?? a.hex}</span>
							<span class="shrink-0 rounded px-1 text-[9px] font-bold uppercase {badgeCls(why)}">{why}</span>
						</div>
						<div class="truncate text-xs text-white/75">
							{a.type ?? '—'}{a.registration && a.flight ? ` · ${a.registration}` : ''}{a.operator ? ` · ${a.operator}` : ''}
						</div>
						<div class="flex justify-between text-[11px] tabular-nums text-white/60">
							<span>{a.on_ground ? 'GND' : a.flight_level ? 'FL' + a.flight_level : '—'}</span>
							{#if a.distance_nm != null}<span>{a.distance_nm.toFixed(0)} nm · {fmtBearing(a.bearing)}</span>{/if}
						</div>
					</div>
				</PhotoCell>
			{/each}
		</div>
	{/if}
</div>
