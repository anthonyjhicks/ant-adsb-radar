<script lang="ts">
	import { onMount } from 'svelte';
	import { radarStore } from '$lib/stores/radar.svelte';
	import { fmtBearing } from '$lib/utils/geo';
	import { getPhoto, photoCache, type AircraftPhoto } from '$lib/api/photo';
	import { getRoute, routeCache, airportCode } from '$lib/api/route';
	import { reactiveLookup } from '$lib/utils/lookup.svelte';
	import Silhouette, { silhouetteKind } from '$lib/components/Silhouette.svelte';

	// Emergency / special-squawk aircraft (backend flags `emergency`), nearest first.
	let emergencies = $derived(
		[...(radarStore.snapshot?.emergencies ?? [])].sort(
			(a, b) => (a.distance_nm ?? 9e9) - (b.distance_nm ?? 9e9)
		)
	);

	let idx = $state(0);
	onMount(() => {
		const t = setInterval(() => (idx += 1), 6000);
		return () => clearInterval(t);
	});

	let a = $derived(emergencies.length ? emergencies[idx % emergencies.length] : null);

	const route = reactiveLookup(getRoute, routeCache);
	$effect(() => route.load(a?.flight));
	let rt = $derived(route.value);

	let photo = $state<AircraftPhoto | null>(null);
	$effect(() => {
		const hex = a?.hex;
		if (!hex) {
			photo = null;
			return;
		}
		const key = hex.replace(/^~/, '');
		const cached = photoCache.get(key);
		if (cached) {
			photo = cached;
			return;
		}
		photo = null;
		let cancelled = false;
		getPhoto(key)
			.then((p) => {
				photoCache.set(key, p);
				if (!cancelled && a?.hex === hex) photo = p;
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	});
</script>

{#if a}
	<div class="animate-pulse overflow-hidden rounded-lg border-2 border-red-500/70 bg-red-500/10">
		{#if photo?.thumbnail}
			<img
				src={photo.thumbnail}
				alt={a.type_long ?? a.type ?? 'aircraft'}
				class="block h-auto w-full"
			/>
		{:else}
			<div class="flex aspect-[3/2] w-full items-center justify-center bg-red-500/10">
				<Silhouette kind={silhouetteKind(a)} color="oklch(0.7 0.2 25)" opacity={0.4} />
			</div>
		{/if}
		<div class="p-3">
			<div class="flex items-center justify-between">
				<span class="text-[9px] font-bold uppercase tracking-[0.2em] text-red-300">⚠ Emergency</span>
				<span class="rounded bg-red-500/30 px-1.5 font-mono text-sm font-bold text-red-200">
					{a.squawk ?? '----'}
				</span>
			</div>
			<div class="truncate text-2xl font-bold leading-tight text-red-300">
				{a.flight ?? a.registration ?? a.hex}
			</div>
			<div class="text-sm font-bold uppercase tracking-wide text-red-300">{a.emergency}</div>
			{#if rt && (rt.origin || rt.destination)}
				<div class="truncate text-xs font-bold text-red-200/90">
					{airportCode(rt.origin)} → {airportCode(rt.destination)}
				</div>
			{/if}
			<div class="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-foreground/80 tabular-nums">
				{#if a.type}<span>{a.type}</span>{/if}
				<span>{a.on_ground ? 'GND' : a.flight_level ? 'FL' + a.flight_level : '—'}</span>
				{#if a.distance_nm != null}<span>{a.distance_nm.toFixed(1)} nm · {fmtBearing(a.bearing)}</span>{/if}
			</div>
		</div>
	</div>
{/if}
