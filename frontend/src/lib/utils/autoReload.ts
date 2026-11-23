// Periodic full-page reload for unattended displays.
//
// A kiosk tab left running for days slowly gets sluggish (seen in Chromium on a
// Raspberry Pi 5). Reloading every few hours hands the display a fresh tab, and
// picks up a redeploy as a side effect.

export const DEFAULT_RELOAD_HOURS = 4;
export const CHECK_EVERY_MS = 60_000;
const HOUR_MS = 3_600_000;
const PROBE_TIMEOUT_MS = 10_000;

/**
 * The reload interval from a query string: `?reload=<hours>` (fractions
 * allowed), `?reload=0` to switch it off, missing or unreadable → the default.
 */
export function reloadIntervalMs(search: string): number {
	const raw = new URLSearchParams(search).get('reload');
	const hours = raw === null || raw.trim() === '' ? NaN : Number(raw);
	if (!Number.isFinite(hours)) return DEFAULT_RELOAD_HOURS * HOUR_MS;
	return hours > 0 ? hours * HOUR_MS : 0;
}

export interface AutoReloadOptions {
	/** How long after page load to reload; 0 or less never reloads. */
	intervalMs: number;
	/** False holds the reload over to the next check (mid-edit, mid-emergency…). */
	canReload: () => boolean;
	/** Resolves true when the server would serve the page right now. */
	probe?: () => Promise<boolean>;
	reload?: () => void;
}

/**
 * Reload the page once `intervalMs` has passed, at the first check where
 * `canReload()` agrees and the server answers. Returns a stop function.
 *
 * Checks the wall clock once a minute rather than arming one long timeout, so
 * a throttled background tab or a display that slept still reloads on waking.
 * The probe keeps a server that's down from leaving the screen on the
 * browser's "can't reach this page", which never retries by itself.
 */
export function startAutoReload(opts: AutoReloadOptions): () => void {
	if (!(opts.intervalMs > 0)) return () => {};
	const probe = opts.probe ?? serverUp;
	const reload = opts.reload ?? (() => window.location.reload());
	const due = Date.now() + opts.intervalMs;
	let busy = false;

	const timer = setInterval(async () => {
		if (busy || Date.now() < due || !opts.canReload()) return;
		busy = true;
		try {
			if (await probe()) {
				clearInterval(timer);
				reload();
				return;
			}
		} catch {
			// treat as down; try again next check
		}
		busy = false;
	}, CHECK_EVERY_MS);

	return () => clearInterval(timer);
}

async function serverUp(): Promise<boolean> {
	try {
		const res = await fetch(window.location.href, {
			method: 'HEAD',
			cache: 'no-store',
			signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
		});
		return res.ok;
	} catch {
		return false;
	}
}
