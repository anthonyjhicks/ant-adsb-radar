// The animated sky over the receiver, on a 2D canvas: procedural cloud decks at
// their reported bases, precipitation (rain / drizzle / snow / sleet / hail,
// steady or in passing shower cells), fog, wind streaks and lightning — all
// driven by the nearest METAR (utils/weather.ts), tinted by the real sun
// position (utils/solar.ts).
//
// The view looks SOUTH from the station — east on the left, west on the right,
// like the Daylight dome — so the sun sits where it really is, and a westerly
// drifts everything leftwards (eastward). Drift speed follows the wind speed,
// gusts arrive as periodic surges, and higher cloud decks move a little faster.

import { CALM_CONDITIONS, driftDirection, type SceneConditions } from '$lib/utils/weather';

export interface SceneSun {
	/** Degrees above the horizon (negative = below). */
	elevation: number;
	/** Degrees true; null = unknown (no sun glow drawn). */
	azimuth: number | null;
}

type RGB = [number, number, number];

const NIGHT_TOP: RGB = [10, 14, 28];
const NIGHT_HOR: RGB = [24, 32, 54];
const DAY_TOP: RGB = [38, 66, 110];
const DAY_HOR: RGB = [88, 124, 158];
const GREY_TOP: RGB = [34, 40, 52];
const GREY_HOR: RGB = [66, 74, 88];
const TWILIGHT: RGB = [176, 112, 72];
const PHOSPHOR = '120,200,160';

const TAU = Math.PI * 2;

