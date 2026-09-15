<script lang="ts">
	import { radarStore } from '$lib/stores/radar.svelte';
	import { altColor, fmtBearing } from '$lib/utils/geo';
	import { getPhoto, photoCache, type AircraftPhoto } from '$lib/api/photo';
	import Silhouette, { silhouetteKind } from '$lib/components/Silhouette.svelte';
	import PhotoCell from '$lib/components/PhotoCell.svelte';
	import type { Aircraft } from '$lib/types/radar';

	let ac = $derived(radarStore.snapshot?.aircraft ?? []);

	const photoKey = (a: Aircraft) => a.hex.replace(/^~/, '');

	function pick(
		filter: (a: Aircraft) => boolean,
		score: (a: Aircraft) => number,
		want: 'max' | 'min'
	): Aircraft | null {
		const pool = ac.filter(filter);
		if (pool.length === 0) return null;
		return pool.reduce((best, a) =>
			want === 'max' ? (score(a) > score(best) ? a : best) : score(a) < score(best) ? a : best
		);
	}

	let cards = $derived([
		{
			label: 'Fastest',
			accent: 'text-cyan-300',
			a: pick((a) => a.gs != null, (a) => a.gs!, 'max'),
			value: (a: Aircraft) => `${a.gs} kt`
		},
		{
			label: 'Highest',
			accent: 'text-sky-300',
			a: pick((a) => a.flight_level != null, (a) => a.flight_level!, 'max'),
			value: (a: Aircraft) => `FL${a.flight_level}`
		},
		{
			label: 'Lowest airborne',
			accent: 'text-amber-300',
			a: pick((a) => !a.on_ground && (a.flight_level ?? 0) > 0, (a) => a.flight_level!, 'min'),
			value: (a: Aircraft) => `FL${a.flight_level}`
		},
		{
			label: 'Furthest',
			accent: 'text-emerald-300',
			a: pick((a) => a.distance_nm != null, (a) => a.distance_nm!, 'max'),
			value: (a: Aircraft) => `${a.distance_nm!.toFixed(0)} nm`
		},
		{
			label: 'Just acquired',
			accent: 'text-violet-300',
			a: pick((a) => a.messages != null, (a) => a.messages!, 'min'),
			value: (a: Aircraft) => `${a.messages} msgs`
		},
		{
			label: 'Strongest signal',
			accent: 'text-emerald-300',
			a: pick((a) => a.rssi != null, (a) => a.rssi!, 'max'),
			value: (a: Aircraft) => `${a.rssi} dB`
		}
	]);

	// Fetch a thumbnail per card aircraft, sharing the global photo cache with
	// the Spotlight and scope cards so we never refetch the same hex.
	let photos = $state<Record<string, AircraftPhoto>>({});
	const requested = new Set<string>();
	$effect(() => {
		for (const c of cards) {
			if (!c.a) continue;
			const key = photoKey(c.a);
			const cached = photoCache.get(key);
			if (cached) {
				if (photos[key] !== cached) photos = { ...photos, [key]: cached };
				continue;
			}
			if (requested.has(key)) continue;
			requested.add(key);
			getPhoto(key)
				.then((p) => {
					photoCache.set(key, p);
					photos = { ...photos, [key]: p };
				})
				.catch(() => requested.delete(key));
		}
	});
</script>

<div class="flex h-full flex-col px-8 py-4 max-lg:h-auto max-lg:min-h-full max-lg:px-4">
	<div class="mb-3 flex items-baseline justify-between">
		<div>
			<span class="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">Movers & extremes</span>
			<span class="ml-3 text-xs text-muted-foreground">the edges of the picture right now</span>
		</div>
		<div class="text-xs text-muted-foreground tabular-nums">{ac.length} tracked</div>
	</div>

	<div class="grid min-h-0 flex-1 grid-cols-3 grid-rows-2 gap-4 max-lg:flex-none max-lg:grid-cols-1 max-lg:grid-rows-none">
		{#each cards as c (c.label)}
			{@const a = c.a}
			{@const photo = a ? photos[photoKey(a)] : null}
			<PhotoCell
				src={photo?.thumbnail}
				alt={a?.type_long ?? a?.type ?? 'aircraft'}
				credit={photo?.photographer}
			>
				{#snippet fallback()}
					{#if a}
						<div class="pointer-events-none absolute inset-0 flex items-center justify-center">
							<Silhouette kind={silhouetteKind(a)} color="var(--scope-terrain)" opacity={0.2} />
						</div>
					{/if}
				{/snippet}

				<div class="relative flex h-full flex-col justify-between p-5">
					<div class="text-[10px] uppercase tracking-widest text-white/60">{c.label}</div>
					{#if a}
						<div>
							<div class="text-5xl font-bold tabular-nums {c.accent}">{c.value(a)}</div>
							<div class="mt-2 text-2xl font-bold" style="color:{altColor(a.flight_level, a.on_ground, !!a.emergency)}">
								{a.flight ?? a.registration ?? a.hex}
							</div>
							<div class="mt-0.5 truncate text-xs text-white/70">
								{a.operator ?? a.type_long ?? a.type ?? a.hex}
							</div>
							<div class="text-[11px] text-white/60 tabular-nums">
								{a.distance_nm != null ? `${a.distance_nm.toFixed(1)} nm · ${fmtBearing(a.bearing)}` : ''}
								{a.flight_level ? ` · FL${a.flight_level}` : ''}
							</div>
						</div>
					{:else}
						<div class="text-2xl text-muted-foreground/40">—</div>
					{/if}
				</div>
			</PhotoCell>
		{/each}
	</div>
</div>
