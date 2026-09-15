<script lang="ts">
	import { onMount } from 'svelte';
	import { radarStore } from '$lib/stores/radar.svelte';
	import { altColor } from '$lib/utils/geo';
	import type { Aircraft } from '$lib/types/radar';

	let snap = $derived(radarStore.snapshot);

	// The airborne picture: a contact needs a position (bearing + range) and a
	// barometric altitude to be placed in the 3D volume.
	let contacts = $derived(
		(snap?.aircraft ?? []).filter(
			(a) => a.distance_nm != null && a.bearing != null && a.alt_baro != null && !a.on_ground
		)
	);

	const W = 1280;
	const H = 720;
	const cx = 640; // ground origin (station) on screen
	const cy = 470;

	// Camera tilt: altitude rises nearly full-height up the screen (cos φ), while
	// the ground plane is foreshortened to ~40% (sin φ) for the 3D look.
	const PITCH = (24 * Math.PI) / 180;
	const sinP = Math.sin(PITCH);
	const cosP = Math.cos(PITCH);

	const groundPx = 380; // screen radius of the outermost range ring
	const altPx = 300; // screen rise of a full-scale-altitude contact

	function niceCeil(v: number, step: number): number {
		return Math.max(step, Math.ceil(v / step) * step);
	}
	let maxNm = $derived(niceCeil(Math.max(20, ...contacts.map((a) => a.distance_nm as number)), 20));
	let maxAlt = $derived(
		niceCeil(Math.max(38000, ...contacts.map((a) => a.alt_baro as number)), 5000)
	);
	let pxPerNm = $derived(groundPx / maxNm);

	// Range rings on the ground plane, and the altitude ticks for the centre pole.
	let rings = $derived(
		Array.from({ length: Math.floor(maxNm / (maxNm <= 40 ? 10 : maxNm <= 120 ? 40 : 80)) }, (_, i) =>
			(i + 1) * (maxNm <= 40 ? 10 : maxNm <= 120 ? 40 : 80)
		).filter((r) => r <= maxNm)
	);
	let altTicks = $derived(
		Array.from({ length: Math.floor(maxAlt / 10000) }, (_, i) => (i + 1) * 10000)
	);

	// Label only the nearest contacts to keep the volume readable.
	let labelHexes = $derived(
		new Set(
			[...contacts]
				.sort((a, b) => (a.distance_nm as number) - (b.distance_nm as number))
				.slice(0, 16)
				.map((a) => a.hex)
		)
	);

	// Auto-orbit. Yaw advances ~7.5°/s (a full turn every ~48s); paused for users
	// who prefer reduced motion, held at a pleasant three-quarter angle instead.
	let yaw = $state(0.6);
	onMount(() => {
		const reduce =
			typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (reduce) return;
		let raf = 0;
		let prev = 0;
		const tick = (t: number) => {
			if (prev) yaw = (yaw + ((t - prev) / 1000) * 0.131) % (Math.PI * 2);
			prev = t;
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	});

	// Project a world point (east/north in nm, altitude in ft) to the screen.
	// Yaw about the vertical axis, then tilt the camera down by PITCH.
	function project(eastNm: number, northNm: number, altFt: number) {
		const X = eastNm * pxPerNm;
		const Y = northNm * pxPerNm;
		const Z = (Math.max(0, altFt) / maxAlt) * altPx;
		const cosY = Math.cos(yaw);
		const sinY = Math.sin(yaw);
		const xr = X * cosY - Y * sinY;
		const yr = X * sinY + Y * cosY;
		return { x: cx + xr, y: cy - yr * sinP - Z * cosP, depth: yr };
	}

	// A ground-plane circle (range ring) as an SVG path, sampled and projected.
	function ringPath(r: number): string {
		let d = '';
		for (let i = 0; i <= 64; i++) {
			const t = (i / 64) * Math.PI * 2;
			const p = project(r * Math.sin(t), r * Math.cos(t), 0);
			d += `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)} `;
		}
		return d + 'Z';
	}

	type Plotted = {
		a: Aircraft;
		air: { x: number; y: number; depth: number };
		ground: { x: number; y: number; depth: number };
		color: string;
		size: number;
		near: number; // 0 (far) .. 1 (near camera) for depth shading
	};

	// Project every contact, then painter-sort far-to-near so nearer blips sit on
	// top. `near` drives a subtle size/opacity falloff that reads as depth.
	let plotted = $derived.by<Plotted[]>(() => {
		const span = maxNm * pxPerNm || 1;
		return contacts
			.map((a) => {
				const east = (a.distance_nm as number) * Math.sin(((a.bearing as number) * Math.PI) / 180);
				const north = (a.distance_nm as number) * Math.cos(((a.bearing as number) * Math.PI) / 180);
				const air = project(east, north, a.alt_baro as number);
				const ground = project(east, north, 0);
				const near = 1 - Math.min(1, Math.max(0, (air.depth + span) / (span * 2)));
				return {
					a,
					air,
					ground,
					color: altColor(a.flight_level, false, !!a.emergency),
					size: 3.5 + near * 2.5,
					near
				};
			})
			.sort((p, q) => q.air.depth - p.air.depth);
	});

	let poleTop = $derived(project(0, 0, maxAlt));
	let poleBase = $derived(project(0, 0, 0));
	let northMark = $derived(project(0, maxNm, 0));
</script>

<div class="flex h-full flex-col px-6 py-4 max-lg:h-auto max-lg:min-h-full max-lg:px-3">
	<div class="mb-1 flex items-baseline justify-between">
		<div>
			<span class="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">3D airspace</span>
			<span class="ml-3 text-xs text-muted-foreground">the live traffic volume · orbiting the station</span>
		</div>
		<div class="text-xs text-muted-foreground">{contacts.length} airborne</div>
	</div>

	<div class="min-h-0 flex-1 max-lg:h-[70vh] max-lg:flex-none">
		<svg viewBox="0 0 {W} {H}" class="h-full w-full" preserveAspectRatio="xMidYMid meet">
			<!-- ground-plane range rings -->
			{#each rings as r (r)}
				<path d={ringPath(r)} fill="none" stroke="var(--scope-line)" stroke-opacity="0.12" stroke-width="1" />
			{/each}

			<!-- centre altitude pole + FL ticks (fixed; the scene orbits around it) -->
			<line x1={poleBase.x} y1={poleBase.y} x2={poleTop.x} y2={poleTop.y} stroke="var(--scope-line)" stroke-opacity="0.18" stroke-width="1" />
			<circle cx={poleBase.x} cy={poleBase.y} r="4" fill="var(--scope-sweep)" />
			{#each altTicks as alt (alt)}
				{@const p = project(0, 0, alt)}
				<line x1={p.x - 5} y1={p.y} x2={p.x + 5} y2={p.y} stroke="var(--scope-line)" stroke-opacity="0.35" stroke-width="1" />
				<text x={p.x - 9} y={p.y + 4} fill="var(--scope-line)" fill-opacity="0.6" font-size="12" font-family="monospace" text-anchor="end">FL{alt / 100}</text>
			{/each}

			<!-- rotating north marker on the outer ring -->
			<text x={northMark.x} y={northMark.y + 4} fill="var(--scope-line)" fill-opacity="0.7" font-size="14" font-family="monospace" text-anchor="middle">N</text>

			<!-- contacts: ground shadow, drop stem, blip -->
			{#each plotted as p (p.a.hex)}
				<g class={p.a.emergency ? 'emerg' : ''}>
					<circle cx={p.ground.x} cy={p.ground.y} r="2" fill="var(--scope-line)" fill-opacity={0.12 + p.near * 0.18} />
					<line x1={p.ground.x} y1={p.ground.y} x2={p.air.x} y2={p.air.y} stroke={p.color} stroke-width="1.5" stroke-opacity={0.18 + p.near * 0.32} />
					{#if p.a.flown}
						<circle cx={p.air.x} cy={p.air.y} r={p.size + 3.5} fill="none" stroke="var(--flown)" stroke-width="1.5" />
					{/if}
					<circle cx={p.air.x} cy={p.air.y} r={p.size} fill={p.color} fill-opacity={0.55 + p.near * 0.45} />
					{#if labelHexes.has(p.a.hex)}
						<text x={p.air.x + p.size + 3} y={p.air.y + 4} fill={p.color} fill-opacity={0.5 + p.near * 0.45} font-size="12" font-family="monospace">
							{p.a.flight ?? p.a.hex}
						</text>
					{/if}
				</g>
			{/each}
		</svg>
	</div>

	<!-- legend -->
	<div class="mt-1 flex items-center gap-5 text-[11px] text-muted-foreground">
		{#each [['< FL100', 'var(--alt-low)'], ['FL100–250', 'var(--alt-mid)'], ['> FL250', 'var(--alt-high)']] as [label, c] (label)}
			<span class="flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-full" style="background:{c}"></span>{label}</span>
		{/each}
		<span class="flex items-center gap-1.5"><span style="color: var(--flown)">○</span> flown</span>
		<span class="ml-auto">height = altitude · stem to ground · orbit {maxNm}nm</span>
	</div>
</div>
