<script lang="ts">
	import { radarStore } from '$lib/stores/radar.svelte';
	import { scopeSettings } from '$lib/stores/scopeSettings.svelte';
	import {
		polarToXY,
		leaderEnd,
		geoToXY,
		greatCircle,
		altColor,
		ringValues,
		fmtBearing,
		COMPASS_POINTS,
		type XY
	} from '$lib/utils/geo';
	import type { Aircraft } from '$lib/types/radar';
	import { getRoute, routeCache, airportCode } from '$lib/api/route';
	import { reactiveLookup } from '$lib/utils/lookup.svelte';
	import { AIRPORTS } from '$lib/data/airports';
	import { AIRSPACE } from '$lib/data/airspace';
	import coastline from '$lib/data/coastline.json';
	import land from '$lib/data/land.json';
	import rivers from '$lib/data/rivers.json';
	import ClosestCard from './ClosestCard.svelte';
	import FlownCard from './FlownCard.svelte';
	import EmergencyCard from './EmergencyCard.svelte';

	// fixedNm: lock the outer range (e.g. a tight local/terminal view) instead of
	// auto-fitting to traffic. showType: add the type designator to data tags
	// (there's room when zoomed in). hideCoverage: drop the coverage rose.
	// focusHex: single out one contact — the scope auto-fits so it's in view,
	// draws a target reticle and a bearing line from the station, and shows its
	// route instead of the closest contact's (the Emergency Watch uses this).
	// bare: just the scope, no side cards or padding, for embedding in a view.
	let {
		fixedNm = null,
		showType = false,
		hideCoverage = false,
		focusHex = null,
		bare = false
	}: {
		fixedNm?: number | null;
		showType?: boolean;
		hideCoverage?: boolean;
		focusHex?: string | null;
		bare?: boolean;
	} = $props();

	const SIZE = 1000;
	const C = SIZE / 2; // center
	const R = 470; // outer scope radius (px in viewBox units)

	let snap = $derived(radarStore.snapshot);

	let positioned = $derived(
		(snap?.aircraft ?? []).filter(
			(a) => a.lat != null && a.bearing != null && a.distance_nm != null
		)
	);

	let focus = $derived(focusHex ? (positioned.find((a) => a.hex === focusHex) ?? null) : null);

	// Fixed range (local view), fitted to the focused contact, or auto-fit to
	// traffic, capped so a single far contact doesn't squash everyone into the
	// center. Contacts beyond clip.
	let outerNm = $derived.by(() => {
		if (fixedNm) return fixedNm;
		if (focus) {
			// Keep the focused contact inside ~70% of the radius, in ring steps.
			const rings = ringValues(Math.min(Math.max((focus.distance_nm as number) / 0.7, 5), 240));
			return rings[rings.length - 1];
		}
		const dists = positioned.map((a) => a.distance_nm as number).sort((x, y) => x - y);
		if (dists.length === 0) return 40;
		const p95 = dists[Math.floor(dists.length * 0.95)] ?? dists[dists.length - 1];
		const rings = ringValues(Math.min(Math.max(p95, 20), 160));
		return rings[rings.length - 1];
	});
	let pxPerNm = $derived(R / outerNm);
	let rings = $derived(ringValues(outerNm));

	// Velocity-leader length in minutes-ahead, scaled to the range so vectors
	// stay readable on the zoomed-out scope (small px/nm) without overshooting
	// the tight local view.
	let leaderMins = $derived(Math.min(2.5, Math.max(1, outerNm / 40)));

	let nearestHex = $derived(snap?.nearest?.[0]?.hex ?? null);

	// --- Faint geographic underlay (coastline + airports) ---
	// Stable receiver coords (primitives, so the projection only recomputes when
	// the receiver or scale actually changes — not on every snapshot tick).
	let rxLat = $derived(snap?.receiver?.lat ?? null);
	let rxLon = $derived(snap?.receiver?.lon ?? null);
	let clipId = $derived(`scopeclip-${fixedNm ?? 'auto'}`);

	// Project a list of [lon,lat] rings/lines into SVG point strings.
	function projectLines(lines: [number, number][][]): string[] {
		if (rxLat == null || rxLon == null) return [];
		return lines.map((line) =>
			line
				.map(([lon, lat]) => {
					const p = geoToXY(lat, lon, rxLat!, rxLon!, C, C, pxPerNm);
					return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
				})
				.join(' ')
		);
	}

	let landPaths = $derived(
		projectLines(land.polys as [number, number][][]).map((pts) => `M${pts.replace(/ /g, ' L')} Z`)
	);
	let riverPaths = $derived(projectLines(rivers.lines as [number, number][][]));
	let coastPaths = $derived(projectLines(coastline.lines as [number, number][][]));

	// Great-circle route of the featured contact (the focused one, else the
	// closest), projected onto the scope.
	let featured = $derived(focus ?? snap?.nearest?.[0] ?? null);
	const route = reactiveLookup(getRoute, routeCache);
	$effect(() => route.load(featured?.flight));
	let rt = $derived(route.value);

	let routePath = $derived.by(() => {
		const o = rt?.origin;
		const d = rt?.destination;
		if (rxLat == null || rxLon == null || o?.lat == null || o?.lon == null || d?.lat == null || d?.lon == null)
			return '';
		return greatCircle(o.lat, o.lon, d.lat, d.lon, 96)
			.map(([lat, lon]) => {
				const p = geoToXY(lat, lon, rxLat!, rxLon!, C, C, pxPerNm);
				return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
			})
			.join(' ');
	});

	let routeEnds = $derived.by(() => {
		if (rxLat == null || rxLon == null) return [];
		const ends: { x: number; y: number; code: string }[] = [];
		for (const ap of [rt?.origin, rt?.destination]) {
			if (ap?.lat == null || ap?.lon == null) continue;
			const p = geoToXY(ap.lat, ap.lon, rxLat, rxLon, C, C, pxPerNm);
			if (Math.hypot(p.x - C, p.y - C) <= R * 0.97) ends.push({ ...p, code: airportCode(ap) });
		}
		return ends;
	});

	let airportsVisible = $derived.by(() => {
		if (rxLat == null || rxLon == null) return [];
		return AIRPORTS.map((ap) => {
			const p = geoToXY(ap.lat, ap.lon, rxLat!, rxLon!, C, C, pxPerNm);
			const r = Math.hypot(p.x - C, p.y - C);
			return { ...ap, x: p.x, y: p.y, inScope: r <= R * 0.96 };
		}).filter((a) => a.inScope);
	});

	// Coverage rose, normalized to the outer ring so its directional shape reads
	// even though the scope is zoomed in tighter than max range.
	let coveragePath = $derived.by(() => {
		const polar = snap?.polar_range ?? [];
		if (polar.length < 3) return '';
		const polarMax = Math.max(...polar.map((p) => p[1])) || 1;
		const pts = polar.map(([deg, nm]) => {
			const r = (nm / polarMax) * (R * 0.96);
			const rad = (deg * Math.PI) / 180;
			return `${C + r * Math.sin(rad)},${C - r * Math.cos(rad)}`;
		});
		return `M${pts.join(' L')} Z`;
	});
	let coverageMaxNm = $derived(Math.max(0, ...(snap?.polar_range ?? []).map((p) => p[1])));

	function blip(a: Aircraft): XY {
		return polarToXY(a.bearing as number, a.distance_nm as number, C, C, pxPerNm);
	}
	function inView(a: Aircraft): boolean {
		return (a.distance_nm as number) <= outerNm;
	}
	let inViewAircraft = $derived(positioned.filter(inView));

	// Track trails: project each aircraft's accumulated position history.
	let trailPaths = $derived.by(() => {
		if (rxLat == null || rxLon == null) return [];
		const out: { hex: string; pts: string; color: string }[] = [];
		for (const a of inViewAircraft) {
			const tr = radarStore.trails.get(a.hex);
			if (!tr || tr.length < 2) continue;
			const pts = tr
				.map((p) => {
					const xy = geoToXY(p.lat, p.lon, rxLat!, rxLon!, C, C, pxPerNm);
					return `${xy.x.toFixed(1)},${xy.y.toFixed(1)}`;
				})
				.join(' ');
			out.push({ hex: a.hex, pts, color: altColor(a.flight_level, a.on_ground, !!a.emergency) });
		}
		return out;
	});

	// Airspace control-zone rings projected onto the scope (visible if on-screen).
	let airspaceCircles = $derived.by(() => {
		if (rxLat == null || rxLon == null) return [];
		return AIRSPACE.map((z) => {
			const c = geoToXY(z.lat, z.lon, rxLat!, rxLon!, C, C, pxPerNm);
			return { label: z.label, x: c.x, y: c.y, r: z.radiusNm * pxPerNm };
		}).filter((z) => Math.hypot(z.x - C, z.y - C) - z.r <= R);
	});
