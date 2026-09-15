<script lang="ts">
	// Weather & Runways: an animated sky over the station — cloud decks at their
	// reported bases, rain/snow/fog/lightning, everything drifting with the wind
	// — from the METAR nearest the receiver, beside a card per configured
	// airport with its runway schematic, the wind-favoured ends lit, and the
	// head/crosswind on each.
	import { onMount } from 'svelte';
	import { DEFAULT_STATION } from '$lib/api/config';
	import { getMetars, type Metar } from '$lib/api/metar';
	import { radarStore } from '$lib/stores/radar.svelte';
	import { solar } from '$lib/utils/solar';
	import {
		categoryClass,
		compass16,
		conditionsHeadline,
		fmtAge,
		fmtFt,
		fmtVisibility,
		fmtWind,
		nearestStation,
		obsAgeMin,
		sceneConditions,
		skyLine
	} from '$lib/utils/weather';
	import WeatherScene from '$lib/components/weather/WeatherScene.svelte';
	import RunwayCard from './RunwayCard.svelte';

	// The runway cards, in this order — the station's weather airports from
	// /config. The sky follows whichever of them is nearest the receiver and
	// currently reporting (a heliport that only reports while open hands over
	// to the next-nearest overnight).
	let { icaos = DEFAULT_STATION.metar_stations }: { icaos?: string[] } = $props();
	let ICAOS = $derived(icaos.length ? icaos : DEFAULT_STATION.metar_stations);

	let metars = $state<Record<string, Metar>>({});
	let failed = $state(false);
	let now = $state(Date.now());

	async function load() {
		try {
			const list = await getMetars(ICAOS);
			const next: Record<string, Metar> = { ...metars };
			for (const m of list) next[m.icao] = m;
			metars = next;
			failed = false;
		} catch {
			failed = true; // keep showing the last good reports
		}
	}
	onMount(() => {
		load();
		const refresh = setInterval(load, 300_000); // METARs update ~half-hourly
		const clock = setInterval(() => (now = Date.now()), 30_000);
		return () => {
			clearInterval(refresh);
			clearInterval(clock);
		};
	});

	let snap = $derived(radarStore.snapshot);
	let rxLat = $derived(snap?.receiver?.lat ?? null);
	let rxLon = $derived(snap?.receiver?.lon ?? null);

	let reports = $derived(
		ICAOS.map((c) => metars[c]).filter((m): m is Metar => !!m?.available)
	);
	let nearest = $derived(
		rxLat != null && rxLon != null ? nearestStation(reports, rxLat, rxLon) : null
	);
	let local = $derived(nearest?.station ?? reports[0] ?? null);
	let cond = $derived(sceneConditions(local));
	let sun = $derived(rxLat != null && rxLon != null ? solar(rxLat, rxLon, new Date(now)) : null);
	let age = $derived(obsAgeMin(local?.obs_time, now));

	// "sky: Heathrow (EGLL) · 9.4 nm W · obs 14 min ago"
	let skyNote = $derived.by(() => {
		if (!local) return '';
		const parts = [`sky: ${local.name ?? local.icao} (${local.icao})`];
		if (nearest) parts.push(`${nearest.nm.toFixed(1)} nm ${compass16(nearest.bearing)}`);
		if (age != null) parts.push(`obs ${fmtAge(age)}`);
		return parts.join(' · ');
	});

	let flow = $derived.by(() => {
		if (cond.windFromDeg == null) return cond.windKt > 0 ? 'wind variable' : 'calm';
		const from = cond.windFromDeg;
		return `wind from ${String(from).padStart(3, '0')}° ${compass16(from)} → ${compass16((from + 180) % 360)}`;
	});
</script>

<div class="flex h-full flex-col px-8 py-4 max-lg:h-auto max-lg:min-h-full max-lg:px-4">
	<div class="mb-3 flex items-baseline justify-between gap-4">
		<div class="min-w-0">
			<span class="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">Weather & active runways</span>
			<span class="ml-3 text-xs text-muted-foreground">sky over the station from the nearest METAR · runway use derived from the wind</span>
		</div>
		<div class="shrink-0 text-xs text-muted-foreground tabular-nums">
			{#if failed && !local}
				<span class="text-amber-300">METAR feed unavailable</span>
			{:else if local}
				{skyNote}{#if failed}<span class="text-amber-300"> · refresh failed</span>{/if}
			{/if}
		</div>
	</div>

	<div class="flex min-h-0 flex-1 gap-4 max-lg:flex-col">
		<!-- the sky -->
		<section class="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-border/50 bg-card/40 max-lg:h-[62vh] max-lg:flex-none">
			<WeatherScene conditions={cond} sunElevation={sun?.elevation ?? 30} sunAzimuth={sun?.azimuth ?? null} />

			<!-- HUD: conditions (left) and the readouts (right) -->
			<div class="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-6 p-5" style="background: linear-gradient(to bottom, rgba(10,12,18,0.72), rgba(10,12,18,0));">
				<div class="min-w-0">
					<div class="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Sky over the station</div>
					<div class="mt-1 truncate text-3xl font-bold">{conditionsHeadline(local)}</div>
					<div class="mt-0.5 text-sm text-muted-foreground">{skyLine(local)}</div>
				</div>
				{#if local}
					<div class="grid shrink-0 grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-sm tabular-nums">
						<span class="col-span-2 justify-self-end rounded px-2 py-0.5 text-[11px] font-bold uppercase {categoryClass(local.flight_category)}">{local.flight_category ?? '—'}</span>
						<span class="text-muted-foreground">Wind</span><span class="text-right text-sky-300">{fmtWind(local)}</span>
						<span class="text-muted-foreground">Temp / dew</span><span class="text-right">{local.temp ?? '—'}° / {local.dewp ?? '—'}°</span>
						<span class="text-muted-foreground">QNH</span><span class="text-right">{local.qnh ?? '—'} hPa</span>
						<span class="text-muted-foreground">Visibility</span><span class="text-right">{fmtVisibility(local)}</span>
						<span class="text-muted-foreground">Ceiling</span><span class="text-right">{local.ceiling_ft != null ? fmtFt(local.ceiling_ft) : 'none'}</span>
					</div>
				{/if}
			</div>

			<div class="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 px-5 pb-3 pt-8" style="background: linear-gradient(to top, rgba(10,12,18,0.85), rgba(10,12,18,0));">
				<div class="min-w-0 truncate font-mono text-[11px] text-muted-foreground">{local?.raw ?? (failed ? 'no METAR available' : 'loading METAR…')}</div>
				<div class="shrink-0 text-[10px] uppercase tracking-widest text-muted-foreground">looking south · {flow}</div>
			</div>
		</section>

		<!-- the runways -->
		<aside class="grid w-[700px] shrink-0 grid-cols-2 grid-rows-2 gap-3 max-lg:w-full max-lg:grid-cols-1 max-lg:grid-rows-none">
			{#each ICAOS as code (code)}
				<RunwayCard icao={code} metar={metars[code]} />
			{/each}
		</aside>
	</div>
</div>
