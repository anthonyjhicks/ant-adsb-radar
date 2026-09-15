import { describe, expect, it } from 'vitest';
import {
	MAX_DWELL_MS,
	MIN_DWELL_MS,
	PANELS,
	applyDwell,
	applyOrder,
	applyStation,
	localScopeName,
	visiblePanels,
	withoutEmergency,
	EMERGENCY_PANEL_ID,
	type Panel
} from './panels';
import { DEFAULT_STATION } from './api/config';

const ids = (panels: Panel[]) => panels.map((p) => p.id);

// A stand-in registry so these tests don't churn every time a real view is
// added or removed; the PANELS cases below cover the actual registry.
const fake = (id: string) => ({ id, name: id, component: null, accent: 'cyan', ms: 10_000, group: 'Scopes', props: {} }) as unknown as Panel;
const REG = ['a', 'b', 'c', 'd'].map(fake);

describe('applyOrder', () => {
	it('falls back to the default order when nothing is saved', () => {
		expect(ids(applyOrder(null, REG))).toEqual(['a', 'b', 'c', 'd']);
		expect(ids(applyOrder(undefined, REG))).toEqual(['a', 'b', 'c', 'd']);
		expect(ids(applyOrder([], REG))).toEqual(['a', 'b', 'c', 'd']);
	});

	it('applies a full saved order', () => {
		expect(ids(applyOrder(['d', 'c', 'b', 'a'], REG))).toEqual(['d', 'c', 'b', 'a']);
	});

	it('drops ids for views that no longer exist', () => {
		expect(ids(applyOrder(['d', 'gone', 'a', 'b', 'c'], REG))).toEqual(['d', 'a', 'b', 'c']);
	});

	it('splices in views added since the config was saved, at their default spot', () => {
		// 'b' and 'c' are new to this config; they should land between the
		// pinned entries rather than being appended at the end.
		expect(ids(applyOrder(['d', 'a'], REG))).toEqual(['d', 'b', 'c', 'a']);
	});

	it('ignores duplicates in a saved order', () => {
		expect(ids(applyOrder(['b', 'b', 'a'], REG))).toEqual(['b', 'a', 'c', 'd']);
	});

	it('never loses or duplicates a panel, whatever the config holds', () => {
		for (const saved of [[], ['a'], ['x', 'y'], ['d', 'd', 'c'], ['c', 'b', 'a', 'd']]) {
			const out = ids(applyOrder(saved, REG));
			expect(out.slice().sort()).toEqual(['a', 'b', 'c', 'd']);
		}
	});

	it('does not mutate the registry it is given', () => {
		const before = ids(REG);
		applyOrder(['d', 'c', 'b', 'a'], REG);
		expect(ids(REG)).toEqual(before);
	});

	it('round-trips the real registry', () => {
		const reversed = ids(PANELS).slice().reverse();
		expect(ids(applyOrder(reversed))).toEqual(reversed);
		expect(ids(applyOrder(null))).toEqual(ids(PANELS));
	});
});