</script>

<div class="flex h-full w-full items-center justify-center {bare ? '' : 'gap-6 px-6 py-4'}">
	<!-- Scope -->
	<div class="relative flex h-full flex-1 items-center justify-center">
		<svg viewBox="0 0 {SIZE} {SIZE}" class="h-full max-h-full" style="max-width: 100%;">
			<defs>
				<radialGradient id="scopeGlow" cx="50%" cy="50%" r="50%">
					<stop offset="0%" stop-color="var(--scope-glow)" />
					<stop offset="70%" stop-color="transparent" />
				</radialGradient>
				<linearGradient id="sweepGrad" x1="0%" y1="0%" x2="100%" y2="0%">
					<stop offset="0%" stop-color="var(--scope-sweep)" stop-opacity="0" />
					<stop offset="100%" stop-color="var(--scope-sweep)" stop-opacity="0.35" />
				</linearGradient>
				<clipPath id={clipId}>
					<circle cx={C} cy={C} r={R} />
				</clipPath>
			</defs>

			<!-- backdrop -->
			<circle cx={C} cy={C} r={R} fill="var(--scope-bg)" />
			<circle cx={C} cy={C} r={R} fill="url(#scopeGlow)" />

			<!-- geographic underlay: each layer independently toggleable -->
			<g clip-path="url(#{clipId})">
				{#if scopeSettings.layers.map}
					{#each landPaths as d, i (i)}
						<path {d} fill="var(--scope-land)" stroke="none" />
					{/each}
					{#each riverPaths as pts, i (i)}
						<polyline points={pts} fill="none" stroke="var(--scope-river)" stroke-opacity="0.5" stroke-width="1" stroke-linejoin="round" />
					{/each}
					{#each coastPaths as pts, i (i)}
						<polyline points={pts} fill="none" stroke="var(--scope-terrain)" stroke-opacity="0.7" stroke-width="1" stroke-linejoin="round" />
					{/each}
				{/if}

				{#if scopeSettings.layers.airspace}
					{#each airspaceCircles as z (z.label)}
						<circle cx={z.x} cy={z.y} r={z.r} fill="none" stroke="var(--scope-airspace)" stroke-opacity="0.5" stroke-width="1" stroke-dasharray="2 4" />
						<text x={z.x} y={z.y - z.r - 3} fill="var(--scope-airspace)" fill-opacity="0.6" font-size="10" font-family="monospace" text-anchor="middle">{z.label}</text>
					{/each}
				{/if}

				{#if scopeSettings.layers.trails}
					{#each trailPaths as t (t.hex)}
						<polyline points={t.pts} fill="none" stroke={t.color} stroke-opacity="0.28" stroke-width="1.5" stroke-linejoin="round" />
					{/each}
				{/if}

				{#if scopeSettings.layers.airports}
					{#each airportsVisible as ap (ap.code)}
						<g>
							<rect x={ap.x - 2.5} y={ap.y - 2.5} width="5" height="5" fill="none" stroke="var(--scope-terrain)" stroke-opacity="0.7" stroke-width="1" />
							<text x={ap.x + 6} y={ap.y + 3.5} fill="var(--scope-terrain)" fill-opacity="0.7" font-size="11" font-family="monospace">{ap.code}</text>
						</g>
					{/each}
				{/if}
			</g>

			<!-- coverage rose -->
			{#if coveragePath && !hideCoverage && scopeSettings.layers.coverage}
				<path
					d={coveragePath}
					fill="var(--scope-line)"
					fill-opacity="0.06"
					stroke="var(--scope-line)"
					stroke-opacity="0.25"
					stroke-width="1.5"
					stroke-dasharray="4 5"
				/>
			{/if}

			<!-- range rings + spokes + compass -->
			{#if scopeSettings.layers.rings}
			{#each rings as nm (nm)}
				{@const rr = nm * pxPerNm}
				<circle
					cx={C}
					cy={C}
					r={rr}
					fill="none"
					stroke="var(--scope-line)"
					stroke-opacity="0.28"
					stroke-width="1"
				/>
				<text
					x={C + 4}
					y={C - rr + 16}
					fill="var(--scope-line)"
					fill-opacity="0.6"
					font-size="15"
					font-family="monospace">{nm}</text
				>
			{/each}

			<!-- bearing spokes every 30° -->
			{#each Array(12) as _, i (i)}
				{@const rad = (i * 30 * Math.PI) / 180}
				<line
					x1={C}
					y1={C}
					x2={C + R * Math.sin(rad)}
					y2={C - R * Math.cos(rad)}
					stroke="var(--scope-line)"
					stroke-opacity="0.12"
					stroke-width="1"
				/>
			{/each}

			<!-- compass labels -->
			{#each COMPASS_POINTS as cp (cp.deg)}
				{@const rad = (cp.deg * Math.PI) / 180}
				<text
					x={C + (R + 22) * Math.sin(rad)}
					y={C - (R + 22) * Math.cos(rad)}
					fill="var(--scope-line)"
					fill-opacity="0.75"
					font-size="22"
					font-weight="bold"
					font-family="monospace"
					text-anchor="middle"
					dominant-baseline="middle">{cp.label}</text
				>
			{/each}
			{/if}

			<!-- sweep -->
			{#if scopeSettings.layers.sweep}
			<g class="sweep" style="transform-origin: {C}px {C}px;">
				<path d="M{C},{C} L{C},{C - R} A{R},{R} 0 0 1 {C + R * Math.sin(Math.PI / 4)},{C - R * Math.cos(Math.PI / 4)} Z" fill="url(#sweepGrad)" />
				<line x1={C} y1={C} x2={C} y2={C - R} stroke="var(--scope-sweep)" stroke-width="2" stroke-opacity="0.8" />
			</g>
			{/if}

			<!-- closest contact's flight route (great circle) -->
			{#if routePath}
				<g clip-path="url(#{clipId})">
					<polyline
						points={routePath}
						fill="none"
						stroke="var(--route)"
						stroke-opacity="0.7"
						stroke-width="1.5"
						stroke-dasharray="6 4"
					/>
					{#each routeEnds as e (e.code)}
						<circle cx={e.x} cy={e.y} r="4" fill="none" stroke="var(--route)" stroke-width="1.5" />
						<text x={e.x + 7} y={e.y + 4} fill="var(--route)" font-size="13" font-weight="bold" font-family="monospace">{e.code}</text>
					{/each}
				</g>
			{/if}

			<!-- focused contact: bearing line from the station + a target reticle
			     (kept outside the flashing blip group so it holds steady) -->
			{#if focus}
				{@const fp = blip(focus)}
				<line x1={C} y1={C} x2={fp.x} y2={fp.y} stroke="var(--alt-emergency)" stroke-opacity="0.5" stroke-width="1" stroke-dasharray="3 5" />
				<text x={(C + fp.x) / 2 + 6} y={(C + fp.y) / 2 - 6} fill="var(--alt-emergency)" fill-opacity="0.85" font-size="13" font-family="monospace">{(focus.distance_nm as number).toFixed(1)} nm · {fmtBearing(focus.bearing)}</text>
				<circle cx={fp.x} cy={fp.y} r="16" fill="none" stroke="var(--alt-emergency)" stroke-width="2" />
				<circle class="focus-ring" cx={fp.x} cy={fp.y} r="27" fill="none" stroke="var(--alt-emergency)" stroke-width="1.5" stroke-dasharray="7 7" style="transform-origin: {fp.x}px {fp.y}px;" />
			{/if}

			<!-- aircraft -->
			{#each inViewAircraft as a (a.hex)}
				{@const p = blip(a)}
				{@const color = altColor(a.flight_level, a.on_ground, !!a.emergency)}
				{@const isNearest = a.hex === nearestHex}
				{@const isFocus = a.hex === focusHex}
				{@const end =
					a.gs && a.track != null ? leaderEnd(p, a.track, a.gs, pxPerNm, leaderMins) : null}
				<g class={a.emergency ? 'emerg' : ''}>
					{#if end && scopeSettings.layers.vectors}
						<line x1={p.x} y1={p.y} x2={end.x} y2={end.y} stroke={color} stroke-width="1.6" stroke-opacity="0.9" />
					{/if}
					{#if a.flown}
						<!-- aircraft the user has flown on -->
						<circle cx={p.x} cy={p.y} r="9" fill="none" stroke="var(--flown)" stroke-width="2" />
						<circle
							class="flown-ring"
							cx={p.x}
							cy={p.y}
							r="14"
							fill="none"
							stroke="var(--flown)"
							stroke-width="1"
							stroke-opacity="0.5"
						/>
					{/if}
					{#if isNearest}
						<circle cx={p.x} cy={p.y} r="11" fill="none" stroke="var(--scope-sweep)" stroke-width="1.5" />
					{/if}
					{#if a.mil}
						<!-- military: diamond outline -->
						<rect
							x={p.x - 6}
							y={p.y - 6}
							width="12"
							height="12"
							fill="none"
							stroke="var(--mil, #a3e635)"
							stroke-width="1.5"
							transform="rotate(45 {p.x} {p.y})"
						/>
					{/if}
					<circle cx={p.x} cy={p.y} r={a.on_ground ? 3 : 4.5} fill={color} />
					{#if (a.flight || a.flight_level) && scopeSettings.layers.labels}
						<text
							x={p.x + 8}
							y={p.y - 5}
							fill={color}
							fill-opacity={isNearest || isFocus ? '1' : '0.85'}
							font-size={isFocus ? '15' : '13'}
							font-family="monospace"
							font-weight={isNearest || isFocus ? 'bold' : 'normal'}
						>{a.flight ?? a.hex}</text>
						<text x={p.x + 8} y={p.y + 9} fill={color} fill-opacity="0.6" font-size="11" font-family="monospace"
							>{a.flight_level ? 'FL' + a.flight_level : ''}{a.gs ? ' ' + a.gs : ''}{showType &&
							a.type
								? ' ' + a.type
								: ''}</text
						>
					{/if}
				</g>
			{/each}

			<!-- receiver / station -->
			<g>
				<circle cx={C} cy={C} r="5" fill="var(--scope-sweep)" />
				<circle cx={C} cy={C} r="9" fill="none" stroke="var(--scope-sweep)" stroke-width="1.5" stroke-opacity="0.6" />
			</g>
		</svg>
	</div>

	<!-- Right column: closest + flown cards fill the height; compact legend pinned
	     below. Hidden on phones so the scope fills the screen (the same info is in
	     the rotating Closest Aircraft view), and in bare mode (the host view has
	     its own column). -->
	{#if !bare}
	<div class="flex h-full w-80 shrink-0 flex-col gap-3 overflow-hidden pt-1 text-xs max-lg:hidden">
		<ClosestCard />
		{#if (snap?.counts.emergencies ?? 0) > 0}
			<EmergencyCard />
		{:else}
			<FlownCard />
		{/if}

		<div class="shrink-0 space-y-2 rounded-lg border border-border/50 bg-card/40 p-3">
			<div class="flex items-baseline justify-between">
				<span class="text-[10px] uppercase tracking-widest text-muted-foreground">In view / range</span>
				<span class="text-xl font-bold tabular-nums text-cyan-300">
					{inViewAircraft.length}<span class="text-xs text-muted-foreground"> / {outerNm}nm</span>
				</span>
			</div>
			{#if coverageMaxNm > 0 && !hideCoverage}
				<div class="flex items-baseline justify-between text-[11px]">
					<span class="text-muted-foreground">Coverage</span>
					<span class="text-emerald-300/80">max {coverageMaxNm.toFixed(0)} nm</span>
				</div>
			{/if}
			<div class="flex flex-wrap gap-x-3 gap-y-1 border-t border-border/30 pt-2">
				{#each [['<FL100', 'var(--alt-low)'], ['FL100–250', 'var(--alt-mid)'], ['>FL250', 'var(--alt-high)'], ['GND', 'var(--alt-ground)'], ['EMRG', 'var(--alt-emergency)']] as [label, c] (label)}
					<span class="flex items-center gap-1 text-[10px] text-muted-foreground">
						<span class="h-2 w-2 rounded-full" style="background:{c}"></span>{label}
					</span>
				{/each}
			</div>
		</div>
	</div>
	{/if}
</div>

<style>
	@keyframes sweep-spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}
	.sweep {
		animation: sweep-spin 8s linear infinite;
	}
	@keyframes emerg-flash {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.25;
		}
	}
	.emerg {
		animation: emerg-flash 1s ease-in-out infinite;
	}
	@keyframes flown-pulse {
		0%,
		100% {
			stroke-opacity: 0.5;
		}
		50% {
			stroke-opacity: 0.15;
		}
	}
	.flown-ring {
		animation: flown-pulse 2s ease-in-out infinite;
	}
	@keyframes focus-spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}
	.focus-ring {
		animation: focus-spin 6s linear infinite;
	}
</style>
