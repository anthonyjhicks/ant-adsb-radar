<script lang="ts">
	// Ceiling flypast projector. Draws ATC scope tracks — the same symbology as the
	// radar scope (altitude-coloured velocity leader + blip + data tag) — for every
	// low, non-climbing arrival within range of the station (final approach, e.g. 27R
	// into LHR). Each track glides across the screen in its true direction of
	// flight; everything else is pure black so a projector throws only the tracks
	// onto the ceiling. Rotation is calibrated once to the projector placement so
	// the drift lines up with the real sky.
	//
	// Motion: the blip position comes from lat/lon (smooth through overhead, unlike
	// bearing/distance which are singular at the zenith), advanced by ground
	// speed/track between the ~1Hz fixes and exponentially smoothed so it glides
	// edge-to-edge instead of stepping.
	//
	// Keys (a faint HUD appears on any keypress, then auto-hides):
	//   ← / → or [ / ]   rotate (hold Shift for 5° steps)
	//   ↑ / ↓ or + / -   track size
	//   , / .            tighten / widen radius (range)
	//   c                cycle colour (altitude → white → amber → green)
	//   v                toggle velocity leader · l toggle data tag
	//   f                flip the whole view 180° (for an inverted ceiling image)
	//   x                mirror the whole view left-right (rear/mirror projection)
	//   g                toggle fill-screen (slice) vs letterbox-fit (meet)
	//   m                toggle the centre (station) marker
	//   p                toggle the closest-aircraft photo card
	//   r                reset · h toggle HUD
	// URL overrides: ?rot=deg ?size=mul ?range=nm ?alt=ft ?debug=1

	import { onMount } from 'svelte';
	import { radarStore } from '$lib/stores/radar.svelte';
	import { altColor } from '$lib/utils/geo';
	import { ensureRoute, routeCache, airportCode } from '$lib/api/route';
	import { getPhoto, photoCache, type AircraftPhoto } from '$lib/api/photo';
	import PhotoFrame from '$lib/components/PhotoFrame.svelte';

	const SIZE = 1000;
	const C = SIZE / 2;
	const LEADER_SECS = 45; // velocity-leader reach, capped so it never spans the screen
	// Constant-velocity (alpha-beta-ish) filter. Position is integrated forward
	// from the reported ground speed/track every frame; an incoming fix only nudges
	// it. This keeps motion monotonic — it never jumps backward when readsb repeats
	// a stale position for a few polls.
	const VEL_TAU = 0.6; // velocity low-pass time-constant (s)
	const POS_ALPHA = 0.12; // position correction per new fix (0 = ignore fixes, 1 = snap)
	const SNAP_NM = 0.8; // residual beyond this snaps (new track / big jump)

	const FLAT = ['#ffffff', '#ffb020', '#39ff7a']; // colour-cycle past the altitude colour

	// --- Calibration (persisted) + tuning ---
	let rotation = $state(0); // deg, aligns the track to the projector placement
	let sizeMul = $state(1); // 1 = exact scope scale
	let colorIdx = $state(0); // 0 = altitude colour, then FLAT[]
	let showVectors = $state(true);
	let showLabels = $state(true);
	let flipView = $state(true); // 180° flip of the whole view for an inverted ceiling image
	let mirror = $state(false); // horizontal mirror (left-right) for rear/mirror projection
	let showMarker = $state(true); // centre marker for the receiver location
	let showPhoto = $state(true); // photo card of the closest aircraft, in the (projected) top-right
	let fillScreen = $state(true); // fill the projector frame (slice) vs letterbox-fit (meet)
	let rangeNm = $state(5); // gate radius + drift scale (edge of screen) — overhead pass
	let altMax = $state(7000); // ft, approach ceiling — ignore high overflights
	let debug = $state(false);

	let pxPerNm = $derived(C / rangeNm);

	// The scope is a square; a projector is 16:9. `slice` scales the square to
	// cover the whole frame (no letterbox bars, so a track uses the full long
	// axis and enters at the very edge); `meet` fits it with bars. Fill by default
	// for projection — orient the flight path along the projector's long axis.
	let aspect = $derived(fillScreen ? 'xMidYMid slice' : 'xMidYMid meet');

	// Whole-scene orientation: optional horizontal mirror then optional 180° flip
	// (both about the centre, so they commute). Together they cover every
	// projector orientation: normal, ceiling (180°), rear (mirror), rear+ceiling.
	let sceneTransform = $derived(
		`${mirror ? `translate(${SIZE} 0) scale(-1 1) ` : ''}${flipView ? `rotate(180 ${C} ${C})` : ''}`.trim() ||
			undefined
	);

	// The same orientation as a CSS transform, for the HTML photo-card overlay so
	// it lands the right way up (and in the projected "top-right") on the ceiling.
	let overlayTransform = $derived(
		`${mirror ? 'scaleX(-1) ' : ''}${flipView ? 'rotate(180deg)' : ''}`.trim() || 'none'
	);

	const KEY = 'ant-adsb-radar.above';

	function save() {
		try {
			localStorage.setItem(
				KEY,
				JSON.stringify({
					rotation,
					sizeMul,
					colorIdx,
					showVectors,
					showLabels,
					flipView,
					mirror,
					showMarker,
					showPhoto,
					fillScreen,
					rangeNm
				})
			);
		} catch {
			/* ignore */
		}
	}

	// Per-aircraft metadata used to render the tag/colour.
	type Meta = {
		fl: number | null;
		altBaro: number | null;
		vertTrend: number;
		onGround: boolean;
		emergency: boolean;
		flight: string; // raw callsign for route lookup (or hex fallback)
		type: string | null;
		registration: string | null;
		operator: string | null;
		gs: number | null;
	};
	// Latest fix per aircraft: local east/north nm relative to the receiver, with
	// the reported velocity as east/north components (nm/s). `seq` bumps only when
	// the position actually changes, so the motion loop can tell a fresh fix from a
	// repeated stale one. Plain map (not reactive), written by the $effect below and
	// read by the rAF loop.
	type Fix = {
		east: number;
		north: number;
		vEast: number;
		vNorth: number;
		seq: number;
		meta: Meta;
	};
	let fixes = new Map<string, Fix>();

	// A rendered track (reactive). `present` flips false while it fades out after
	// the aircraft leaves range.
	type Track = { hex: string; x: number; y: number; track: number; present: boolean; meta: Meta };
	let tracks = $state<Track[]>([]);

	// Rebuild the per-aircraft fixes from each snapshot: every airborne, low,
	// non-climbing contact within range (an arrival passing overhead, either config).
	$effect(() => {
		const snap = radarStore.snapshot;
		const next = new Map<string, Fix>();
		const rxLat = snap?.receiver?.lat ?? null;
		const rxLon = snap?.receiver?.lon ?? null;
		if (snap && rxLat != null && rxLon != null) {
			for (const a of snap.aircraft) {
				if (a.on_ground) continue;
				if (a.distance_nm == null || a.distance_nm > rangeNm) continue;
				if (a.track == null) continue;
				if (a.alt_baro == null || a.alt_baro > altMax) continue;
				if (a.vert_trend > 0) continue;
				let east: number, north: number;
				if (a.lat != null && a.lon != null) {
					north = (a.lat - rxLat) * 60; // equirectangular, smooth through the zenith
					east = (a.lon - rxLon) * 60 * Math.cos((rxLat * Math.PI) / 180);
				} else if (a.bearing != null) {
					const br = (a.bearing * Math.PI) / 180;
					east = a.distance_nm * Math.sin(br);
					north = a.distance_nm * Math.cos(br);
				} else {
					continue;
				}
				const vgs = (a.gs ?? 0) / 3600; // nm/s
				const tr = (a.track * Math.PI) / 180;
				const prev = fixes.get(a.hex);
				const moved = !prev || east !== prev.east || north !== prev.north;
				next.set(a.hex, {
					east,
					north,
					vEast: vgs * Math.sin(tr),
					vNorth: vgs * Math.cos(tr),
					seq: prev ? (moved ? prev.seq + 1 : prev.seq) : 0,
					meta: {
						fl: a.flight_level,
						altBaro: a.alt_baro,
						vertTrend: a.vert_trend,
						onGround: a.on_ground,
						emergency: !!a.emergency,
						flight: a.flight?.trim() || a.hex,
						type: a.type,
						registration: a.registration,
						operator: a.operator,
						gs: a.gs
					}
				});
				ensureRoute(a.flight);
			}
		}
		fixes = next;
	});

	// Altitude colour (exact scope palette) unless the colour cycle is engaged.
	function colorFor(m: Meta): string {
		if (colorIdx > 0) return FLAT[(colorIdx - 1) % FLAT.length];
		return altColor(m.fl, m.onGround, m.emergency);
	}

	// Velocity leader endpoint in the track's local frame (blip at origin), capped.
	function leaderFor(t: Track): { x: number; y: number } | null {
		if (!t.meta.gs) return null;
		const nm = (t.meta.gs / 3600) * LEADER_SECS;
		const px = Math.min(nm * pxPerNm, 0.3 * C);
		const r = (t.track * Math.PI) / 180;
		return { x: px * Math.sin(r), y: -px * Math.cos(r) };
	}

	// ATC-style multi-line data block. Drops empty lines so there are no gaps.
	function tagLinesFor(m: Meta): { t: string; s: number; o: number; bold?: boolean }[] {
		const lines: { t: string; s: number; o: number; bold?: boolean }[] = [];
		lines.push({ t: m.flight, s: 14, o: 1, bold: true });
		if (m.operator) lines.push({ t: m.operator, s: 10, o: 0.7 });
		const typeReg = [m.type, m.registration].filter(Boolean).join('  ');
		if (typeReg) lines.push({ t: typeReg, s: 11, o: 0.85 });
		const rt = routeCache.get(m.flight);
		if (rt?.origin || rt?.destination)
			lines.push({ t: `${airportCode(rt.origin)} → ${airportCode(rt.destination)}`, s: 11, o: 0.85 });
		const arrow = m.vertTrend < 0 ? '↓' : m.vertTrend > 0 ? '↑' : '·';
		const alt = m.altBaro != null ? `${m.altBaro.toLocaleString()}ft` : m.fl ? `FL${m.fl}` : '';
		const spd = m.gs ? `${m.gs}kt` : '';
		const last = [alt, arrow, spd].filter(Boolean).join(' ');
		if (last) lines.push({ t: last, s: 11, o: 0.85 });
		return lines;
	}

	// --- HUD (calibration feedback only; hidden during normal projection) ---
	let frame = $state(0);
	let hudUntil = $state(0);
	let hudPinned = $state(false);
	let showHud = $derived(debug || hudPinned || frame < hudUntil);
	let liveTracks = $derived(tracks.filter((t) => t.present));

	// Closest in-range aircraft (nearest the centre/station), for the photo card.
	let closest = $derived.by(() => {
		let best: Track | null = null;
		let bd = Infinity;
		for (const t of tracks) {
			if (!t.present) continue;
			const d = Math.hypot(t.x - C, t.y - C);
			if (d < bd) {
				bd = d;
				best = t;
			}
		}
		return best;
	});

	// Photo for the closest aircraft, keyed by hex, via the shared cache.
	let photo = $state<AircraftPhoto | null>(null);
	$effect(() => {
		const hex = closest?.hex;
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
				if (!cancelled && closest?.hex === hex) photo = p;
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	});

	function flashHud() {
		hudUntil = (typeof performance !== 'undefined' ? performance.now() : 0) + 3500;
	}

	function onKey(e: KeyboardEvent) {
		const step = e.shiftKey ? 5 : 1;
		let handled = true;
		switch (e.key) {
			case 'ArrowLeft':
			case '[':
				rotation -= step;
				break;
			case 'ArrowRight':
			case ']':
				rotation += step;
				break;
			case 'ArrowUp':
			case '+':
			case '=':
				sizeMul = Math.min(6, +(sizeMul + 0.1).toFixed(2));
				break;
			case 'ArrowDown':
			case '-':
				sizeMul = Math.max(0.3, +(sizeMul - 0.1).toFixed(2));
				break;
			case ',':
				rangeNm = Math.max(0.5, +(rangeNm - 0.25).toFixed(2));
				break;
			case '.':
				rangeNm = Math.min(10, +(rangeNm + 0.25).toFixed(2));
				break;
			case 'c':
				colorIdx = (colorIdx + 1) % (FLAT.length + 1);
				break;
			case 'v':
				showVectors = !showVectors;
				break;
			case 'l':
				showLabels = !showLabels;
				break;
			case 'f':
				flipView = !flipView;
				break;
			case 'x':
				mirror = !mirror;
				break;
			case 'm':
				showMarker = !showMarker;
				break;
			case 'p':
				showPhoto = !showPhoto;
				break;
			case 'g':
				fillScreen = !fillScreen;
				break;
			case 'r':
				rotation = 0;
				sizeMul = 1;
				colorIdx = 0;
				rangeNm = 5;
				showVectors = true;
				showLabels = true;
				flipView = true;
				mirror = false;
				showMarker = true;
				showPhoto = true;
				fillScreen = true;
				break;
			case 'h':
				hudPinned = !hudPinned;
				break;
			default:
				handled = false;
		}
		if (handled) {
			e.preventDefault();
			rotation = ((rotation % 360) + 360) % 360;
			save();
			flashHud();
		}
	}

	onMount(() => {
		// Persisted calibration, then URL overrides.
		try {
			const raw = localStorage.getItem(KEY);
			if (raw) {
				const v = JSON.parse(raw);
				if (typeof v.rotation === 'number') rotation = v.rotation;
				if (typeof v.sizeMul === 'number') sizeMul = v.sizeMul;
				if (typeof v.colorIdx === 'number') colorIdx = v.colorIdx;
				if (typeof v.showVectors === 'boolean') showVectors = v.showVectors;
				if (typeof v.showLabels === 'boolean') showLabels = v.showLabels;
				if (typeof v.flipView === 'boolean') flipView = v.flipView;
				if (typeof v.mirror === 'boolean') mirror = v.mirror;
				if (typeof v.showMarker === 'boolean') showMarker = v.showMarker;
				if (typeof v.showPhoto === 'boolean') showPhoto = v.showPhoto;
				if (typeof v.fillScreen === 'boolean') fillScreen = v.fillScreen;
				if (typeof v.rangeNm === 'number') rangeNm = v.rangeNm;
			}
		} catch {
			/* ignore */
		}
		const q = new URLSearchParams(window.location.search);
		if (q.has('rot')) rotation = Number(q.get('rot')) || 0;
		if (q.has('size')) sizeMul = Number(q.get('size')) || sizeMul;
		if (q.has('range')) rangeNm = Number(q.get('range')) || rangeNm;
		if (q.has('alt')) altMax = Number(q.get('alt')) || altMax;
		if (q.get('debug') === '1') debug = true;

		window.addEventListener('keydown', onKey);

		// Motion loop: a constant-velocity dead-reckoning filter per aircraft. Every
		// frame we ease each estimated velocity toward the reported one and integrate
		// position forward — so a track always advances. A genuinely new fix nudges
		// the position (POS_ALPHA); a stale repeat is ignored; a big jump / new
		// aircraft snaps. Tracks whose aircraft has left range keep gliding and fade
		// out for FADE_MS, then are dropped.
		type Est = { e: number; n: number; ve: number; vn: number; seq: number; meta: Meta; gone: number };
		const ests = new Map<string, Est>();
		const FADE_MS = 900;
		let lastT = 0;
		let raf = 0;
		const loop = () => {
			const now = performance.now();
			const dt = lastT ? Math.min((now - lastT) / 1000, 0.1) : 0;
			lastT = now;
			frame = now;

			// Update / create an estimate for every aircraft currently in range.
			for (const [hex, fix] of fixes) {
				let e = ests.get(hex);
				if (!e) {
					e = { e: fix.east, n: fix.north, ve: fix.vEast, vn: fix.vNorth, seq: fix.seq, meta: fix.meta, gone: 0 };
					ests.set(hex, e);
					continue;
				}
				e.meta = fix.meta;
				e.gone = 0;
				const kv = 1 - Math.exp(-dt / VEL_TAU);
				e.ve += (fix.vEast - e.ve) * kv;
				e.vn += (fix.vNorth - e.vn) * kv;
				e.e += e.ve * dt;
				e.n += e.vn * dt;
				if (fix.seq !== e.seq) {
					const re = fix.east - e.e;
					const rn = fix.north - e.n;
					if (Math.hypot(re, rn) > SNAP_NM) {
						e.e = fix.east;
						e.n = fix.north;
						e.ve = fix.vEast;
						e.vn = fix.vNorth;
					} else {
						e.e += POS_ALPHA * re;
						e.n += POS_ALPHA * rn;
					}
					e.seq = fix.seq;
				}
			}

			const out: Track[] = [];
			for (const [hex, e] of ests) {
				const present = fixes.has(hex);
				if (!present) {
					// Aircraft left range: keep gliding, fade, then drop.
					if (!e.gone) e.gone = now;
					if (now - e.gone > FADE_MS) {
						ests.delete(hex);
						continue;
					}
					e.e += e.ve * dt;
					e.n += e.vn * dt;
				}
				// Heading from the smoothed velocity vector (stable through overhead).
				const track = (Math.atan2(e.ve, e.vn) * 180) / Math.PI;
				out.push({ hex, x: C + e.e * pxPerNm, y: C - e.n * pxPerNm, track, present, meta: e.meta });
			}
			tracks = out;
			raf = requestAnimationFrame(loop);
		};
		raf = requestAnimationFrame(loop);

		return () => {
			window.removeEventListener('keydown', onKey);
			cancelAnimationFrame(raf);
		};
	});
