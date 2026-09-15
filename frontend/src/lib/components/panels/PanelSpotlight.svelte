<script lang="ts">
	import { radarStore } from '$lib/stores/radar.svelte';
	import {
		altColor,
		fmtBearing,
		routeProgress,
		cpaToStation,
		type RouteProgress,
		type CPA
	} from '$lib/utils/geo';
	import { formatDuration } from '$lib/utils/format';
	import { getPhoto, photoCache, type AircraftPhoto } from '$lib/api/photo';
	import { getRoute, routeCache, airportCode } from '$lib/api/route';
	import { getAircraft, aircraftCache } from '$lib/api/aircraft';
	import { getAircraftHistory, aircraftHistoryCache } from '$lib/api/history';
	import { logoUrl } from '$lib/api/logo';
	import { reactiveLookup } from '$lib/utils/lookup.svelte';
	import PhotoFrame from '$lib/components/PhotoFrame.svelte';
	import Silhouette, { silhouetteKind } from '$lib/components/Silhouette.svelte';

	let snap = $derived(radarStore.snapshot);

	// The closest contact with a position (backend `nearest` is sorted by range).
	let a = $derived(snap?.nearest?.[0] ?? null);
	let rx = $derived(snap?.receiver ?? null);

	// Enrichment lookups, all cached + keyed so cards/scope share results.
	const route = reactiveLookup(getRoute, routeCache);
	$effect(() => route.load(a?.flight));
	let rt = $derived(route.value);

	const details = reactiveLookup(getAircraft, aircraftCache);
	$effect(() => details.load(a?.hex ? a.hex.replace(/^~/, '') : null));
	let det = $derived(details.value);

	const seen = reactiveLookup(getAircraftHistory, aircraftHistoryCache);
	$effect(() => seen.load(a?.hex ? a.hex.replace(/^~/, '') : null));
	let hist = $derived(seen.value);

	let color = $derived(a ? altColor(a.flight_level, a.on_ground, !!a.emergency) : 'var(--alt-mid)');

	// Pull a photo for the featured aircraft (cached by hex, via the backend
	// proxy to planespotters). Refetches only when the featured hex changes.
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

	// Airline tail logo (backend proxy → kiwi.com), keyed by IATA. It's a plain
	// <img>; onerror hides it. Reset the broken flag whenever the URL changes.
	let logo = $derived(logoUrl(rt?.airline_iata));
	let logoBroken = $state(false);
	$effect(() => {
		void logo;
		logoBroken = false;
	});

	// Who's operating: registered owner (adsbdb) is usually the richest, then the
	// callsign-prefix operator, then the route's airline name.
	let owner = $derived(det?.owner ?? a?.operator ?? rt?.airline ?? null);
	let ownerCountry = $derived(det?.owner_country ?? null);

	// Prefer adsbdb's specific model ("A319-111") with a manufacturer prefix;
	// fall back to the Mictronics full model ("AIRBUS A319"), which already
	// carries the maker, so it isn't prefixed again.
	let modelText = $derived(
		det?.type
			? `${det.manufacturer ? det.manufacturer + ' ' : ''}${det.type}`
			: (a?.type_long ?? a?.type ?? 'Unknown type')
	);

	// R/T telephony, e.g. "SPEEDBIRD 283" (callsign digits appended).
	let callSuffix = $derived((a?.flight ?? '').replace(/^[A-Za-z]+/, '').trim());
	let telephony = $derived(
		rt?.airline_callsign ? `${rt.airline_callsign}${callSuffix ? ' ' + callSuffix : ''}` : null
	);

	// Route progress along the origin→destination great circle.
	let prog = $derived.by<RouteProgress | null>(() => {
		if (!a || a.lat == null || a.lon == null) return null;
		const o = rt?.origin;
		const d = rt?.destination;
		if (!o || !d || o.lat == null || o.lon == null || d.lat == null || d.lon == null) return null;
		return routeProgress(o.lat, o.lon, a.lat, a.lon, d.lat, d.lon, a.gs);
	});

	// Closest point of approach to the station (holding current track/speed).
	let cpa = $derived.by<CPA | null>(() => {
		if (!a || a.on_ground || a.lat == null || a.lon == null) return null;
		if (!rx || rx.lat == null || rx.lon == null) return null;
		return cpaToStation(rx.lat, rx.lon, a.lat, a.lon, a.gs, a.track);
	});

	// Mini direction rose: blip at the contact's bearing, radius ∝ distance.
	const RC = 90;
	let blip = $derived.by(() => {
		if (!a || a.bearing == null || a.distance_nm == null) return null;
		const maxNm = Math.max(20, a.distance_nm);
		const r = (a.distance_nm / maxNm) * 72;
		const rad = (a.bearing * Math.PI) / 180;
		return { x: RC + r * Math.sin(rad), y: RC - r * Math.cos(rad) };
	});

	function trendLabel(t: number, onGround: boolean): string {
		if (onGround) return 'ON GROUND';
		if (t > 0) return 'CLIMBING';
		if (t < 0) return 'DESCENDING';
		return 'LEVEL';
	}

	function fmtNm(nm: number): string {
		return Math.round(nm).toLocaleString();
	}

	function shortDate(epoch: number): string {
		return new Date(epoch * 1000).toLocaleDateString('en-GB', {
			day: '2-digit',
			month: 'short',
			timeZone: 'UTC'
		});
	}

	function cpaLabel(c: CPA): string {
		if (!c.approaching) return 'receding';
		const t = c.minutes < 1 ? '<1m' : `${c.minutes.toFixed(0)}m`;
		return `${t} · ${c.distanceNm.toFixed(1)} nm`;
	}
