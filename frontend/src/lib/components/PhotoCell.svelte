<script lang="ts">
	import type { Snippet } from 'svelte';

	// Shared "spotter photo" cell: the planespotters thumbnail fills the cell with
	// object-contain on black (no upscaling — native ~500px stays crisp at grid
	// size), a bottom-up gradient keeps overlaid detail legible, and the
	// photographer is credited top-right. Used by the photo grid, Movers &
	// extremes, and Interesting airframes so they all read the same; each panel
	// supplies its own detail overlay via `children` and a no-photo `fallback`.
	let {
		src = null,
		alt = 'aircraft',
		credit = null,
		class: cls = '',
		fallback,
		children
	}: {
		src?: string | null;
		alt?: string;
		credit?: string | null;
		class?: string;
		fallback?: Snippet;
		children?: Snippet;
	} = $props();
</script>

<div class="relative overflow-hidden rounded-md bg-neutral-900 {cls}">
	{#if src}
		<img {src} {alt} class="absolute inset-0 h-full w-full object-contain" />
		<div class="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/15 to-transparent"></div>
	{:else if fallback}
		{@render fallback()}
	{/if}

	{@render children?.()}

	{#if credit}
		<div class="absolute right-2 top-2 rounded bg-black/40 px-1.5 py-0.5 text-[9px] text-white/55">
			© {credit}
		</div>
	{/if}
</div>
