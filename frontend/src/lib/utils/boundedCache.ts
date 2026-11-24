/**
 * A Map that holds at most `max` entries, dropping the least recently used.
 *
 * The kiosk tab stays open for days and meets thousands of distinct aircraft
 * and callsigns, so the shared lookup caches (routes, photos, airframe
 * details) would otherwise grow for as long as the page lives. A few hundred
 * entries comfortably covers everything on screen at once.
 */
export class BoundedCache<K, V> extends Map<K, V> {
	readonly max: number;

	constructor(max: number) {
		super();
		this.max = Math.max(1, Math.floor(max));
	}

	override get(key: K): V | undefined {
		if (!super.has(key)) return undefined;
		const value = super.get(key) as V;
		// Re-insert so this key becomes the newest; Map iterates oldest first.
		super.delete(key);
		super.set(key, value);
		return value;
	}

	override set(key: K, value: V): this {
		super.delete(key);
		super.set(key, value);
		while (this.size > this.max) {
			const oldest = this.keys().next();
			if (oldest.done) break;
			super.delete(oldest.value);
		}
		return this;
	}
}
