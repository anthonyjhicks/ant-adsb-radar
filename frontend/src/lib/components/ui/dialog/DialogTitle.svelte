<script lang="ts">
	import { Dialog } from 'bits-ui';
	import { cn } from '$lib/utils/cn';
	import type { Snippet } from 'svelte';

	let {
		class: className,
		children,
		...restProps
	}: { class?: string; children: Snippet } & Record<string, unknown> = $props();
</script>

<Dialog.Title class={cn('text-lg font-semibold leading-none tracking-tight', className)} {...restProps}>
	{@render children()}
</Dialog.Title>