describe('visiblePanels', () => {
	it('returns everything when nothing is hidden', () => {
		expect(ids(visiblePanels(REG))).toEqual(['a', 'b', 'c', 'd']);
		expect(ids(visiblePanels(REG, null))).toEqual(['a', 'b', 'c', 'd']);
		expect(ids(visiblePanels(REG, []))).toEqual(['a', 'b', 'c', 'd']);
	});

	it('drops hidden ids, keeping the given order', () => {
		expect(ids(visiblePanels(REG, ['b']))).toEqual(['a', 'c', 'd']);
		expect(ids(visiblePanels(REG, ['d', 'a']))).toEqual(['b', 'c']);
	});

	it('ignores hidden ids that are not in the registry', () => {
		expect(ids(visiblePanels(REG, ['gone', 'c']))).toEqual(['a', 'b', 'd']);
	});

	it('falls back to everything when the config hides every view', () => {
		// Degenerate (hand-edited file, or the visible ids were deleted from the
		// registry): the kiosk must always have something to render.
		expect(ids(visiblePanels(REG, ['a', 'b', 'c', 'd']))).toEqual(['a', 'b', 'c', 'd']);
	});

	it('allows a single remaining view', () => {
		expect(ids(visiblePanels(REG, ['a', 'b', 'c']))).toEqual(['d']);
	});

	it('does not mutate the list it is given', () => {
		const before = ids(REG);
		visiblePanels(REG, ['a', 'c']);
		expect(ids(REG)).toEqual(before);
	});

	it('composes with applyOrder: reorder then hide', () => {
		expect(ids(visiblePanels(applyOrder(['d', 'c', 'b', 'a'], REG), ['c']))).toEqual([
			'd',
			'b',
			'a'
		]);
		// An empty order means "default order", and hiding still applies to it.
		expect(ids(visiblePanels(applyOrder([], REG), ['a']))).toEqual(['b', 'c', 'd']);
	});

	it('hides a real registry panel', () => {
		const out = ids(visiblePanels(applyOrder(null), ['stats']));
		expect(out).not.toContain('stats');
		expect(out).toHaveLength(PANELS.length - 1);
	});
});

describe('applyDwell', () => {
	const msOf = (panels: Panel[]) => panels.map((p) => p.ms);

	it('leaves the registry alone when nothing is overridden', () => {
		expect(msOf(applyDwell(REG))).toEqual([10_000, 10_000, 10_000, 10_000]);
		expect(msOf(applyDwell(REG, null))).toEqual([10_000, 10_000, 10_000, 10_000]);
		expect(msOf(applyDwell(REG, {}))).toEqual([10_000, 10_000, 10_000, 10_000]);
	});

	it('applies an override to just that view', () => {
		expect(msOf(applyDwell(REG, { b: 25_000 }))).toEqual([10_000, 25_000, 10_000, 10_000]);
	});

	it('ignores overrides for views that no longer exist', () => {
		expect(msOf(applyDwell(REG, { gone: 25_000 }))).toEqual([10_000, 10_000, 10_000, 10_000]);
	});

	it('ignores values outside the bounds, keeping the default', () => {
		// A zero or negative dwell would spin the rotation as fast as the tick.
		for (const bad of [0, -1, MIN_DWELL_MS - 1, MAX_DWELL_MS + 1]) {
			expect(msOf(applyDwell(REG, { a: bad }))[0]).toBe(10_000);
		}
		expect(msOf(applyDwell(REG, { a: MIN_DWELL_MS }))[0]).toBe(MIN_DWELL_MS);
		expect(msOf(applyDwell(REG, { a: MAX_DWELL_MS }))[0]).toBe(MAX_DWELL_MS);
	});

	it('ignores non-finite and non-numeric values', () => {
		const junk = { a: NaN, b: Infinity, c: '20000', d: null } as unknown as Record<string, number>;
		expect(msOf(applyDwell(REG, junk))).toEqual([10_000, 10_000, 10_000, 10_000]);
	});

	it('does not mutate the registry it is given', () => {
		const before = msOf(REG);
		applyDwell(REG, { a: 30_000, b: 40_000 });
		expect(msOf(REG)).toEqual(before);
		expect(ids(REG)).toEqual(['a', 'b', 'c', 'd']);
	});

	it('composes with applyOrder and visiblePanels', () => {
		const out = applyDwell(visiblePanels(applyOrder(['d', 'a'], REG), ['c']), { d: 5_000 });
		expect(ids(out)).toEqual(['d', 'b', 'a']);
		expect(out[0].ms).toBe(5_000);
	});

	it('overrides a real registry panel without disturbing the others', () => {
		const out = applyDwell(applyOrder(null), { stats: 45_000 });
		expect(out.find((p) => p.id === 'stats')?.ms).toBe(45_000);
		const scope = PANELS.find((p) => p.id === 'scope')!;
		expect(out.find((p) => p.id === 'scope')?.ms).toBe(scope.ms);
	});
});

