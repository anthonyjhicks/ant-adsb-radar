<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { sseConnection } from '$lib/stores/sse.svelte';

	let { children } = $props();

	onMount(() => {
		// ?nosse=1 skips the live stream (used for static screenshots); the page
		// still renders from the SSR snapshot loaded in +page.ts.
		const noSse = new URLSearchParams(window.location.search).get('nosse') === '1';
		if (!noSse) sseConnection.connect();
		return () => sseConnection.disconnect();
	});
</script>

{@render children()}
