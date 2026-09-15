<script lang="ts">
	import { onMount } from 'svelte';
	import { radarStore } from '$lib/stores/radar.svelte';
	import { RAD, solar } from '$lib/utils/solar';

	// Sun position + day/night for the receiver location, computed from lat/lon
	// and the current time (NOAA solar equations — no external data). Shows where
	// the sun is now, the day-night terminator direction, and the day's solar
	// timeline (sunrise / noon / sunset).
	let now = $state(new Date());
	onMount(() => {
		const t = setInterval(() => (now = new Date()), 30_000);
		return () => clearInterval(t);
	});

	let snap = $derived(radarStore.snapshot);
	let lat = $derived(snap?.receiver?.lat ?? null);
	let lon = $derived(snap?.receiver?.lon ?? null);

	let sun = $derived(lat != null && lon != null ? solar(lat, lon, now) : null);

	function hhmm(min: number | null): string {
		if (min == null || Number.isNaN(min)) return '--:--';
		const m = (((min % 1440) + 1440) % 1440);
		return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60) % 60).padStart(2, '0')}`;
	}
	function dur(min: number | null): string {
		if (min == null) return '—';
		const h = Math.floor(min / 60);
		return `${h}h ${Math.round(min % 60)}m`;
	}
	function compass(deg: number): string {
		const pts = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
		return pts[Math.round(deg / 22.5) % 16];
	}

	let phase = $derived.by(() => {
		const e = sun?.elevation ?? -90;
		if (e > 6) return { label: 'Daytime', cls: 'text-amber-300' };
		if (e > -0.833) return { label: 'Golden hour', cls: 'text-amber-300' };
		if (e > -6) return { label: 'Civil twilight', cls: 'text-sky-300' };
		if (e > -12) return { label: 'Nautical twilight', cls: 'text-violet-300' };
		if (e > -18) return { label: 'Astronomical twilight', cls: 'text-violet-300' };
		return { label: 'Night', cls: 'text-muted-foreground' };
	});

	// --- sky-dome geometry (side view) ---------------------------------------
	const W = 900;
	const H = 520;
	const cx = W / 2;
	const horizonY = H - 90;
	const R = 330;
	// East (az<180) on the left, West (az>180) on the right; south at apex.
	let sunXY = $derived.by(() => {
		const e = sun?.elevation ?? -90;
		const az = sun?.azimuth ?? 180;
		const x = cx + R * Math.sin((az - 180) * RAD);
		const y = horizonY - (Math.max(-18, Math.min(90, e)) / 90) * R;
		return { x, y, up: e > -0.833 };
	});
</script>

<div class="flex h-full w-full gap-6 px-8 py-4 max-lg:flex-col max-lg:px-4">
	<!-- sky dome / sun path -->
	<div class="relative flex h-full flex-1 flex-col">
		<div class="mb-2 flex items-baseline justify-between">
			<div>
				<span class="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">Daylight</span>
				<span class="ml-3 text-xs text-muted-foreground">sun position & day-night over the station</span>
			</div>
			{#if sun}
				<div class="text-xs tabular-nums {phase.cls}">{phase.label}</div>
			{/if}
		</div>

		<div class="min-h-0 flex-1 max-lg:h-[46vh] max-lg:flex-none">
			{#if sun}
				<svg viewBox="0 0 {W} {H}" class="h-full w-full" preserveAspectRatio="xMidYMid meet">
					<defs>
						<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
							<stop offset="0%" stop-color="var(--alt-high)" stop-opacity={sunXY.up ? 0.18 : 0.05} />
							<stop offset="100%" stop-color="var(--alt-low)" stop-opacity={sunXY.up ? 0.14 : 0.03} />
						</linearGradient>
						<radialGradient id="sunglow">
							<stop offset="0%" stop-color="var(--alt-low)" stop-opacity="0.95" />
							<stop offset="100%" stop-color="var(--alt-low)" stop-opacity="0" />
						</radialGradient>
					</defs>

					<!-- sky fill under the dome -->
					<path d="M {cx - R} {horizonY} A {R} {R} 0 0 1 {cx + R} {horizonY} Z" fill="url(#sky)" />

					<!-- elevation arcs (0/30/60°) -->
					{#each [30, 60] as el (el)}
						{@const rr = (el / 90) * R}
						<path
							d="M {cx - rr} {horizonY} A {rr} {rr} 0 0 1 {cx + rr} {horizonY}"
							fill="none"
							stroke="var(--scope-line)"
							stroke-opacity="0.14"
							stroke-width="1"
						/>
						<text x={cx + 6} y={horizonY - rr + 4} fill="var(--scope-line)" fill-opacity="0.5" font-size="13" font-family="monospace">{el}°</text>
					{/each}

					<!-- dome outline -->
					<path d="M {cx - R} {horizonY} A {R} {R} 0 0 1 {cx + R} {horizonY}" fill="none" stroke="var(--scope-line)" stroke-opacity="0.3" stroke-width="1.5" />

					<!-- horizon -->
					<line x1={cx - R - 30} y1={horizonY} x2={cx + R + 30} y2={horizonY} stroke="var(--scope-terrain)" stroke-opacity="0.7" stroke-width="2" />
					<text x={cx - R - 24} y={horizonY + 22} fill="var(--scope-line)" fill-opacity="0.65" font-size="15" font-family="monospace">E</text>
					<text x={cx} y={horizonY + 22} fill="var(--scope-line)" fill-opacity="0.65" font-size="15" font-family="monospace" text-anchor="middle">S</text>
					<text x={cx + R + 24} y={horizonY + 22} fill="var(--scope-line)" fill-opacity="0.65" font-size="15" font-family="monospace" text-anchor="end">W</text>

					<!-- sunrise / noon / sunset markers -->
					<circle cx={cx - R} cy={horizonY} r="4" fill="var(--alt-low)" fill-opacity="0.7" />
					<text x={cx - R} y={horizonY + 40} fill="var(--alt-low)" fill-opacity="0.85" font-size="14" font-family="monospace" text-anchor="middle">↑ {hhmm(sun.sunriseMin)}</text>
					<circle cx={cx} cy={horizonY - R} r="4" fill="var(--scope-line)" fill-opacity="0.7" />
					<text x={cx} y={horizonY - R - 10} fill="var(--scope-line)" fill-opacity="0.8" font-size="14" font-family="monospace" text-anchor="middle">noon {hhmm(sun.solarNoonMin)}</text>
					<circle cx={cx + R} cy={horizonY} r="4" fill="var(--alt-low)" fill-opacity="0.7" />
					<text x={cx + R} y={horizonY + 40} fill="var(--alt-low)" fill-opacity="0.85" font-size="14" font-family="monospace" text-anchor="middle">↓ {hhmm(sun.sunsetMin)}</text>

					<!-- the sun -->
					<circle cx={sunXY.x} cy={sunXY.y} r="34" fill="url(#sunglow)" opacity={sunXY.up ? 1 : 0.35} />
					<circle cx={sunXY.x} cy={sunXY.y} r="11" fill="var(--alt-low)" opacity={sunXY.up ? 1 : 0.4} stroke="var(--scope-sweep)" stroke-opacity="0.6" />
				</svg>
			{:else}
				<div class="flex h-full items-center justify-center text-sm text-muted-foreground">
					awaiting receiver position…
				</div>
			{/if}
		</div>
	</div>

	<!-- readout cards -->
	<div class="flex w-72 shrink-0 flex-col gap-3 pt-7 max-lg:w-full max-lg:pt-0">
		<div class="grid grid-cols-2 gap-3">
			<div class="rounded-lg border border-border/50 bg-card/40 p-3">
				<div class="text-[10px] uppercase tracking-widest text-muted-foreground">Elevation</div>
				<div class="text-2xl font-bold tabular-nums text-amber-300">{(sun?.elevation ?? 0).toFixed(1)}°</div>
			</div>
			<div class="rounded-lg border border-border/50 bg-card/40 p-3">
				<div class="text-[10px] uppercase tracking-widest text-muted-foreground">Azimuth</div>
				<div class="text-2xl font-bold tabular-nums text-amber-300">{Math.round(sun?.azimuth ?? 0)}°</div>
				<div class="text-[11px] text-muted-foreground">{sun ? compass(sun.azimuth) : '—'}</div>
			</div>
		</div>

		<div class="rounded-lg border border-border/50 bg-card/40 p-4">
			<div class="flex items-center justify-between">
				<span class="flex items-center gap-2 text-sm"><span class="text-amber-300">↑</span> Sunrise</span>
				<span class="text-lg font-bold tabular-nums text-sky-300">{hhmm(sun?.sunriseMin ?? null)}</span>
			</div>
			<div class="mt-1 flex items-center justify-between">
				<span class="flex items-center gap-2 text-sm"><span class="text-amber-300">↓</span> Sunset</span>
				<span class="text-lg font-bold tabular-nums text-sky-300">{hhmm(sun?.sunsetMin ?? null)}</span>
			</div>
			<div class="mt-2 flex items-center justify-between border-t border-border/40 pt-2 text-muted-foreground">
				<span class="text-xs">Day length</span>
				<span class="text-sm font-bold tabular-nums">{dur(sun?.dayLengthMin ?? null)}</span>
			</div>
		</div>

		<div class="rounded-lg border border-border/50 bg-card/40 p-4">
			<div class="text-[10px] uppercase tracking-widest text-muted-foreground">Civil twilight</div>
			<div class="mt-1 flex items-center justify-between text-sm">
				<span class="text-muted-foreground">dawn {hhmm(sun?.civilDawnMin ?? null)}</span>
				<span class="text-muted-foreground">dusk {hhmm(sun?.civilDuskMin ?? null)}</span>
			</div>
			<div class="mt-2 flex items-center justify-between border-t border-border/40 pt-2">
				<span class="text-xs text-muted-foreground">Now</span>
				<span class="text-sm font-bold tabular-nums {phase.cls}">{phase.label}</span>
			</div>
		</div>

		<p class="px-1 text-[11px] leading-relaxed text-muted-foreground/70">
			Computed from the station's latitude/longitude (NOAA solar equations), UTC. The sun rides
			the dome from sunrise in the east, through solar noon, to sunset in the west; below the
			horizon it dims into twilight.
		</p>
	</div>
</div>