describe('withoutEmergency', () => {
	it('drops the emergency view from the real registry', () => {
		const out = withoutEmergency(PANELS);
		expect(out.map((p) => p.id)).not.toContain(EMERGENCY_PANEL_ID);
		expect(out).toHaveLength(PANELS.length - 1);
	});

	it('leaves a rotation without it untouched', () => {
		expect(ids(withoutEmergency(REG))).toEqual(['a', 'b', 'c', 'd']);
	});

	it('keeps the relative order of everything else', () => {
		const out = withoutEmergency(applyOrder(null));
		const expected = PANELS.filter((p) => p.id !== EMERGENCY_PANEL_ID).map((p) => p.id);
		expect(out.map((p) => p.id)).toEqual(expected);
	});

	it('falls back rather than returning an empty rotation', () => {
		// Nothing but the emergency view left: the kiosk still needs something to
		// render between emergencies.
		const onlyEmergency = PANELS.filter((p) => p.id === EMERGENCY_PANEL_ID);
		expect(ids(withoutEmergency(onlyEmergency))).toEqual([EMERGENCY_PANEL_ID]);
	});

	it('does not mutate its input', () => {
		const before = ids(PANELS);
		withoutEmergency(PANELS);
		expect(ids(PANELS)).toEqual(before);
	});
});

describe('applyStation', () => {
	const byId = (panels: Panel[], id: string) => panels.find((p) => p.id === id)!;

	it('leaves the defaults in place when nothing is saved', () => {
		for (const station of [null, undefined, {}]) {
			const out = applyStation(PANELS, station);
			expect(byId(out, 'local').props.fixedNm).toBe(DEFAULT_STATION.local_nm);
			expect(byId(out, 'home').props.fixedNm).toBe(DEFAULT_STATION.home_nm);
			expect(byId(out, 'metar').props.icaos).toEqual(DEFAULT_STATION.metar_stations);
			expect(byId(out, 'local').name).toBe(localScopeName(DEFAULT_STATION));
		}
	});

	it('applies the ranges, the local label and the weather stations', () => {
		const out = applyStation(PANELS, {
			local_label: 'Bay Area',
			local_nm: 60,
			home_nm: 8,
			metar_stations: ['KSFO', 'KOAK']
		});
		expect(byId(out, 'local').name).toBe('Local · Bay Area');
		expect(byId(out, 'local').props).toMatchObject({ fixedNm: 60, showType: true });
		expect(byId(out, 'home').props.fixedNm).toBe(8);
		expect(byId(out, 'metar').props.icaos).toEqual(['KSFO', 'KOAK']);
		// Untouched views are the same objects.
		expect(byId(out, 'scope')).toBe(byId(PANELS, 'scope'));
	});

	it('names the local scope by range when there is no label', () => {
		expect(localScopeName({ local_label: '', local_nm: 40 })).toBe('Local · 40 nm');
		expect(localScopeName({ local_label: '  ', local_nm: 25 })).toBe('Local · 25 nm');
		expect(byId(applyStation(PANELS, { local_nm: 25 }), 'local').name).toBe('Local · 25 nm');
	});

	it('clamps out-of-range values and falls back from garbage', () => {
		const out = applyStation(PANELS, {
			local_nm: 9999,
			home_nm: Number.NaN,
			metar_stations: []
		} as never);
		expect(byId(out, 'local').props.fixedNm).toBe(240);
		expect(byId(out, 'home').props.fixedNm).toBe(DEFAULT_STATION.home_nm);
		expect(byId(out, 'metar').props.icaos).toEqual(DEFAULT_STATION.metar_stations);
	});

	it('does not mutate the registry', () => {
		applyStation(PANELS, { local_nm: 99, home_nm: 3 });
		expect(byId(PANELS, 'local').props.fixedNm).toBe(DEFAULT_STATION.local_nm);
		expect(byId(PANELS, 'home').props.fixedNm).toBe(DEFAULT_STATION.home_nm);
	});
});
