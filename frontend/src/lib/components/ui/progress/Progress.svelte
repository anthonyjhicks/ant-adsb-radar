<script lang="ts">
	import { cn } from '$lib/utils/cn';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		class: className,
		value = 0,
		max = 100,
		color,
		...restProps
	}: HTMLAttributes<HTMLDivElement> & { value?: number; max?: number; color?: string } = $props();

	let percentage = $derived(Math.min(100, Math.max(0, (value / max) * 100)));
</script>

<div
	class={cn('relative h-2 w-full overflow-hidden rounded-full bg-primary/20', className)}
	{...restProps}
>
	<div
		class={cn('h-full rounded-full transition-all duration-300', color ?? 'bg-primary')}
		style="width: {percentage}%"
	></div>
</div>
