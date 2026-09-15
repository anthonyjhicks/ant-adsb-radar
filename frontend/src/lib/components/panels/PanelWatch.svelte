<script lang="ts">
	// Emergency watch. Outside an emergency this view is out of the rotation
	// entirely (the kiosk only raises it when something is squawking), so the
	// all-quiet state below is what you get from ?view=watch — not something the
	// wall display cycles past. When an emergency is live the kiosk holds here
	// until it clears, so this is a deep-dive on the aircraft, not a summary:
	// the radar scope on the left, fitted to the emergency contact with a target
	// reticle and its route; the photo and full detail on the right.
	import { radarStore } from '$lib/stores/radar.svelte';
	import { altColor, cpaToStation, fmtBearing, type CPA } from '$lib/utils/geo';
	import { formatDuration } from '$lib/utils/format';
	import { getPhoto, photoCache, type AircraftPhoto } from '$lib/api/photo';
	import { getRoute, routeCache } from '$lib/api/route';
	import { getAircraft, aircraftCache } from '$lib/api/aircraft';
	import { getAircraftHistory, aircraftHistoryCache } from '$lib/api/history';
	import { logoUrl } from '$lib/api/logo';
	import { reactiveLookup } from '$lib/utils/lookup.svelte';
	import PhotoFrame from '$lib/components/PhotoFrame.svelte';
	import Silhouette, { silhouetteKind } from '$lib/components/Silhouette.svelte';
	import PanelScope from './PanelScope.svelte';
	import type { Aircraft } from '$lib/types/radar';

	let snap = $derived(radarStore.snapshot);
	let ac = $derived(snap?.aircraft ?? []);
	let rx = $derived(snap?.receiver ?? null);

	// Special Mode A squawks worth surfacing. These are NOT what makes the kiosk
	// hold on this view — that's the backend's `emergency` flag (7500/7600/7700
	// and the ADS-B emergency field). 0000 in particular is common enough that
	// locking the display on it would be noise.
	const SPECIAL: Record<string, string> = {
		'7500': 'Hijack',
		'7600': 'Radio failure',
		'7700': 'General emergency',
		'7777': 'Military / intercept',
		'7400': 'UAS lost link',
		'0000': 'Non-discrete'
	};

	function reason(a: Aircraft): string | null {
		if (a.emergency) return a.emergency;
		if (a.squawk && SPECIAL[a.squawk]) return SPECIAL[a.squawk];
		return null;
	}

	// Genuine emergencies first, then special squawks; closest first within each.
	let watch = $derived(
		ac
			.map((a) => ({ a, why: reason(a) }))
			.filter((w): w is { a: Aircraft; why: string } => w.why !== null)
			.sort((x, y) => {
				const rank = Number(!!y.a.emergency) - Number(!!x.a.emergency);
				return rank !== 0 ? rank : (x.a.distance_nm ?? 9e9) - (y.a.distance_nm ?? 9e9);
			})
	);

	// The one we hold on and detail in full.
	let primary = $derived(watch[0] ?? null);
	let a = $derived(primary?.a ?? null);
	let others = $derived(watch.slice(1));

	// Aircraft pressing IDENT (SPI) or flagged alert — informational only.
	let idents = $derived(ac.filter((x) => (x.spi || x.alert) && !reason(x)));

	// --- enrichment (same cached lookups the Spotlight uses) -------------------
	const route = reactiveLookup(getRoute, routeCache);
	$effect(() => route.load(a?.flight));
	let rt = $derived(route.value);

	const details = reactiveLookup(getAircraft, aircraftCache);
	$effect(() => details.load(a?.hex ? a.hex.replace(/^~/, '') : null));
	let det = $derived(details.value);

	const seen = reactiveLookup(getAircraftHistory, aircraftHistoryCache);
	$effect(() => seen.load(a?.hex ? a.hex.replace(/^~/, '') : null));
	let hist = $derived(seen.value);

	const NO_PHOTO: AircraftPhoto = { thumbnail: null, link: null, photographer: null };
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
			.catch(() => {
				// Lookup failed: say so rather than "looking" forever.
				if (!cancelled && a?.hex === hex) photo = NO_PHOTO;
			});
		return () => {
			cancelled = true;
		};
	});

	let logo = $derived(logoUrl(rt?.airline_iata));
	let logoBroken = $state(false);
	$effect(() => {
		void logo;
		logoBroken = false;
	});

	let owner = $derived(det?.owner ?? a?.operator ?? rt?.airline ?? null);
	let modelText = $derived(
		det?.type
			? `${det.manufacturer ? det.manufacturer + ' ' : ''}${det.type}`
			: (a?.type_long ?? a?.type ?? 'Unknown type')
	);
	let callSuffix = $derived((a?.flight ?? '').replace(/^[A-Za-z]+/, '').trim());
	let telephony = $derived(
		rt?.airline_callsign ? `${rt.airline_callsign}${callSuffix ? ' ' + callSuffix : ''}` : null
	);

	// Closest point of approach to the station, holding current track/speed.
	let cpa = $derived.by<CPA | null>(() => {
		if (!a || a.on_ground || a.lat == null || a.lon == null) return null;
		if (!rx || rx.lat == null || rx.lon == null) return null;
		return cpaToStation(rx.lat, rx.lon, a.lat, a.lon, a.gs, a.track);
	});

	// A contact with no position can't be put on the scope (Mode S only).
	let unplaced = $derived(!!a && (a.lat == null || a.distance_nm == null || a.bearing == null));

	function trendLabel(t: number, onGround: boolean): string {
		if (onGround) return 'ON GROUND';
		if (t > 0) return 'CLIMBING';
		if (t < 0) return 'DESCENDING';
		return 'LEVEL';
	}

	function shortDate(epoch: number): string {
		return new Date(epoch * 1000).toLocaleDateString('en-GB', {
			day: '2-digit',
			month: 'short',
			year: '2-digit',
			timeZone: 'UTC'
		});
	}

	function altText(x: Aircraft): string {
		if (x.on_ground) return 'GND';
		if (x.flight_level != null) return `FL${x.flight_level}`;
		if (x.alt_baro != null) return `${x.alt_baro.toLocaleString()} ft`;
		return '—';
	}
