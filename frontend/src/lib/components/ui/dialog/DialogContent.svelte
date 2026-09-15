<script lang="ts">
	import { Dialog } from 'bits-ui';
	import { cn } from '$lib/utils/cn';
	import type { Snippet } from 'svelte';
	import DialogOverlay from './DialogOverlay.svelte';

	let {
		class: className,
		children,
		...restProps
	}: { class?: string; children: Snippet } & Record<string, unknown> = $props();
</script>

<Dialog.Portal>
	<DialogOverlay />
	<Dialog.Content
		class={cn(
			'fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 border bg-background p-6 shadow-lg sm:rounded-lg',
			className
		)}
		{...restProps}
	>
		{@render children()}
	</Dialog.Content>
</Dialog.Portal>
