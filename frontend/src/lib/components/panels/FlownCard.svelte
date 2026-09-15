<script lang="ts">
	import { onMount } from 'svelte';
	import { radarStore } from '$lib/stores/radar.svelte';
	import { altColor, fmtBearing } from '$lib/utils/geo';
	import { getPhoto, photoCache, type AircraftPhoto } from '$lib/api/photo';
	import { getRoute, routeCache, airportCode } from '$lib/api/route';
	import { flagUrl } from '$lib/api/flag';
	import { reactiveLookup } from '$lib/utils/lookup.svelte';
	import Silhouette, { silhouetteKind } from '$lib/components/Silhouette.svelte';

	// Aircraft on the scope that the user has flown on, nearest first.
	let flownOnScope = $derived(
		[...(radarStore.snapshot?.aircraft ?? [])]
			.filter((a) => a.flown && a.distance_nm != null)
			.sort((a, b) => (a.distance_nm as number) - (b.distance_nm as number))
	);

	// Rotate through them if there's more than one.
	let idx = $state(0);
	onMount(() => {
		const t = setInterval(() => (idx += 1), 6000);
		return () => clearInterval(t);
	});

	let a = $derived(flownOnScope.length ? flownOnScope[idx % flownOnScope.length] : null);
	let color = $derived(a ? altColor(a.flight_level, a.on_ground, !!a.emergency) : 'var(--flown)');

	// Countries the user has flown this airframe to, commonest first.
	let flags = $derived(
		(a?.flown_countries ?? []).map((code) => ({ code, url: flagUrl(code) })).filter((f) => f.url)
	);

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
	<div class="overflow-hidden rounded-lg border bg-card/50" style="border-color: var(--flown)">
		{#if photo?.thumbnail}
			<img
				src={photo.thumbnail}
				alt={a.type_long ?? a.type ?? 'aircraft'}
				class="block h-auto w-full"
			/>
		{:else}
			<div class="flex aspect-[3/2] w-full items-center justify-center bg-black/20">
				<Silhouette kind={silhouetteKind(a)} color="var(--flown)" opacity={0.35} />
			</div>
		{/if}
		<div class="p-3">
			<div class="flex items-center justify-between">
				<span
					class="text-[9px] font-bold uppercase tracking-[0.2em]"
					style="color: var(--flown)">✈ Flown</span
				>
				<span class="text-[10px] tabular-nums text-muted-foreground">
					{#if flownOnScope.length > 1}{(idx % flownOnScope.length) + 1}/{flownOnScope.length} ·
					{/if}{a.distance_nm?.toFixed(1)} nm
				</span>
			</div>
			<div class="truncate text-2xl font-bold leading-tight" style="color:{color}">
				{a.flight ?? a.registration ?? a.hex}
			</div>
			<div class="truncate text-[11px] text-muted-foreground">
				{a.registration ?? ''}{a.registration && (a.type_long || a.type) ? ' · ' : ''}{a.type_long ??
					a.type ??
					''}
			</div>
			{#if a.operator}
				<div class="truncate text-[11px] text-muted-foreground">{a.operator}</div>
			{/if}
			{#if rt && (rt.origin || rt.destination)}
				<div class="mt-1 truncate text-xs font-bold" style="color:{color}">
					{airportCode(rt.origin)} → {airportCode(rt.destination)}
				</div>
			{/if}
			{#if flags.length}
				<div class="mt-2 flex items-center gap-2 border-t border-border/40 pt-2">
					<span class="text-[9px] uppercase tracking-[0.15em] text-muted-foreground">Flown to</span>
					<span class="flex flex-wrap items-center gap-1">
						{#each flags as f (f.code)}
							<img
								src={f.url}
								alt={f.code}
								title={f.code}
								class="h-3 w-[18px] rounded-[2px] object-cover ring-1 ring-white/15"
								onerror={(e) => ((e.currentTarget as HTMLImageElement).hidden = true)}
							/>
						{/each}
					</span>
				</div>
			{/if}
		</div>
	</div>
{/if}