function mix(a: RGB, b: RGB, t: number): RGB {
	return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function css(c: RGB, a = 1): string {
	return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
}
function clamp(v: number, lo: number, hi: number): number {
	return v < lo ? lo : v > hi ? hi : v;
}
/** Small seeded PRNG so a rebuild with the same report looks the same. */
function mulberry32(seed: number): () => number {
	return () => {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

interface Cloud {
	x: number;
	sprite: HTMLCanvasElement;
	alpha: number;
	speed: number;
	phase: number;
}
interface Deck {
	y: number;
	code: string;
	baseFt: number;
	cover: number;
	cb: boolean;
	clouds: Cloud[];
	/** Darker patches drifting through an overcast fill, so it isn't a flat slab. */
	mottle: Blob[];
}
interface Drop {
	x: number;
	y: number;
	vy: number;
	len: number;
	r: number;
	phase: number;
	snow: boolean;
}
interface Blob {
	x: number;
	y: number;
	rx: number;
	ry: number;
	alpha: number;
	speed: number;
}
interface Streak {
	x: number;
	y: number;
	len: number;
	speed: number;
	alpha: number;
}
interface Star {
	x: number;
	y: number;
	r: number;
	phase: number;
	speed: number;
}
type Tone = 'light' | 'dark';

const DROP_COUNTS: Record<SceneConditions['precip'], [number, number, number, number]> = {
	none: [0, 0, 0, 0],
	rain: [0, 180, 420, 900],
	drizzle: [0, 260, 500, 800],
	snow: [0, 150, 320, 600],
	sleet: [0, 180, 380, 700],
	hail: [0, 100, 220, 420]
};

export class WeatherSceneRenderer {
	private ctx: CanvasRenderingContext2D;
	private w = 1;
	private h = 1;
	private groundY = 1;
	/** Everything is sized for a ~850px-tall scene; this rescales it. */
	private s = 1;
	private raf = 0;
	private last = 0;
	private t = 0;
	private motion = 1;

	private cond: SceneConditions = CALM_CONDITIONS;
	private key = '';
	private sun: SceneSun = { elevation: 30, azimuth: null };
	private topFt = 5000;

	private decks: Deck[] = [];
	private drops: Drop[] = [];
	private fogBlobs: Blob[] = [];
	private streaks: Streak[] = [];
	private stars: Star[] = [];
	private cell = { x: 0, width: 0 };
	private bolt = { pts: [] as { x: number; y: number }[], until: 0, next: 3 };
	private sprites = new Map<string, HTMLCanvasElement>();
	private rnd = mulberry32(7);

	constructor(private canvas: HTMLCanvasElement) {
		const ctx = canvas.getContext('2d', { alpha: false });
		if (!ctx) throw new Error('2D canvas unavailable');
		this.ctx = ctx;
		this.motion =
			typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
				? 0
				: 1;
	}

	setConditions(c: SceneConditions): void {
		// The report refreshes every few minutes; only rebuild when it changed,
		// so an unchanged sky doesn't visibly reshuffle.
		const key = JSON.stringify(c);
		if (key === this.key) return;
		this.key = key;
		this.cond = c;
		this.rebuild();
	}

	setSun(sun: SceneSun): void {
		this.sun = sun;
	}

	resize(): void {
		const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
		const w = Math.max(1, this.canvas.clientWidth);
		const h = Math.max(1, this.canvas.clientHeight);
		this.canvas.width = Math.round(w * dpr);
		this.canvas.height = Math.round(h * dpr);
		this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		this.w = w;
		this.h = h;
		this.groundY = h * 0.86;
		this.s = h / 850;
		this.sprites.clear();
		this.rebuild(true);
	}

	start(): void {
		if (this.raf) return;
		this.last = performance.now();
		const loop = (ts: number) => {
			this.raf = requestAnimationFrame(loop);
			this.frame(ts);
		};
		this.raf = requestAnimationFrame(loop);
	}

	stop(): void {
		if (this.raf) cancelAnimationFrame(this.raf);
		this.raf = 0;
	}

	// --- geometry ---------------------------------------------------------------

	private yForFt(ft: number): number {
		const top = this.h * 0.1;
		return this.groundY - clamp(ft / this.topFt, 0, 1) * (this.groundY - top);
	}

	/** The deck precipitation falls from: a CB if there is one, else the lowest solid deck. */
	private precipTopY(): number {
		const D = this.decks;
		if (!D.length) return this.h * 0.05;
		const d =
			D.find((x) => x.cb) ??
			D.find((x) => x.cover >= 0.6) ??
			D.find((x) => x.cover >= 0.4) ??
			D[D.length - 1];
		return d.y + 6 * this.s;
	}

	/** Vicinity-only weather still gets a (light) cell to look at. */
	private effective(): { precip: SceneConditions['precip']; intensity: number } {
		const c = this.cond;
		if (c.intensity > 0) return { precip: c.precip, intensity: c.intensity };
		if (c.vicinity) return { precip: 'rain', intensity: 1 };
		return { precip: 'none', intensity: 0 };
	}

	private cellActive(): boolean {
		return this.cond.showers || (this.cond.vicinity && this.cond.intensity === 0);
	}

	private gustFactor(): number {
		const c = this.cond;
		if (!c.gustKt || !c.windKt || c.gustKt <= c.windKt) return 1;
		const period = 9;
		const dur = 2.4;
		const ph = this.t % period;
		const p = ph < dur ? Math.sin((Math.PI * ph) / dur) : 0;
		return 1 + (c.gustKt / c.windKt - 1) * p;
	}

	// --- build ------------------------------------------------------------------

	private sprite(wpx: number, tone: Tone, tower: boolean, seed: number): HTMLCanvasElement {
		const bucket = Math.max(60, Math.round(wpx / 20) * 20);
		const key = `${bucket}:${tone}:${tower ? 1 : 0}:${seed}`;
		const hit = this.sprites.get(key);
		if (hit) return hit;

		const hpx = tower ? bucket * 1.1 : bucket * 0.5;
		const cv = document.createElement('canvas');
		cv.width = Math.ceil(bucket);
		cv.height = Math.ceil(hpx);
		const g = cv.getContext('2d');
		if (!g) return cv;
		const rgb = tone === 'light' ? '214,222,236' : '98,106,120';
		const rnd = mulberry32(seed * 131 + bucket);
		const n = tower ? 11 : 7;
		for (let i = 0; i < n; i++) {
			// Every puff stays inside the sprite so nothing is clipped to a hard edge.
			const r = bucket * (0.12 + rnd() * 0.1);
			const cx = clamp(r + (bucket - 2 * r) * (0.02 + (0.96 * i) / (n - 1)) + (rnd() - 0.5) * bucket * 0.08, r, bucket - r);
			const cy = clamp(tower ? hpx * (0.2 + rnd() * 0.6) : hpx * (0.45 + rnd() * 0.35), r, hpx - r * 0.6);
			const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
			grad.addColorStop(0, `rgba(${rgb},0.9)`);
			grad.addColorStop(0.65, `rgba(${rgb},0.55)`);
			grad.addColorStop(1, `rgba(${rgb},0)`);
			g.fillStyle = grad;
			g.beginPath();
			g.arc(cx, cy, r, 0, TAU);
			g.fill();
		}
		// Volume: lit on top, shaded underneath.
		g.globalCompositeOperation = 'source-atop';
		const shade = g.createLinearGradient(0, 0, 0, hpx);
		shade.addColorStop(0, 'rgba(255,255,255,0.16)');
		shade.addColorStop(0.55, 'rgba(255,255,255,0)');
		shade.addColorStop(1, 'rgba(0,0,0,0.3)');
		g.fillStyle = shade;
		g.fillRect(0, 0, bucket, hpx);
		// Flatten the base: real decks have a level bottom at the reported height.
		g.globalCompositeOperation = 'destination-out';
		const cut = g.createLinearGradient(0, hpx * 0.82, 0, hpx);
		cut.addColorStop(0, 'rgba(0,0,0,0)');
		cut.addColorStop(1, 'rgba(0,0,0,1)');
		g.fillStyle = cut;
		g.fillRect(0, hpx * 0.82, bucket, hpx * 0.18);
		this.sprites.set(key, cv);
		return cv;
	}

	private rebuild(force = false): void {
		const c = this.cond;
		const { w, h, s } = this;
		const rnd = this.rnd;
		const dir = driftDirection(c.windFromDeg);

		const maxBase = c.layers.reduce((m, l) => Math.max(m, l.baseFt), 0);
		this.topFt = clamp(Math.ceil((maxBase + 1500) / 1000) * 1000, 5000, 12000);

		this.decks = c.layers.map((l, i) => {
			const dark = l.cover >= 0.7 || l.cb;
			const n = l.cover > 0 ? Math.max(1, Math.ceil((l.cover * w) / (85 * s))) : 0;
			const clouds: Cloud[] = [];
			for (let k = 0; k < n; k++) {
				const wpx = (dark ? 190 : 150) * s * (0.75 + 0.6 * rnd());
				const sprite = this.sprite(wpx, dark ? 'dark' : 'light', l.cb && k % 3 === 0, 1 + ((k * 7 + i * 3) % 5));
				clouds.push({
					x: ((k + rnd() * 0.6) * (w + wpx)) / n - wpx / 2,
					sprite,
					alpha: dark ? 0.95 : 0.85,
					speed: (6 + c.windKt * 1.1) * (1 + 0.25 * i) * s * dir,
					phase: rnd() * TAU
				});
			}
			const y = this.yForFt(l.baseFt);
			const mottle: Blob[] =
				l.cover >= 0.99
					? Array.from({ length: 6 }, () => ({
							x: rnd() * w,
							y: rnd() * y,
							rx: (220 + rnd() * 240) * s,
							ry: (50 + rnd() * 60) * s,
							alpha: 0.12 + rnd() * 0.12,
							speed: (5 + c.windKt * 0.9) * (1 + 0.25 * i) * s * dir * (0.7 + rnd() * 0.6)
						}))
					: [];
			return { y, code: l.code, baseFt: l.baseFt, cover: l.cover, cb: l.cb, clouds, mottle };
		});

		this.cell = {
			x: dir < 0 ? w * 0.7 : w * 0.3,
			width: w * (0.28 + 0.1 * (c.intensity || 1))
		};

		const eff = this.effective();
		const n = Math.round((DROP_COUNTS[eff.precip][eff.intensity] * (w * h)) / (1100 * 850));
		this.drops = [];
		for (let i = 0; i < n; i++) this.drops.push(this.newDrop(true));

		this.fogBlobs =
			c.fog > 0
				? Array.from({ length: 7 }, () => ({
						x: rnd() * w,
						y: this.groundY - rnd() * this.groundY * 0.35 * (0.3 + c.fog),
						rx: (160 + rnd() * 260) * s,
						ry: (30 + rnd() * 50) * s,
						alpha: 0.1 + rnd() * 0.12,
						speed: (4 + c.windKt * 0.35) * s * dir * (0.6 + rnd() * 0.8)
					}))
				: [];

		const ns = Math.min(14, Math.round(c.windKt / 3));
		this.streaks = Array.from({ length: ns }, () => ({
			x: rnd() * w,
			y: h * 0.2 + rnd() * (this.groundY - h * 0.2),
			len: (30 + rnd() * 90) * s,
			speed: (50 + c.windKt * 7) * s * dir * (0.7 + rnd() * 0.6),
			alpha: 0.05 + rnd() * 0.1
		}));

		if (force || !this.stars.length) {
			this.stars = Array.from({ length: 80 }, () => ({
				x: rnd() * w,
				y: rnd() * this.groundY * 0.75,
				r: 0.5 + rnd() * 1.1,
				phase: rnd() * TAU,
				speed: 0.5 + rnd() * 1.5
			}));
		}
	}

	private newDrop(initial: boolean): Drop {
		const { s, w } = this;
		const rnd = this.rnd;
		const eff = this.effective();
		const snow = eff.precip === 'snow' || (eff.precip === 'sleet' && rnd() < 0.5);
		const top = this.precipTopY();
		const x = this.cellActive()
			? this.cell.x + (rnd() - 0.5) * this.cell.width * 0.95
			: rnd() * (w * 1.3) - w * 0.15;
		const y = initial ? top + rnd() * (this.groundY - top) : top - rnd() * 40 * s;
		let vy: number;
		let len: number;
		let r: number;
		if (snow) {
			vy = (45 + rnd() * 40) * s;
			len = 0;
			r = (1.4 + rnd() * 1.8) * s;
		} else if (eff.precip === 'drizzle') {
			vy = (110 + rnd() * 60) * s;
			len = 3 * s;
			r = 0.7;
		} else if (eff.precip === 'hail') {
			vy = (600 + rnd() * 200) * s;
			len = 6 * s;
			r = (1.2 + rnd()) * s;
		} else {
			vy = ([0, 460, 600, 760][eff.intensity] + rnd() * 140) * s;
			len = (12 + eff.intensity * 6 + rnd() * 10) * s;
			r = 0.8;
		}
		return { x, y, vy, len, r, phase: rnd() * TAU, snow };
	}

	private strike(): void {
		const rnd = this.rnd;
		const x0 = this.cellActive() ? this.cell.x + (rnd() - 0.5) * this.cell.width * 0.6 : rnd() * this.w;
		const pts = [{ x: x0, y: this.precipTopY() }];
		let x = x0;
		let y = pts[0].y;
		while (y < this.groundY) {
			y += (12 + rnd() * 22) * this.s;
			x += (rnd() - 0.5) * 28 * this.s;
			pts.push({ x, y });
		}
		this.bolt = { pts, until: this.t + 0.16 + rnd() * 0.12, next: this.t + 3 + rnd() * 9 };
	}

	// --- per frame --------------------------------------------------------------

	private frame(ts: number): void {
		const dt = Math.min(0.05, Math.max(0, (ts - this.last) / 1000)) * this.motion;
		this.last = ts;
		this.t += dt;
		if (this.w < 2 || this.h < 2) return;
		this.update(dt);
		this.draw();
	}

	private update(dt: number): void {
		const c = this.cond;
		const { w, s } = this;
		const g = this.gustFactor();
		const dir = driftDirection(c.windFromDeg);

		for (const d of this.decks) {
			for (const cl of d.clouds) {
				cl.x += cl.speed * (1 + 0.3 * (g - 1)) * dt;
				const span = w + cl.sprite.width;
				cl.x = ((((cl.x + cl.sprite.width / 2) % span) + span) % span) - cl.sprite.width / 2;
			}
			for (const b of d.mottle) {
				b.x += b.speed * dt;
				const span = w + b.rx * 2;
				b.x = ((((b.x + b.rx) % span) + span) % span) - b.rx;
			}
		}

		if (c.showers && c.intensity > 0) {
			// A shower cell crosses with the wind, then another follows after a gap.
			this.cell.x += (10 + c.windKt * 1.2) * s * dir * dt;
			const half = this.cell.width / 2 + 40 * s;
			if (dir < 0 && this.cell.x < -half) this.cell.x = w + half + this.rnd() * w * 0.6;
			else if (dir > 0 && this.cell.x > w + half) this.cell.x = -half - this.rnd() * w * 0.6;
		} else if (this.cellActive()) {
			// In the vicinity: parked just off the upwind edge, breathing.
			const edge = dir < 0 ? w + this.cell.width * 0.2 : -this.cell.width * 0.2;
			this.cell.x = edge + Math.sin(this.t * 0.15) * 30 * s;
		}

		const vx = c.windKt * 6 * g * dir * s;
		for (const d of this.drops) {
			d.y += d.vy * dt;
			d.x += d.snow ? (vx * 0.5 + Math.sin(this.t * 1.3 + d.phase) * 22 * s) * dt : vx * dt;
			if (d.y > this.groundY + 4 || d.x < -w * 0.25 || d.x > w * 1.25) {
				Object.assign(d, this.newDrop(false));
			}
		}

		for (const b of this.fogBlobs) {
			b.x += b.speed * dt;
			const span = w + b.rx * 2;
			b.x = ((((b.x + b.rx) % span) + span) % span) - b.rx;
		}
		for (const st of this.streaks) {
			st.x += st.speed * g * dt;
			const span = w + st.len;
			st.x = ((((st.x + st.len) % span) + span) % span) - st.len;
		}

		if (c.thunder && this.t > this.bolt.next) this.strike();
	}

	/** A soft radial-gradient ellipse (fog wisps, overcast mottling). */
	private ellipse(b: Blob, rgb: string, alpha: number): void {
		const { ctx } = this;
		const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.rx);
		g.addColorStop(0, `rgba(${rgb},${alpha})`);
		g.addColorStop(1, `rgba(${rgb},0)`);
		ctx.save();
		ctx.translate(b.x, b.y);
		ctx.scale(1, b.ry / b.rx);
		ctx.translate(-b.x, -b.y);
		ctx.fillStyle = g;
		ctx.beginPath();
		ctx.arc(b.x, b.y, b.rx, 0, TAU);
		ctx.fill();
		ctx.restore();
	}

	private mono(px: number): string {
		return `${Math.max(9, Math.round(px * this.s))}px ui-monospace, SFMono-Regular, Menlo, monospace`;
	}

	private draw(): void {
		const { ctx, w, h, groundY, s } = this;
		const c = this.cond;
		const eff = this.effective();
		const elev = this.sun.elevation;
		const dl = clamp((elev + 6) / 12, 0, 1); // daylight 0..1
		const tw = clamp(1 - Math.abs(elev) / 8, 0, 1); // twilight band strength
		const oc = c.layers.reduce((m, l) => Math.max(m, l.cover), 0);

		// Sky.
		const top = mix(mix(NIGHT_TOP, DAY_TOP, dl), GREY_TOP, oc * 0.75);
		let hor = mix(mix(NIGHT_HOR, DAY_HOR, dl), GREY_HOR, oc * 0.75);
		hor = mix(hor, TWILIGHT, tw * (1 - oc * 0.7) * 0.8);
		const sky = ctx.createLinearGradient(0, 0, 0, groundY);
		sky.addColorStop(0, css(top));
		sky.addColorStop(1, css(hor));
		ctx.fillStyle = sky;
		ctx.fillRect(0, 0, w, groundY);

		// Stars, through whatever gaps the cloud leaves.
		const night = 1 - dl;
		if (night > 0.05 && oc < 0.95) {
			ctx.fillStyle = '#e8eefc';
			for (const st of this.stars) {
				const tw2 = 0.55 + 0.45 * Math.sin(this.t * st.speed + st.phase);
				ctx.globalAlpha = night * (1 - oc * 0.9) * tw2 * 0.9;
				ctx.beginPath();
				ctx.arc(st.x, st.y, st.r * s, 0, TAU);
				ctx.fill();
			}
			ctx.globalAlpha = 1;
		}

		// The sun, where it really is (view looks south: E left, S centre, W right).
		if (this.sun.azimuth != null && elev > -8) {
			const rel = ((((this.sun.azimuth - 180) % 360) + 540) % 360) - 180;
			if (Math.abs(rel) <= 105) {
				const x = w / 2 + (rel / 105) * (w / 2) * 0.95;
				const y = groundY - clamp(elev / 65, -0.1, 1) * (groundY - h * 0.08);
				const a = 0.5 * clamp((elev + 8) / 14, 0, 1) * (1 - 0.9 * oc);
				const warm = mix([255, 225, 170], [255, 170, 110], tw);
				const glow = ctx.createRadialGradient(x, y, 0, x, y, h * 0.22);
				glow.addColorStop(0, css(warm, a));
				glow.addColorStop(1, css(warm, 0));
				ctx.fillStyle = glow;
				ctx.fillRect(x - h * 0.22, y - h * 0.22, h * 0.44, h * 0.44);
				if (elev > -0.8 && oc < 0.7) {
					ctx.fillStyle = css(warm, Math.min(1, a * 1.6));
					ctx.beginPath();
					ctx.arc(x, y, h * 0.028, 0, TAU);
					ctx.fill();
				}
			}
		}

		// Cloud decks, highest first so lower ones overlay. A broken/overcast
		// deck is a shaded band along its base with the puffs riding on top.
		for (let i = this.decks.length - 1; i >= 0; i--) {
			const d = this.decks[i];
			if (d.cover >= 0.99) {
				// Overcast: nothing of the sky shows above the base.
				const deck = ctx.createLinearGradient(0, 0, 0, d.y);
				deck.addColorStop(0, 'rgba(88,96,110,0.85)');
				deck.addColorStop(Math.max(0.01, 1 - (90 * s) / d.y), 'rgba(92,100,114,0.9)');
				deck.addColorStop(1, 'rgba(70,78,92,0.95)');
				ctx.fillStyle = deck;
				ctx.fillRect(0, 0, w, d.y);
				for (const b of d.mottle) this.ellipse(b, '58,66,80', b.alpha);
			} else if (d.cover >= 0.7) {
				const bh = (d.cb ? 120 : 80) * s;
				const band = ctx.createLinearGradient(0, d.y - bh, 0, d.y);
				band.addColorStop(0, 'rgba(98,106,120,0)');
				band.addColorStop(0.6, 'rgba(98,106,120,0.3)');
				band.addColorStop(1, 'rgba(76,84,98,0.4)');
				ctx.fillStyle = band;
				ctx.fillRect(0, d.y - bh, w, bh);
			}
			for (const cl of d.clouds) {
				const bob = Math.sin(this.t * 0.35 + cl.phase) * 3 * s;
				ctx.globalAlpha = cl.alpha;
				ctx.drawImage(cl.sprite, cl.x - cl.sprite.width / 2, d.y - cl.sprite.height + bob);
			}
		}
		ctx.globalAlpha = 1;

		// Rain curtain under the deck (a soft column for a shower cell).
		const snowOnly = eff.precip === 'snow';
		if (eff.intensity > 0 && !snowOnly) {
			const topY = this.precipTopY();
			const a = 0.05 + 0.05 * eff.intensity;
			if (this.cellActive()) {
				const x0 = this.cell.x - this.cell.width / 2;
				const g = ctx.createLinearGradient(x0, 0, x0 + this.cell.width, 0);
				g.addColorStop(0, 'rgba(140,160,190,0)');
				g.addColorStop(0.25, `rgba(140,160,190,${a})`);
				g.addColorStop(0.75, `rgba(140,160,190,${a})`);
				g.addColorStop(1, 'rgba(140,160,190,0)');
				ctx.fillStyle = g;
				ctx.fillRect(x0, topY, this.cell.width, groundY - topY);
			} else {
				const g = ctx.createLinearGradient(0, topY, 0, groundY);
				g.addColorStop(0, `rgba(140,160,190,${a * 0.8})`);
				g.addColorStop(1, `rgba(140,160,190,${a * 0.2})`);
				ctx.fillStyle = g;
				ctx.fillRect(0, topY, w, groundY - topY);
			}
		}

		// Precipitation.
		if (this.drops.length) {
			const vx = c.windKt * 6 * this.gustFactor() * driftDirection(c.windFromDeg) * s;
			ctx.lineWidth = Math.max(1, s);
			ctx.strokeStyle =
				eff.precip === 'drizzle'
					? 'rgba(190,205,225,0.4)'
					: eff.precip === 'hail'
						? 'rgba(245,248,255,0.9)'
						: `rgba(184,206,236,${0.42 + 0.08 * eff.intensity})`;
			ctx.beginPath();
			for (const d of this.drops) {
				if (d.snow || d.len === 0) continue;
				const k = d.len / d.vy;
				ctx.moveTo(d.x, d.y);
				ctx.lineTo(d.x - vx * k, d.y - d.len);
			}
			ctx.stroke();
			ctx.fillStyle = eff.precip === 'hail' ? 'rgba(250,252,255,0.9)' : 'rgba(240,244,250,0.85)';
			ctx.beginPath();
			for (const d of this.drops) {
				if (!d.snow && eff.precip !== 'hail') continue;
				ctx.moveTo(d.x + d.r, d.y);
				ctx.arc(d.x, d.y, d.r, 0, TAU);
			}
			ctx.fill();
		}

		// Ground.
		const gg = ctx.createLinearGradient(0, groundY, 0, h);
		gg.addColorStop(0, css(mix([26, 32, 40], [40, 48, 58], dl * 0.5)));
		gg.addColorStop(1, css([12, 15, 22]));
		ctx.fillStyle = gg;
		ctx.fillRect(0, groundY, w, h - groundY);
		if (eff.intensity > 0 && !snowOnly) {
			ctx.fillStyle = `rgba(150,180,220,${0.04 * eff.intensity})`;
			ctx.fillRect(0, groundY, w, (h - groundY) * 0.5);
		}
		if (snowOnly) {
			ctx.fillStyle = `rgba(230,236,246,${0.08 * eff.intensity})`;
			ctx.fillRect(0, groundY, w, h - groundY);
		}
		ctx.strokeStyle = `rgba(${PHOSPHOR},0.45)`;
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(0, groundY + 0.5);
		ctx.lineTo(w, groundY + 0.5);
		ctx.stroke();

		// Lightning: a sky flash plus the bolt, for a fraction of a second.
		if (this.t < this.bolt.until && this.bolt.pts.length > 1) {
			const fa = clamp((this.bolt.until - this.t) / 0.2, 0, 1);
			ctx.fillStyle = `rgba(210,222,255,${0.2 * fa})`;
			ctx.fillRect(0, 0, w, h);
			ctx.save();
			ctx.strokeStyle = `rgba(255,255,255,${0.95 * fa})`;
			ctx.lineWidth = 2 * s;
			ctx.lineJoin = 'round';
			ctx.shadowBlur = 16 * s;
			ctx.shadowColor = 'rgba(190,215,255,0.95)';
			ctx.beginPath();
			ctx.moveTo(this.bolt.pts[0].x, this.bolt.pts[0].y);
			for (const p of this.bolt.pts) ctx.lineTo(p.x, p.y);
			ctx.stroke();
			ctx.restore();
		}

		// Fog / mist / haze: a ground-hugging layer plus a general loss of contrast.
		if (c.fog > 0) {
			const rgb = c.fogTint === 'warm' ? '190,176,140' : '168,178,192';
			ctx.fillStyle = `rgba(${rgb},${0.22 * c.fog})`;
			ctx.fillRect(0, 0, w, h);
			const y0 = groundY - (0.12 + 0.55 * c.fog) * groundY;
			const fg = ctx.createLinearGradient(0, y0, 0, groundY);
			fg.addColorStop(0, `rgba(${rgb},0)`);
			fg.addColorStop(1, `rgba(${rgb},${0.75 * c.fog})`);
			ctx.fillStyle = fg;
			ctx.fillRect(0, y0, w, h - y0);
			for (const b of this.fogBlobs) this.ellipse(b, rgb, b.alpha * c.fog);
		}

		// Wind streaks.
		if (this.streaks.length) {
			ctx.lineWidth = 1;
			for (const st of this.streaks) {
				ctx.strokeStyle = `rgba(200,215,230,${st.alpha})`;
				ctx.beginPath();
				ctx.moveTo(st.x, st.y);
				ctx.lineTo(st.x + st.len, st.y);
				ctx.stroke();
			}
		}

		// Night: dim clouds and rain along with the sky.
		if (night > 0) {
			ctx.fillStyle = css([6, 8, 16], night * 0.35);
			ctx.fillRect(0, 0, w, h);
		}

		// The receiver mast — you are here — with its blinking obstruction light.
		const mx = w / 2;
		const mh = 34 * s;
		ctx.strokeStyle = 'rgba(200,210,225,0.85)';
		ctx.lineWidth = 2 * s;
		ctx.beginPath();
		ctx.moveTo(mx, groundY);
		ctx.lineTo(mx, groundY - mh);
		for (const f of [0.55, 0.78]) {
			ctx.moveTo(mx - 6 * s, groundY - mh * f);
			ctx.lineTo(mx + 6 * s, groundY - mh * f);
		}
		ctx.stroke();
		const on = this.t % 1.6 < 0.12;
		ctx.fillStyle = `rgba(255,70,70,${on ? 1 : 0.3})`;
		ctx.beginPath();
		ctx.arc(mx, groundY - mh - 2 * s, 2.5 * s, 0, TAU);
		ctx.fill();
		if (on) {
			const glow = ctx.createRadialGradient(mx, groundY - mh, 0, mx, groundY - mh, 14 * s);
			glow.addColorStop(0, 'rgba(255,90,90,0.5)');
			glow.addColorStop(1, 'rgba(255,90,90,0)');
			ctx.fillStyle = glow;
			ctx.fillRect(mx - 14 * s, groundY - mh - 14 * s, 28 * s, 28 * s);
		}
		ctx.font = this.mono(10);
		ctx.textBaseline = 'middle';
		ctx.textAlign = 'left';
		ctx.fillStyle = `rgba(${PHOSPHOR},0.8)`;
		ctx.fillText('RX', mx + 8 * s, groundY - 6 * s);

		// Compass along the horizon.
		ctx.font = this.mono(11);
		ctx.fillStyle = `rgba(${PHOSPHOR},0.7)`;
		ctx.textAlign = 'left';
		ctx.fillText('E', 12 * s, groundY + 13 * s);
		ctx.textAlign = 'center';
		ctx.fillText('S', mx, groundY + 13 * s);
		ctx.textAlign = 'right';
		ctx.fillText('W', w - 12 * s, groundY + 13 * s);

		// Height ladder (left) and the reported decks (right).
		ctx.font = this.mono(10);
		ctx.textAlign = 'left';
		const step = this.topFt <= 6000 ? 1000 : 2000;
		ctx.lineWidth = 1;
		for (let ft = step; ft <= this.topFt; ft += step) {
			const y = this.yForFt(ft);
			ctx.strokeStyle = `rgba(${PHOSPHOR},0.35)`;
			ctx.beginPath();
			ctx.moveTo(12 * s, y + 0.5);
			ctx.lineTo(20 * s, y + 0.5);
			ctx.stroke();
			ctx.fillStyle = `rgba(${PHOSPHOR},0.6)`;
			ctx.fillText(ft.toLocaleString('en-GB'), 24 * s, y);
		}
		ctx.fillStyle = `rgba(${PHOSPHOR},0.5)`;
		ctx.fillText('ft AGL', 12 * s, groundY - 12 * s);

		ctx.textAlign = 'right';
		ctx.setLineDash([4 * s, 8 * s]);
		for (const d of this.decks) {
			ctx.strokeStyle = 'rgba(200,215,235,0.08)';
			ctx.beginPath();
			ctx.moveTo(60 * s, d.y + 0.5);
			ctx.lineTo(w - 120 * s, d.y + 0.5);
			ctx.stroke();
			ctx.fillStyle = d.cb ? 'rgba(252,211,77,0.9)' : 'rgba(226,232,242,0.8)';
			ctx.fillText(`${d.code} ${d.baseFt.toLocaleString('en-GB')} ft${d.cb ? ' CB' : ''}`, w - 12 * s, d.y);
		}
		ctx.setLineDash([]);
	}
}
