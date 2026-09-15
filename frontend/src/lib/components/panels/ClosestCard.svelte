<script lang="ts">
	import { radarStore } from '$lib/stores/radar.svelte';
	import { altColor, fmtBearing } from '$lib/utils/geo';
	import { getPhoto, photoCache, type AircraftPhoto } from '$lib/api/photo';
	import { getRoute, routeCache, airportCode } from '$lib/api/route';
	import { reactiveLookup } from '$lib/utils/lookup.svelte';
	import Silhouette, { silhouetteKind } from '$lib/components/Silhouette.svelte';

	// Compact closest-contact card with photo — used in the corner of the scopes.
	let a = $derived(radarStore.snapshot?.nearest?.[0] ?? null);
	let color = $derived(a ? altColor(a.flight_level, a.on_ground, !!a.emergency) : 'var(--alt-mid)');

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
	<div class="overflow-hidden rounded-lg border border-border/50 bg-card/50">
		{#if photo?.thumbnail}
			<img
				src={photo.thumbnail}
				alt={a.type_long ?? a.type ?? 'aircraft'}
				class="block h-auto w-full"
			/>
		{:else}
			<div class="flex aspect-[3/2] w-full items-center justify-center bg-black/20">
				<Silhouette kind={silhouetteKind(a)} color="var(--scope-terrain)" opacity={0.35} />
			</div>
		{/if}
		<div class="p-3">
			<div class="flex items-center justify-between">
				<span
					class="text-[9px] font-bold uppercase tracking-[0.2em] {a.emergency
						? 'text-red-300'
						: 'text-emerald-300'}"
				>
					{a.emergency ? 'Emergency' : 'Closest'}
				</span>
				<span class="text-[10px] tabular-nums text-cyan-300">{a.distance_nm?.toFixed(1)} nm</span>
			</div>
			<div class="truncate text-2xl font-bold leading-tight" style="color:{color}">
				{a.flight ?? a.hex}
			</div>
			{#if a.operator}
				<div class="truncate text-xs text-muted-foreground">{a.operator}</div>
			{/if}
			<div class="truncate text-[11px] text-muted-foreground">
				{a.type ?? ''}{a.type && a.registration ? ' · ' : ''}{a.registration ?? ''}
			</div>
			{#if rt && (rt.origin || rt.destination)}
				<div class="mt-1 truncate text-xs font-bold" style="color:{color}">
					{airportCode(rt.origin)} → {airportCode(rt.destination)}
				</div>
			{/if}
			<div class="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] tabular-nums">
				<div class="flex justify-between">
					<span class="text-muted-foreground">FL</span><span>{a.flight_level ?? '—'}</span>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">gs</span><span>{a.gs ?? '—'}</span>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">brg</span><span>{fmtBearing(a.bearing)}</span>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">trk</span><span>{fmtBearing(a.track)}</span>
				</div>
			</div>
		</div>
	</div>
{/if}
