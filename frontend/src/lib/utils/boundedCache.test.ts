import { describe, expect, it } from 'vitest';
import { BoundedCache } from './boundedCache';

describe('BoundedCache', () => {
	it('acts like a Map below the limit', () => {
		const c = new BoundedCache<string, number>(3);
		c.set('a', 1).set('b', 2);
		expect(c.get('a')).toBe(1);
		expect(c.has('b')).toBe(true);
		expect(c.get('zz')).toBeUndefined();
		expect(c.size).toBe(2);
	});

	it('drops the oldest entry once full', () => {
		const c = new BoundedCache<string, number>(3);
		c.set('a', 1).set('b', 2).set('c', 3).set('d', 4);
		expect(c.size).toBe(3);
		expect(c.has('a')).toBe(false);
		expect([...c.keys()]).toEqual(['b', 'c', 'd']);
	});

	it('keeps recently read entries', () => {
		const c = new BoundedCache<string, number>(3);
		c.set('a', 1).set('b', 2).set('c', 3);
		c.get('a');
		c.set('d', 4);
		expect(c.has('a')).toBe(true);
		expect(c.has('b')).toBe(false);
	});

	it('overwriting a key refreshes it without growing', () => {
		const c = new BoundedCache<string, number>(2);
		c.set('a', 1).set('b', 2).set('a', 10).set('c', 3);
		expect(c.get('a')).toBe(10);
		expect(c.has('b')).toBe(false);
		expect(c.size).toBe(2);
	});

	it('stays bounded over a long run of distinct keys', () => {
		const c = new BoundedCache<string, number>(500);
		for (let i = 0; i < 50_000; i++) c.set(`hex${i}`, i);
		expect(c.size).toBe(500);
		expect(c.has('hex49999')).toBe(true);
		expect(c.has('hex0')).toBe(false);
	});
});
