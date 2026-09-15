<script lang="ts">
	export interface BarItem {
		label: string;
		value: number;
		color?: string;
	}

	let {
		bars,
		maxValue,
	}: {
		bars: BarItem[];
		maxValue?: number;
	} = $props();

	let max = $derived(maxValue ?? Math.max(...bars.map((b) => b.value), 1));

	const defaultColors = [
		'bg-emerald-500',
		'bg-blue-500',
		'bg-amber-500',
		'bg-violet-500',
		'bg-rose-500',
		'bg-cyan-500',
		'bg-orange-500',
		'bg-teal-500',
	];
</script>

<div class="space-y-2">
	{#each bars as bar, i}
		{@const pct = max > 0 ? (bar.value / max) * 100 : 0}
		<div class="flex items-center gap-3 text-sm">
			<span class="w-28 truncate text-muted-foreground text-xs" title={bar.label}>{bar.label}</span>
			<div class="flex-1 h-4 rounded-full bg-primary/10 overflow-hidden">
				<div
					class="h-full rounded-full transition-all duration-300 {bar.color ?? defaultColors[i % defaultColors.length]}"
					style="width: {pct}%"
				></div>
			</div>
			<span class="w-8 text-right text-xs font-medium">{bar.value}</span>
		</div>
	{/each}
</div>
