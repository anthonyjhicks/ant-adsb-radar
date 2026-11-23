import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECK_EVERY_MS, DEFAULT_RELOAD_HOURS, reloadIntervalMs, startAutoReload } from './autoReload';

const HOUR = 3_600_000;

describe('reloadIntervalMs', () => {
	it('defaults to four hours', () => {
		expect(DEFAULT_RELOAD_HOURS).toBe(4);
		expect(reloadIntervalMs('')).toBe(4 * HOUR);
		expect(reloadIntervalMs('?view=local&paused=1')).toBe(4 * HOUR);
	});

	it('takes ?reload=<hours>, fractions included', () => {
		expect(reloadIntervalMs('?reload=2')).toBe(2 * HOUR);
		expect(reloadIntervalMs('?view=scope&reload=0.5')).toBe(HOUR / 2);
	});

	it('switches off at zero or below', () => {
		expect(reloadIntervalMs('?reload=0')).toBe(0);
		expect(reloadIntervalMs('?reload=-3')).toBe(0);
	});

	it('ignores an empty or unreadable value', () => {
		expect(reloadIntervalMs('?reload=')).toBe(4 * HOUR);
		expect(reloadIntervalMs('?reload=soon')).toBe(4 * HOUR);
	});
});

describe('startAutoReload', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	const setup = (over: Partial<Parameters<typeof startAutoReload>[0]> = {}) => {
		const reload = vi.fn();
		const probe = vi.fn(async () => true);
		const stop = startAutoReload({ intervalMs: HOUR, canReload: () => true, probe, reload, ...over });
		return { reload, probe, stop };
	};

	it('reloads at the first check after the interval, once', async () => {
		const { reload, probe } = setup();
		await vi.advanceTimersByTimeAsync(HOUR - CHECK_EVERY_MS);
		expect(probe).not.toHaveBeenCalled();
		expect(reload).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
		expect(reload).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(10 * CHECK_EVERY_MS);
		expect(reload).toHaveBeenCalledTimes(1);
	});

	it('holds the reload while canReload() says no', async () => {
		let ok = false;
		const { reload, probe } = setup({ canReload: () => ok });
		await vi.advanceTimersByTimeAsync(2 * HOUR);
		expect(probe).not.toHaveBeenCalled();
		expect(reload).not.toHaveBeenCalled();
		ok = true;
		await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
		expect(reload).toHaveBeenCalledTimes(1);
	});

	it('waits for the server to answer before reloading', async () => {
		const answers = [false, false, true];
		const probe = vi.fn(async () => answers.shift() ?? true);
		const { reload } = setup({ probe });
		await vi.advanceTimersByTimeAsync(HOUR);
		expect(probe).toHaveBeenCalledTimes(1);
		expect(reload).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
		expect(reload).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
		expect(probe).toHaveBeenCalledTimes(3);
		expect(reload).toHaveBeenCalledTimes(1);
	});

	it('treats a probe that throws as down and keeps trying', async () => {
		const probe = vi.fn().mockRejectedValueOnce(new Error('net')).mockResolvedValue(true);
		const { reload } = setup({ probe });
		await vi.advanceTimersByTimeAsync(HOUR);
		expect(reload).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
		expect(reload).toHaveBeenCalledTimes(1);
	});

	it('runs one probe at a time', async () => {
		let answer: (up: boolean) => void = () => {};
		const probe = vi.fn(() => new Promise<boolean>((r) => (answer = r)));
		const { reload } = setup({ probe });
		await vi.advanceTimersByTimeAsync(HOUR + 5 * CHECK_EVERY_MS);
		expect(probe).toHaveBeenCalledTimes(1);
		answer(true);
		await vi.advanceTimersByTimeAsync(0);
		expect(reload).toHaveBeenCalledTimes(1);
	});

	it('catches up from the wall clock after the timers were held back', async () => {
		const { reload } = setup();
		// A sleeping display: no checks run, but the clock moves on.
		vi.setSystemTime(Date.now() + 2 * HOUR);
		await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
		expect(reload).toHaveBeenCalledTimes(1);
	});

	it('never reloads when switched off', async () => {
		const { reload, probe } = setup({ intervalMs: 0 });
		await vi.advanceTimersByTimeAsync(48 * HOUR);
		expect(probe).not.toHaveBeenCalled();
		expect(reload).not.toHaveBeenCalled();
	});

	it('stops when told to', async () => {
		const { reload, stop } = setup();
		stop();
		await vi.advanceTimersByTimeAsync(2 * HOUR);
		expect(reload).not.toHaveBeenCalled();
	});
});
