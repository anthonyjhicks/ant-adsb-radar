<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { sseConnection } from '#lib/stores/sse.svelte.ts';
	import { radarStore } from '#lib/stores/radar.svelte.ts';
	import { reloadIntervalMs, startAutoReload } from '#lib/utils/autoReload.ts';

	let { children } = $props();

	onMount(() => {
		// ?nosse=1 skips the live stream (used for static screenshots); the page
		// still renders from the SSR snapshot loaded in +page.ts.
		const noSse = new URLSearchParams(window.location.search).get('nosse') === '1';
		if (!noSse) sseConnection.connect();

		// A full reload every few hours keeps a long-running display responsive
		// (?reload=<hours>, ?reload=0 for never). Held off while editing at /config,
		// and during an emergency: a fresh page would sound the klaxon again for
		// the same squawk.
		const stopReload = startAutoReload({
			intervalMs: reloadIntervalMs(window.location.search),
			canReload: () =>
				page.route.id !== '/config' && !radarStore.snapshot?.emergencies?.length
		});

		return () => {
			stopReload();
			sseConnection.disconnect();
		};
	});
</script>

{@render children()}
