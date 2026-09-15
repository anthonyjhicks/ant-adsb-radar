<script lang="ts">
	import { cn } from '$lib/utils/cn';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	type Variant = 'default' | 'secondary' | 'destructive' | 'outline';

	let {
		class: className,
		variant = 'default',
		children,
		...restProps
	}: HTMLAttributes<HTMLDivElement> & { variant?: Variant; children?: Snippet } = $props();

	const variants: Record<Variant, string> = {
		default: 'border-transparent bg-primary text-primary-foreground shadow',
		secondary: 'border-transparent bg-secondary text-secondary-foreground',
		destructive: 'border-transparent bg-destructive text-destructive-foreground shadow',
		outline: 'text-foreground'
	};
</script>

<div
	class={cn(
		'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors',
		variants[variant],
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>
