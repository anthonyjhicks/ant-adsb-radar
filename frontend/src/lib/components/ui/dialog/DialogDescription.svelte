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

<Dialog.Description class={cn('text-sm text-muted-foreground', className)} {...restProps}>
	{@render children()}
</Dialog.Description>
