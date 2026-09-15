/**
 * Reactive keyed lookup with a shared cache — for per-aircraft async data
 * (routes, photos). Create one in a component, then drive it from an $effect:
 *
 *   const route = reactiveLookup(getRoute, routeCache);
 *   $effect(() => route.load(a?.flight ?? null));
 *   ... route.value ...
 */
export function reactiveLookup<T>(fetcher: (key: string) => Promise<T>, cache: Map<string, T>) {
	let value = $state<T | null>(null);
	let activeKey = '';

	function load(key: string | null | undefined) {
		const k = (key ?? '').trim();
		if (!k) {
			value = null;
			activeKey = '';
			return;
		}
		if (k === activeKey) return;
		activeKey = k;
		const cached = cache.get(k);
		if (cached) {
			value = cached;
			return;
		}
		value = null;
		fetcher(k)
			.then((v) => {
				cache.set(k, v);
				if (activeKey === k) value = v;
			})
			.catch(() => {});
	}

	return {
		get value() {
			return value;
		},
		load
	};
}
