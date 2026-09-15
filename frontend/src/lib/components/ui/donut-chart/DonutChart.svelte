<script lang="ts">
	import type { Snippet } from 'svelte';

	export interface DonutSegment {
		value: number;
		color: string;
		label: string;
	}

	let {
		segments,
		size = 120,
		strokeWidth = 14,
		children,
	}: {
		segments: DonutSegment[];
		size?: number;
		strokeWidth?: number;
		children?: Snippet;
	} = $props();

	let radius = $derived(50 - strokeWidth / 2);
	let circumference = $derived(2 * Math.PI * radius);

	let total = $derived(segments.reduce((sum, s) => sum + s.value, 0));

	let arcs = $derived.by(() => {
		if (total === 0) return [];
		let offset = 0;
		return segments
			.filter((s) => s.value > 0)
			.map((s) => {
				const pct = s.value / total;
				const dashLength = pct * circumference;
				const dashOffset = -offset * circumference;
				offset += pct;
				return { ...s, dashLength, dashOffset };
			});
	});
</script>

<svg width={size} height={size} viewBox="0 0 100 100" class="block">
	<!-- Background ring -->
	<circle
		cx="50"
		cy="50"
		r={radius}
		fill="none"
		stroke="currentColor"
		stroke-width={strokeWidth}
		class="text-muted/20"
	/>
	<!-- Segments -->
	{#each arcs as arc}
		<circle
			cx="50"
			cy="50"
			r={radius}
			fill="none"
			stroke={arc.color}
			stroke-width={strokeWidth}
			stroke-dasharray="{arc.dashLength} {circumference - arc.dashLength}"
			stroke-dashoffset={arc.dashOffset}
			stroke-linecap="butt"
			transform="rotate(-90 50 50)"
			class="transition-all duration-500"
		/>
	{/each}
	<!-- Center content -->
	{#if children}
		<foreignObject x="15" y="15" width="70" height="70">
			<div class="flex h-full w-full items-center justify-center text-center">
				{@render children()}
			</div>
		</foreignObject>
	{/if}
</svg>