</script>

<svelte:head>
	<title>Above</title>
</svelte:head>

<div class="screen">
	<svg viewBox="0 0 {SIZE} {SIZE}" preserveAspectRatio={aspect}>
		<!-- Whole-scene orientation (180° flip and/or horizontal mirror) so the
		     projection lands the right way up for the projector placement. -->
		<g transform={sceneTransform}>
			{#each tracks as t (t.hex)}
				{@const color = colorFor(t.meta)}
				{@const leader = leaderFor(t)}
				<g class="craft" class:visible={t.present} transform="rotate({rotation} {C} {C})">
					<g transform="translate({t.x} {t.y}) scale({sizeMul})">
						{#if showVectors && leader}
							<line
								x1="0"
								y1="0"
								x2={leader.x}
								y2={leader.y}
								stroke={color}
								stroke-width="1.6"
								stroke-opacity="0.9"
							/>
						{/if}
						<circle cx="0" cy="0" r={t.meta.onGround ? 3 : 4.5} fill={color} />
						{#if showLabels}
							<!-- When mirrored, the whole scene flips, so the tag would land on
							     the (now mirrored) leader. Move it to the other side of the dot
							     and counter the flip so it reads normally — keeping the same
							     dot/leader/tag relationship as the un-mirrored view. -->
							<g transform={mirror ? 'scale(-1 1)' : undefined}>
								{#each tagLinesFor(t.meta) as ln, i (i)}
									<text
										x={mirror ? -8 : 8}
										y={-5 + i * 14}
										text-anchor={mirror ? 'end' : 'start'}
										fill={color}
										fill-opacity={ln.o}
										font-size={ln.s}
										font-weight={ln.bold ? 'bold' : 'normal'}
										font-family="monospace">{ln.t}</text
									>
								{/each}
							</g>
						{/if}
					</g>
				</g>
			{/each}

		<!-- Centre marker: the receiver directly overhead. Fixed reference,
		     drawn whether or not an aircraft is present. -->
			{#if showMarker}
				<circle cx={C} cy={C} r="3.5" fill="#ffffff" fill-opacity="0.55" />
				<circle cx={C} cy={C} r="9" fill="none" stroke="#ffffff" stroke-width="1.2" stroke-opacity="0.35" />
			{/if}
		</g>
	</svg>

	<!-- Closest-aircraft photo card. The overlay carries the same flip/mirror as
	     the scene, so the card sits in the projected top-right, the right way up. -->
	{#if showPhoto && closest && photo?.thumbnail}
		<div class="photo-overlay" style:transform={overlayTransform}>
			<div class="photo-card">
				<div class="photo-head">
					<span class="cs">{closest.meta.flight}</span>
					{#if closest.meta.type}<span class="ty">{closest.meta.type}</span>{/if}
				</div>
				<div class="photo-frame">
					<PhotoFrame
						src={photo.thumbnail}
						alt={closest.meta.type ?? 'aircraft'}
						credit={photo.photographer ?? 'unknown'}
						maxImgPx={640}
					/>
				</div>
			</div>
		</div>
	{/if}

	{#if showHud}
		<div class="hud">
			<div class="row">
				<b>rot</b> {rotation.toFixed(0)}° · <b>size</b> {sizeMul.toFixed(1)}× · <b>range</b> {rangeNm}nm
				· <b>alt≤</b>{altMax}ft
			</div>
			<div class="row dim">
				{#if liveTracks.length}
					{liveTracks.length} in range: {liveTracks
						.map((t) => t.meta.flight)
						.slice(0, 6)
						.join(', ')}{liveTracks.length > 6 ? '…' : ''}
				{:else}
					no arrivals in range — ceiling dark
				{/if}
			</div>
			<div class="row dim">
				←/→ rotate · ↑/↓ size · ,/. range · c colour · v leader · l tag · f flip · x mirror · g fill · m marker · p photo · r reset · h hide
			</div>
		</div>
	{/if}
</div>

<style>
	.screen {
		position: fixed;
		inset: 0;
		background: #000;
		overflow: hidden;
		cursor: none;
	}
	svg {
		width: 100%;
		height: 100%;
		display: block;
	}
	.craft {
		opacity: 0;
		transition: opacity 0.8s ease;
	}
	.craft.visible {
		opacity: 1;
	}
	.photo-overlay {
		position: fixed;
		inset: 0;
		pointer-events: none;
		transform-origin: center center;
	}
	.photo-card {
		position: absolute;
		top: 28px;
		right: 28px;
		width: 320px;
	}
	.photo-head {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin-bottom: 6px;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	}
	.photo-head .cs {
		font-size: 18px;
		font-weight: 700;
		color: #fff;
	}
	.photo-head .ty {
		font-size: 13px;
		color: #9fb0c8;
	}
	.photo-frame {
		position: relative;
		width: 100%;
		aspect-ratio: 3 / 2;
		overflow: hidden;
		border-radius: 10px;
		box-shadow: 0 6px 24px rgba(0, 0, 0, 0.6);
	}
	.hud {
		position: fixed;
		left: 16px;
		bottom: 14px;
		font:
			13px/1.5 ui-monospace,
			SFMono-Regular,
			Menlo,
			monospace;
		color: #cfd6e4;
		text-shadow: 0 1px 2px #000;
		pointer-events: none;
		user-select: none;
	}
	.hud .dim {
		opacity: 0.6;
	}
	.hud b {
		color: #8aa0c0;
		font-weight: 600;
	}
</style>
