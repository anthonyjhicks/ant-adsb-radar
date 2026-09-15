<script lang="ts">
	import { scopeSettings, SCOPE_LAYERS } from '$lib/stores/scopeSettings.svelte';
</script>

<div class="flex flex-wrap items-center gap-1.5">
	{#each SCOPE_LAYERS as l (l.key)}
		<button
			onclick={() => scopeSettings.toggle(l.key)}
			class="cursor-pointer rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors {scopeSettings
				.layers[l.key]
				? 'bg-emerald-500/15 text-emerald-300'
				: 'bg-muted/40 text-muted-foreground/45'}"
		>
			{l.label}
		</button>
	{/each}
</div>