</script>

<div class="flex h-full flex-col px-8 py-4 max-lg:h-auto max-lg:min-h-full max-lg:px-4">
	<!-- Top line: the alarm when something's squawking, the watch title otherwise -->
	<div class="flex shrink-0 items-center gap-3">
		{#if primary && a}
			<span
				class="animate-pulse rounded-full bg-red-500/25 px-3 py-1 text-xs font-bold uppercase tracking-[0.25em] text-red-300"
			>
				{a.emergency ? 'Emergency' : 'Special squawk'}
			</span>
			<span class="text-lg font-bold uppercase tracking-wide text-red-300">{primary.why}</span>
			<span class="rounded bg-red-500/30 px-2 py-1 font-mono text-lg font-bold text-red-200">
				{a.squawk ?? '----'}
			</span>
		{:else}
			<span class="text-[11px] uppercase tracking-[0.3em] text-muted-foreground"
				>Emergency &amp; squawk watch</span
			>
		{/if}
		<div class="ml-auto flex items-center gap-2">
			{#if a?.flown}
				<span
					class="rounded bg-violet-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-violet-300"
					>Flown</span
				>
			{/if}
			{#if a?.mil}
				<span
					class="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-amber-300"
					>Military</span
				>
			{/if}
			{#if a?.interesting}
				<span
					class="rounded bg-sky-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-sky-300"
					>Interesting</span
				>
			{/if}
			<span class="text-xs tabular-nums text-muted-foreground">monitoring {ac.length} contacts</span>
		</div>
	</div>

	<div class="mt-3 flex min-h-0 flex-1 gap-4 max-lg:flex-col">
		<!-- The scope, fitted to the emergency contact (target reticle + bearing line) -->
		<div class="relative min-h-0 flex-1 max-lg:h-[60vh] max-lg:flex-none">
			<PanelScope bare hideCoverage showType focusHex={unplaced ? null : (a?.hex ?? null)} />
			{#if a && unplaced}
				<div
					class="absolute left-3 top-3 rounded border border-red-500/40 bg-background/80 px-2 py-1 text-[11px] uppercase tracking-widest text-red-300"
				>
					No position reported for {a.flight ?? a.hex}
				</div>
			{/if}
		</div>

		<!-- Photo + detail -->
		<aside class="flex w-[760px] shrink-0 flex-col gap-3 overflow-hidden max-lg:w-full">
			{#if !primary || !a}
				<!-- All quiet. Out of rotation, so this is only reachable via ?view=watch. -->
				<div
					class="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 rounded-lg border border-border/50 bg-card/40"
				>
					<div
						class="flex h-28 w-28 items-center justify-center rounded-full border-2 border-emerald-500/40 bg-emerald-500/10 text-6xl text-emerald-400"
					>
						✓
					</div>
					<div class="text-3xl font-bold tracking-wide text-emerald-300">ALL QUIET</div>
					<div class="text-sm text-muted-foreground">No emergencies or special squawks in range</div>
					{#if idents.length > 0}
						<div class="mt-2 flex flex-wrap items-center justify-center gap-2">
							<span class="text-[11px] uppercase tracking-widest text-muted-foreground"
								>Ident / alert:</span
							>
							{#each idents.slice(0, 8) as x (x.hex)}
								<span
									class="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300"
								>
									{x.flight ?? x.hex}
								</span>
							{/each}
						</div>
					{/if}
				</div>
			{:else}
				<!-- Photo: takes whatever height the detail below leaves -->
				<div
					class="relative min-h-[300px] flex-1 overflow-hidden rounded-lg border border-red-500/40 bg-black/30 max-lg:h-56 max-lg:flex-none"
				>
					{#if photo?.thumbnail}
						<PhotoFrame src={photo.thumbnail} alt={a.registration ?? a.hex} credit={photo.photographer} />
					{:else}
						<div class="flex h-full w-full flex-col items-center justify-center gap-2">
							<Silhouette kind={silhouetteKind(a)} color="var(--alt-mid)" opacity={0.3} />
							<span class="text-[11px] uppercase tracking-widest text-muted-foreground">
								{photo ? 'No photo on file' : 'Looking for a photo…'}
							</span>
						</div>
					{/if}
				</div>

				<!-- Identity -->
				<div class="flex shrink-0 items-end gap-4">
					<div class="min-w-0 flex-1">
						<div class="flex items-baseline gap-3">
							<div
								class="text-5xl font-bold leading-none tracking-tight"
								style="color:{altColor(a.flight_level, a.on_ground, true)}"
							>
								{a.flight ?? a.hex}
							</div>
							{#if rt?.flight_iata && rt.flight_iata !== a.flight}
								<div class="text-xl font-semibold text-muted-foreground">{rt.flight_iata}</div>
							{/if}
						</div>
						<div class="mt-2 flex items-center gap-3">
							{#if logo && !logoBroken}
								<img
									src={logo}
									alt=""
									class="h-7 w-7 shrink-0 rounded bg-white/5 object-contain p-0.5"
									onerror={() => (logoBroken = true)}
								/>
							{/if}
							{#if owner}
								<div class="truncate text-xl font-semibold text-foreground/85">{owner}</div>
							{/if}
							{#if telephony}
								<div class="shrink-0 text-xs uppercase tracking-widest text-muted-foreground">
									“{telephony}”
								</div>
							{/if}
						</div>
					</div>
					<div class="shrink-0 text-right">
						<div class="text-sm text-foreground/85">{modelText}</div>
						<div class="text-xs tabular-nums text-muted-foreground">
							{a.registration ?? '—'} · {a.hex}{#if a.type} · {a.type}{/if}{#if a.wake} · wake {a.wake}{/if}
						</div>
					</div>
				</div>

				<!-- Route -->
				{#if rt?.origin || rt?.destination}
					<div class="shrink-0 rounded-lg border border-border/50 bg-background/40 px-3 py-2">
						<div class="flex items-center justify-between gap-2 text-sm">
							<span class="font-semibold text-foreground/90"
								>{rt.origin?.iata ?? rt.origin?.icao ?? '???'}</span
							>
							<span class="flex-1 border-t border-dashed border-border/60"></span>
							{#if rt.midpoint}
								<span class="text-xs text-muted-foreground"
									>{rt.midpoint.iata ?? rt.midpoint.icao}</span
								>
								<span class="flex-1 border-t border-dashed border-border/60"></span>
							{/if}
							<span class="font-semibold text-foreground/90"
								>{rt.destination?.iata ?? rt.destination?.icao ?? '???'}</span
							>
						</div>
						<div class="mt-1 flex justify-between gap-3 text-[11px] text-muted-foreground">
							<span class="truncate">{rt.origin?.city ?? rt.origin?.name ?? ''}</span>
							<span class="truncate text-right"
								>{rt.destination?.city ?? rt.destination?.name ?? ''}</span
							>
						</div>
					</div>
				{/if}

				<!-- Live telemetry -->
				<div class="grid shrink-0 grid-cols-6 gap-2 text-center max-lg:grid-cols-3">
					{#each [{ k: 'Altitude', v: altText(a) }, { k: 'Ground speed', v: a.gs != null ? `${Math.round(a.gs)} kt` : '—' }, { k: 'Track', v: fmtBearing(a.track) }, { k: 'Range', v: a.distance_nm != null ? `${a.distance_nm.toFixed(1)} nm` : '—' }, { k: 'Bearing', v: fmtBearing(a.bearing) }, { k: 'Vertical', v: a.baro_rate != null ? `${a.baro_rate > 0 ? '+' : ''}${Math.round(a.baro_rate)} fpm` : '—' }] as cell (cell.k)}
						<div class="rounded border border-border/40 bg-background/40 px-2 py-1.5">
							<div class="text-[9px] uppercase tracking-widest text-muted-foreground">{cell.k}</div>
							<div class="text-base tabular-nums text-foreground/90">{cell.v}</div>
						</div>
					{/each}
				</div>

				<div class="flex shrink-0 flex-wrap gap-x-4 gap-y-1 text-[11px] uppercase tracking-widest">
					<span class="text-red-300">{trendLabel(a.vert_trend, a.on_ground)}</span>
					{#if a.category_label}<span class="text-muted-foreground">{a.category_label}</span>{/if}
					{#if a.pos_source}<span class="text-muted-foreground">via {a.pos_source}</span>{/if}
					{#if a.alert}<span class="text-amber-300">Alert</span>{/if}
					{#if a.spi}<span class="text-amber-300">Ident</span>{/if}
					{#if cpa?.approaching}
						<span class="text-amber-300"
							>CPA {cpa.distanceNm.toFixed(1)} nm in {cpa.minutes < 1 ? '<1' : cpa.minutes.toFixed(0)} min</span
						>
					{/if}
				</div>

				<!-- Signal + station history -->
				<div
					class="flex shrink-0 flex-wrap gap-x-4 gap-y-1 border-t border-border/40 pt-2 text-[11px] tabular-nums text-muted-foreground"
				>
					{#if a.rssi != null}<span>{a.rssi.toFixed(1)} dBFS</span>{/if}
					{#if a.messages != null}<span>{a.messages.toLocaleString()} msgs</span>{/if}
					{#if a.seen != null}<span>seen {formatDuration(Math.max(0, a.seen))} ago</span>{/if}
					{#if a.lat != null && a.lon != null}<span>{a.lat.toFixed(3)}, {a.lon.toFixed(3)}</span>{/if}
					{#if hist}
						<span
							>{hist.days_seen} day{hist.days_seen === 1 ? '' : 's'} logged here{#if hist.first_seen}
								· first {shortDate(hist.first_seen)}{/if}</span
						>
					{/if}
					{#if hist?.callsigns?.length}
						<span class="flex items-center gap-1"
							>seen here as
							{#each hist.callsigns.slice(0, 4) as cs (cs)}
								<span class="rounded border border-border/50 px-1.5 py-0.5 text-[10px]">{cs}</span>
							{/each}
						</span>
					{/if}
				</div>

				<!-- Any other emergencies, so a second one isn't lost behind the first -->
				{#if others.length > 0}
					<div class="shrink-0 overflow-hidden border-t border-border/40 pt-2">
						<div class="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">
							Also squawking ({others.length})
						</div>
						<div class="flex flex-col gap-1">
							{#each others.slice(0, 4) as { a: o, why } (o.hex)}
								<div
									class="flex items-baseline justify-between gap-2 rounded border border-red-500/30 bg-red-500/5 px-2 py-1 text-xs"
								>
									<span class="font-semibold text-red-300">{o.flight ?? o.hex}</span>
									<span class="truncate text-muted-foreground">{why}</span>
									<span class="shrink-0 tabular-nums text-muted-foreground">
										{o.squawk ?? '----'} · {altText(o)}{#if o.distance_nm != null}
											· {o.distance_nm.toFixed(1)} nm{/if}
									</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			{/if}
		</aside>
	</div>
</div>