</script>

<div class="flex h-full flex-col px-10 py-6 max-lg:h-auto max-lg:min-h-full max-lg:px-4">
	{#if a}
		<div class="flex items-center gap-3">
			<span
				class="rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.25em] {a.emergency
					? 'animate-pulse bg-red-500/25 text-red-300'
					: 'bg-emerald-500/15 text-emerald-300'}"
			>
				{a.emergency ? 'Emergency' : 'Closest Contact'}
			</span>
			<span class="text-xs uppercase tracking-widest text-muted-foreground">nearest to station</span>
			<div class="ml-auto flex items-center gap-2">
				{#if a.flown}
					<span class="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest bg-violet-500/20 text-violet-300">Flown</span>
				{/if}
				{#if a.mil}
					<span class="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest bg-amber-500/20 text-amber-300">Military</span>
				{/if}
				{#if a.interesting}
					<span class="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest bg-sky-500/20 text-sky-300">Interesting</span>
				{/if}
			</div>
		</div>

		<div class="mt-2 flex items-end gap-6 max-lg:flex-col max-lg:items-start max-lg:gap-3">
			<div class="min-w-0">
				<div class="flex items-baseline gap-3">
					<div class="text-7xl font-bold leading-none tracking-tight max-lg:text-5xl" style="color:{color}">
						{a.flight ?? a.hex}
					</div>
					{#if rt?.flight_iata && rt.flight_iata !== a.flight}
						<div class="text-2xl font-semibold text-muted-foreground">{rt.flight_iata}</div>
					{/if}
				</div>

				<!-- Operator + tail logo + telephony -->
				<div class="mt-2 flex items-center gap-3">
					{#if logo && !logoBroken}
						<img
							src={logo}
							alt=""
							class="h-8 w-8 shrink-0 rounded bg-white/5 object-contain p-0.5"
							onerror={() => (logoBroken = true)}
						/>
					{/if}
					{#if owner}
						<div class="truncate text-2xl font-semibold text-foreground/85">{owner}</div>
					{/if}
					{#if telephony}
						<div class="shrink-0 text-sm uppercase tracking-widest text-muted-foreground">“{telephony}”</div>
					{/if}
				</div>

				<!-- Aircraft type / manufacturer -->
				<div class="mt-1 text-lg text-foreground/70">
					{modelText}{#if a.type}<span class="text-sm text-muted-foreground"> ({a.type})</span>{/if}
				</div>

				<!-- IDs -->
				<div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
					<span class="font-mono">{a.hex}</span>
					{#if a.registration}<span>· {a.registration}</span>{/if}
					{#if ownerCountry}<span>· {ownerCountry}</span>{/if}
					{#if a.wake}<span>· wake {a.wake}</span>{/if}
					{#if a.category_label}<span>· {a.category_label}</span>{/if}
					{#if a.pos_source}<span>· {a.pos_source}</span>{/if}
				</div>
			</div>

			<div class="ml-auto flex items-end gap-4">
				<!-- Photo (bigger), or a silhouette placeholder when none is cached -->
				<div class="h-52 w-96 shrink-0 overflow-hidden rounded-lg border border-border/50 max-lg:w-full">
					{#if photo?.thumbnail}
						<PhotoFrame
							src={photo.thumbnail}
							alt={a.type_long ?? a.type ?? 'aircraft'}
							credit={photo.photographer ?? 'unknown'}
							maxImgPx={640}
						/>
					{:else}
						<div class="flex h-full w-full items-center justify-center bg-card/30">
							<div style="color:{color}">
								<Silhouette kind={silhouetteKind(a)} color="currentColor" opacity={0.4} />
							</div>
						</div>
					{/if}
				</div>
				<!-- direction rose -->
				<svg viewBox="0 0 {RC * 2} {RC * 2}" class="h-40 w-40 max-lg:hidden">
					<circle cx={RC} cy={RC} r="78" fill="var(--scope-bg)" stroke="var(--scope-line)" stroke-opacity="0.3" />
					<circle cx={RC} cy={RC} r="39" fill="none" stroke="var(--scope-line)" stroke-opacity="0.2" />
					{#each ['N', 'E', 'S', 'W'] as d, i (d)}
						{@const rad = (i * 90 * Math.PI) / 180}
						<text x={RC + 88 * Math.sin(rad)} y={RC - 88 * Math.cos(rad)} fill="var(--scope-line)" fill-opacity="0.6" font-size="13" font-family="monospace" text-anchor="middle" dominant-baseline="middle">{d}</text>
					{/each}
					<circle cx={RC} cy={RC} r="3" fill="var(--scope-sweep)" />
					{#if blip}
						<line x1={RC} y1={RC} x2={blip.x} y2={blip.y} stroke={color} stroke-opacity="0.4" stroke-width="1.5" />
						<circle cx={blip.x} cy={blip.y} r="6" fill={color} />
					{/if}
				</svg>
			</div>
		</div>

		<!-- Route strip: origin → [via] → destination with progress -->
		{#if rt && (rt.origin || rt.destination)}
			<div class="mt-5 rounded-lg border border-border/50 bg-card/30 px-6 py-4">
				<div class="flex items-center gap-4 text-sm">
					<div class="min-w-0">
						<div class="text-3xl font-bold" style="color:{color}">{airportCode(rt.origin)}</div>
						<div class="truncate text-muted-foreground">{rt.origin?.city ?? rt.origin?.name ?? '—'}</div>
					</div>
					<div class="flex flex-1 flex-col items-center gap-1">
						{#if prog}
							<div class="flex w-full items-center justify-between text-xs text-muted-foreground">
								<span>{fmtNm(prog.flownNm)} nm flown</span>
								{#if rt.midpoint}<span class="uppercase tracking-widest">via {airportCode(rt.midpoint)}</span>{/if}
								<span>{fmtNm(prog.remainingNm)} nm to run</span>
							</div>
							<div class="relative h-2 w-full rounded-full bg-border/40">
								<div class="absolute inset-y-0 left-0 rounded-full" style="width:{prog.pct}%; background:{color}"></div>
								<div class="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background" style="left:{prog.pct}%; background:{color}"></div>
							</div>
							<div class="flex w-full items-center justify-between text-xs">
								<span class="font-bold tabular-nums" style="color:{color}">{prog.pct.toFixed(0)}% complete</span>
								<span class="text-muted-foreground">{fmtNm(prog.totalNm)} nm total</span>
								<span class="text-muted-foreground">{prog.etaMin != null ? `ETA ${formatDuration(prog.etaMin * 60)}` : '—'}</span>
							</div>
						{:else}
							<div class="text-lg text-muted-foreground">→</div>
							{#if rt.midpoint}<div class="text-xs uppercase tracking-widest text-muted-foreground">via {airportCode(rt.midpoint)}</div>{/if}
						{/if}
					</div>
					<div class="min-w-0 text-right">
						<div class="text-3xl font-bold" style="color:{color}">{airportCode(rt.destination)}</div>
						<div class="truncate text-muted-foreground">{rt.destination?.city ?? rt.destination?.name ?? '—'}</div>
					</div>
				</div>
			</div>
		{/if}

		<!-- Big readouts -->
		<div class="mt-5 grid grid-cols-4 gap-4 max-lg:mt-3 max-lg:grid-cols-2">
			{#snippet stat(label: string, value: string, sub: string, accent = 'text-foreground')}
				<div class="rounded-lg border border-border/50 bg-card/40 px-5 py-4">
					<div class="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
					<div class="mt-1 text-4xl font-bold tabular-nums {accent}">{value}</div>
					<div class="text-xs text-muted-foreground">{sub}</div>
				</div>
			{/snippet}

			{@render stat(
				'Altitude',
				a.on_ground ? 'GND' : a.flight_level ? 'FL' + a.flight_level : '—',
				a.baro_rate ? `${a.baro_rate > 0 ? '+' : ''}${a.baro_rate} fpm` : trendLabel(a.vert_trend, a.on_ground)
			)}
			{@render stat('Ground speed', a.gs ? String(a.gs) : '—', 'knots', 'text-cyan-300')}
			{@render stat('Distance', a.distance_nm != null ? a.distance_nm.toFixed(1) : '—', 'nautical miles', 'text-emerald-300')}
			{@render stat('Bearing', fmtBearing(a.bearing), `track ${fmtBearing(a.track)}`, 'text-amber-300')}
		</div>

		<div class="mt-4 grid grid-cols-4 gap-4 text-sm max-lg:grid-cols-2">
			{#snippet mini(label: string, value: string, accent = 'text-foreground')}
				<div class="flex items-center justify-between rounded-md border border-border/40 bg-card/20 px-4 py-2">
					<span class="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
					<span class="font-bold tabular-nums {accent}">{value}</span>
				</div>
			{/snippet}
			{@render mini('Squawk', a.squawk ?? '----')}
			{@render mini('Signal', a.rssi != null ? `${a.rssi} dB` : '—')}
			{@render mini('CPA', cpa ? cpaLabel(cpa) : trendLabel(a.vert_trend, a.on_ground), cpa?.approaching ? 'text-emerald-300' : 'text-foreground')}
			{@render mini('Last seen', a.seen != null ? `${a.seen.toFixed(0)}s` : '—')}
		</div>

		<!-- Station sighting history for this airframe -->
		{#if hist && hist.days_seen > 0}
			<div class="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/40 pt-3 text-xs text-muted-foreground">
				<span class="uppercase tracking-widest text-foreground/60">Seen here</span>
				<span class="font-bold text-foreground/85">
					{hist.days_seen === 1 ? '1 day' : `${hist.days_seen} days`}
				</span>
				{#if hist.first_seen}<span>· first {shortDate(hist.first_seen)}</span>{/if}
				{#if hist.last_seen && hist.days_seen > 1}<span>· latest {shortDate(hist.last_seen)}</span>{/if}
				{#if hist.callsigns.length > 1}
					<span class="truncate">· as {hist.callsigns.slice(0, 5).join(', ')}</span>
				{/if}
			</div>
		{/if}
	{:else}
		<div class="flex h-full items-center justify-center text-muted-foreground">
			Acquiring contacts…
		</div>
	{/if}
</div>
