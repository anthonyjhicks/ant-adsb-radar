<script lang="ts" module>
	import type { Aircraft } from '$lib/types/radar';

	export type SilKind = 'airliner' | 'heli' | 'light';

	// Pick a silhouette shape from the aircraft's emitter category / type.
	export function silhouetteKind(a: Aircraft | null | undefined): SilKind {
		if (!a) return 'airliner';
		if (a.category === 'A7') return 'heli'; // rotorcraft
		if (a.category === 'A1') return 'light'; // light (<15.5k lb)
		const t = (a.type ?? '').toUpperCase();
		if (/^(C1|C2|C4|C5|C6|C7|C8|P|DA|SR|PA|BE9|BE2|TBM|PC12)/.test(t)) return 'light';
		return 'airliner';
	}
</script>

<script lang="ts">
	let {
		kind = 'airliner',
		color = 'currentColor',
		opacity = 0.25
	}: { kind?: SilKind; color?: string; opacity?: number } = $props();
</script>

<svg viewBox="0 0 100 100" class="h-20 w-20" fill={color} fill-opacity={opacity} aria-hidden="true">
	{#if kind === 'heli'}
		<circle cx="50" cy="40" r="34" fill="none" stroke={color} stroke-opacity={opacity} stroke-width="2" />
		<ellipse cx="50" cy="46" rx="9" ry="22" />
		<rect x="47" y="60" width="6" height="30" />
		<rect x="40" y="86" width="20" height="4" />
	{:else if kind === 'light'}
		<path
			d="M50 14 L53 40 L88 48 L88 54 L53 50 L53 76 L64 86 L64 90 L50 82 L36 90 L36 86 L47 76 L47 50 L12 54 L12 48 L47 40 Z"
		/>
	{:else}
		<path
			d="M50 6 L54 30 L96 54 L96 60 L54 44 L54 74 L68 88 L68 92 L50 84 L32 92 L32 88 L46 74 L46 44 L4 60 L4 54 L46 30 Z"
		/>
	{/if}
</svg>
