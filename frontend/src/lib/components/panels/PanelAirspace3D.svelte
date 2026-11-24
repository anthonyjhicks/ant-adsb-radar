<script lang="ts">
	import { onMount } from 'svelte';
	import { radarStore } from '#lib/stores/radar.svelte.ts';
	import { altColor } from '#lib/utils/geo.ts';
	import type { Aircraft } from '#lib/types/radar.ts';

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

	// Screen rise of an altitude above its ground point. The camera only yaws
	// about the vertical axis, so this never changes as the scene orbits.
	function rise(altFt: number): number {
		return (Math.max(0, altFt) / maxAlt) * altPx * cosP;
	}

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
	// At this orbit speed 30 steps a second moves the outer ring under 2px per
	// step, so redraw at most that often.
	const ORBIT_FRAME_MS = 1000 / 30;
	let yaw = $state(0.6);
	onMount(() => {
		const reduce =
			typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (reduce) return;
		let raf = 0;
		let prev = 0;
		const tick = (t: number) => {
			raf = requestAnimationFrame(tick);
			if (!prev) prev = t;
			// A hair under the step so a 60 Hz display reliably draws every other frame.
			if (t - prev < ORBIT_FRAME_MS - 2) return;
			yaw = (yaw + (Math.min(t - prev, 250) / 1000) * 0.131) % (Math.PI * 2);
			prev = t;
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	});

	type Placed = {
		a: Aircraft;
		east: number; // ground position, screen px from the station
		north: number;
		rise: number; // screen px from the ground point up to the blip
		color: string;
		label: string | null;
	};

	// Everything about a contact that does not depend on the orbit. Recomputed
	// when the data changes (about once a second), not every orbit step.
	let placed = $derived<Placed[]>(
		contacts.map((a) => {
			const brg = ((a.bearing as number) * Math.PI) / 180;
			const nm = a.distance_nm as number;
			return {
				a,
				east: nm * Math.sin(brg) * pxPerNm,
				north: nm * Math.cos(brg) * pxPerNm,
				rise: rise(a.alt_baro as number),
				color: altColor(a.flight_level, false, !!a.emergency),
				label: labelHexes.has(a.hex) ? (a.flight ?? a.hex).trim() : null
			};
		})
	);

	// What orbits is drawn on a canvas laid over the SVG; the SVG keeps what
	// does not move. Range rings, the pole and its FL ticks are centred on the
	// station, and a circle about the yaw axis projects to the same ellipse at
	// any yaw, so the SVG never changes as the scene turns. Re-projecting and
	// restyling a few hundred SVG elements every step is what filled a Pi-class
	// main thread; repainting a canvas costs a fraction of that.
	let canvas = $state<HTMLCanvasElement>();
	let box = $state({ w: 0, h: 0, dpr: 1 });
	onMount(() => {
		const el = canvas;
		if (!el) return;
		const ro = new ResizeObserver(([e]) => {
			const dpr = window.devicePixelRatio || 1;
			el.width = Math.round(e.contentRect.width * dpr);
			el.height = Math.round(e.contentRect.height * dpr);
			box = { w: e.contentRect.width, h: e.contentRect.height, dpr };
		});
		ro.observe(el);
		return () => ro.disconnect();
	});

	// The canvas cannot take `var(--…)`, so read the theme colours off it.
	const resolved = new Map<string, string>();
	function cssColor(el: HTMLCanvasElement, c: string): string {
		const name = /^var\((--[\w-]+)\)$/.exec(c)?.[1];
		if (!name) return c;
		let v = resolved.get(name);
		if (v === undefined) resolved.set(name, (v = getComputedStyle(el).getPropertyValue(name).trim()));
		return v;
	}

	$effect(() => {
		const ctx = canvas?.getContext('2d');
		if (!ctx || !box.w) return;
		draw(ctx, box, yaw, placed);
	});

	function draw(ctx: CanvasRenderingContext2D, { w, h, dpr }: typeof box, at: number, items: Placed[]) {
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
		// The SVG's user space: viewBox 0 0 W H, preserveAspectRatio xMidYMid meet.
		const k = Math.min(w / W, h / H);
		ctx.setTransform(k * dpr, 0, 0, k * dpr, ((w - W * k) / 2) * dpr, ((h - H * k) / 2) * dpr);

		// Project a ground point (east/north in screen px from the station): yaw
		// about the vertical axis, then tilt the camera down by PITCH. `depth`
		// grows away from the camera.
		const sinY = Math.sin(at);
		const cosY = Math.cos(at);
		const ground = (east: number, north: number) => {
			const depth = east * sinY + north * cosY;
			return { x: cx + east * cosY - north * sinY, y: cy - depth * sinP, depth };
		};

		const line = cssColor(ctx.canvas, 'var(--scope-line)');
		const flown = cssColor(ctx.canvas, 'var(--flown)');

		// Rotating north marker on the outer ring.
		const n = ground(0, groundPx);
		ctx.globalAlpha = 0.7;
		ctx.fillStyle = line;
		ctx.font = '14px monospace';
		ctx.textAlign = 'center';
		ctx.fillText('N', n.x, n.y + 4);
		ctx.textAlign = 'start';
		ctx.font = '12px monospace';
		ctx.lineWidth = 1.5;

		// Contacts, painter-sorted far to near so nearer blips sit on top: ground
		// shadow, drop stem, flown ring, blip and label.
		const plotted = items
			.map((p) => ({ p, g: ground(p.east, p.north) }))
			.sort((m, q) => q.g.depth - m.g.depth);
		for (const { p, g } of plotted) {
			// 0 (far) .. 1 (near camera): a subtle size/opacity falloff that reads as depth.
			const near = 1 - Math.min(1, Math.max(0, (g.depth + groundPx) / (groundPx * 2)));
			const size = 3.5 + near * 2.5;
			const color = cssColor(ctx.canvas, p.color);
			const ay = g.y - p.rise;

			ctx.globalAlpha = 0.12 + near * 0.18;
			ctx.fillStyle = line;
			ctx.beginPath();
			ctx.arc(g.x, g.y, 2, 0, Math.PI * 2);
			ctx.fill();

			ctx.globalAlpha = 0.18 + near * 0.32;
			ctx.strokeStyle = color;
			ctx.beginPath();
			ctx.moveTo(g.x, g.y);
			ctx.lineTo(g.x, ay);
			ctx.stroke();

			if (p.a.flown) {
				ctx.globalAlpha = 1;
				ctx.strokeStyle = flown;
				ctx.beginPath();
				ctx.arc(g.x, ay, size + 3.5, 0, Math.PI * 2);
				ctx.stroke();
			}

			ctx.globalAlpha = 0.55 + near * 0.45;
			ctx.fillStyle = color;
			ctx.beginPath();
			ctx.arc(g.x, ay, size, 0, Math.PI * 2);
			ctx.fill();

			if (p.label) {
				ctx.globalAlpha = 0.5 + near * 0.45;
				ctx.fillText(p.label, g.x + size + 3, ay + 4);
			}
		}
	}
</script>

<div class="flex h-full flex-col px-6 py-4 max-lg:h-auto max-lg:min-h-full max-lg:px-3">
	<div class="mb-1 flex items-baseline justify-between">
		<div>
			<span class="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">3D airspace</span>
			<span class="ml-3 text-xs text-muted-foreground">the live traffic volume · orbiting the station</span>
		</div>
		<div class="text-xs text-muted-foreground">{contacts.length} airborne</div>
	</div>

	<div class="relative min-h-0 flex-1 max-lg:h-[70vh] max-lg:flex-none">
		<svg viewBox="0 0 {W} {H}" class="h-full w-full" preserveAspectRatio="xMidYMid meet">
			<!-- ground-plane range rings (the same ellipse at every yaw) -->
			{#each rings as r (r)}
				<ellipse {cx} {cy} rx={r * pxPerNm} ry={r * pxPerNm * sinP} fill="none" stroke="var(--scope-line)" stroke-opacity="0.12" stroke-width="1" />
			{/each}

			<!-- centre altitude pole + FL ticks (fixed; the scene orbits around it) -->
			<line x1={cx} y1={cy} x2={cx} y2={cy - rise(maxAlt)} stroke="var(--scope-line)" stroke-opacity="0.18" stroke-width="1" />
			<circle {cx} {cy} r="4" fill="var(--scope-sweep)" />
			{#each altTicks as alt (alt)}
				{@const y = cy - rise(alt)}
				<line x1={cx - 5} y1={y} x2={cx + 5} y2={y} stroke="var(--scope-line)" stroke-opacity="0.35" stroke-width="1" />
				<text x={cx - 9} y={y + 4} fill="var(--scope-line)" fill-opacity="0.6" font-size="12" font-family="monospace" text-anchor="end">FL{alt / 100}</text>
			{/each}
		</svg>
		<!-- what orbits: the north marker and the contacts -->
		<canvas bind:this={canvas} class="pointer-events-none absolute inset-0 h-full w-full"></canvas>
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
