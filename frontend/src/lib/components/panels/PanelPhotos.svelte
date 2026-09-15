<script lang="ts">
	import { radarStore } from '$lib/stores/radar.svelte';
	import { fmtBearing } from '$lib/utils/geo';
	import { getPhoto, photoCache, type AircraftPhoto } from '$lib/api/photo';
	import { getRoute, routeCache, airportCode } from '$lib/api/route';
	import PhotoCell from '$lib/components/PhotoCell.svelte';
	import type { Aircraft } from '$lib/types/radar';

	// Photo-spotting mode: a 3×2 grid of the nearest photographed aircraft,
	// shown at the planespotters native ~500px (no upscaling — at grid size they
	// stay crisp). Served from the backend's permanent photo cache.
	let snap = $derived(radarStore.snapshot);
	let nearest = $derived(snap?.nearest ?? []);

	let photos = $state<Record<string, AircraftPhoto>>({});
	$effect(() => {
		for (const a of nearest) {
			const key = a.hex.replace(/^~/, '');
			if (photos[key]) continue;
			if (photoCache.has(key)) {
				photos[key] = photoCache.get(key)!;
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

	// The nearest six contacts that actually have a photo, closest first.
	let cells = $derived(
		nearest
			.filter((a) => photos[a.hex.replace(/^~/, '')]?.thumbnail)
			.sort((a, b) => (a.distance_nm ?? Infinity) - (b.distance_nm ?? Infinity))
			.slice(0, 6)
	);

	// Warm the route cache for whatever's on screen.
	$effect(() => {
		for (const a of cells) {
			const cs = a.flight?.trim();
			if (cs && !routeCache.has(cs)) getRoute(cs).then((r) => routeCache.set(cs, r)).catch(() => {});
		}
	});

	function photoFor(a: Aircraft): AircraftPhoto | undefined {
		return photos[a.hex.replace(/^~/, '')];
	}
	function routeLabel(a: Aircraft): string | null {
		if (!a.flight) return null;
		const r = routeCache.get(a.flight.trim());
		if (r && (r.origin || r.destination)) return `${airportCode(r.origin)} → ${airportCode(r.destination)}`;
		return null;
	}
</script>

<div class="grid h-full w-full grid-cols-3 grid-rows-2 gap-1.5 bg-black p-1.5 max-lg:h-auto max-lg:grid-cols-2 max-lg:grid-rows-3">
	{#each cells as a (a.hex)}
		{@const photo = photoFor(a)}
		<PhotoCell
			src={photo?.thumbnail}
			alt={a.type_long ?? a.type ?? 'aircraft'}
			credit={photo?.photographer}
			class="max-lg:aspect-[3/2]"
		>
			<!-- per-cell info -->
			<div class="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3">
				<div class="min-w-0">
					<div class="flex items-center gap-1.5">
						<span class="truncate text-2xl font-bold text-white max-lg:text-xl">{a.flight ?? a.registration ?? a.hex}</span>
						{#if a.flown}
							<span
								class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
								style="color: var(--flown); background: color-mix(in oklch, var(--flown) 24%, transparent);"
							>✈ Flown</span>
						{/if}
						{#if a.mil}<span class="rounded bg-lime-500/30 px-1.5 py-0.5 text-[10px] font-bold uppercase text-lime-200">Mil</span>{/if}
					</div>
					<div class="truncate text-sm text-white/75">
						{a.type ?? '—'}{a.operator ? ` · ${a.operator}` : a.registration ? ` · ${a.registration}` : ''}
					</div>
					{#if routeLabel(a)}<div class="truncate text-sm font-bold text-cyan-300">{routeLabel(a)}</div>{/if}
				</div>
				<div class="shrink-0 text-right tabular-nums text-white/85">
					<div class="text-lg font-bold">{a.on_ground ? 'GND' : a.flight_level ? 'FL' + a.flight_level : '—'}</div>
					{#if a.distance_nm != null}<div class="text-xs text-white/60">{a.distance_nm.toFixed(1)} nm · {fmtBearing(a.bearing)}</div>{/if}
				</div>
			</div>
		</PhotoCell>
	{/each}

	<!-- fill remaining slots so the grid stays a stable 3×2 -->
	{#each Array(Math.max(0, 6 - cells.length)) as _, i (i)}
		<div class="flex items-center justify-center rounded-md bg-neutral-900/40 max-lg:aspect-[3/2]">
			<span class="text-3xl opacity-20">✈</span>
		</div>
	{/each}
</div>
