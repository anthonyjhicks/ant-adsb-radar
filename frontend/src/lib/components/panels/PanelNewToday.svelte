<script lang="ts">
	import { onMount } from 'svelte';
	import { getSeenToday, type SeenAircraft } from '$lib/api/history';

	// First-seen-today log: every airframe the receiver has logged for the first
	// time since 00:00Z, newest first. Rare types and military/interesting
	// airframes are surfaced as highlights at the top.
	let aircraft = $state<SeenAircraft[]>([]);
	let loaded = $state(false);

	async function load() {
		try {
			const r = await getSeenToday(120);
			aircraft = r.aircraft;
			loaded = true;
		} catch {
			// ignore — keep the last good list
		}
	}
	onMount(() => {
		load();
		const t = setInterval(load, 30_000);
		return () => clearInterval(t);
	});

	let highlights = $derived(aircraft.filter((a) => a.mil || a.interesting || a.rare).slice(0, 12));

	function zulu(epoch: number): string {
		return new Date(epoch * 1000).toLocaleTimeString('en-GB', {
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
			timeZone: 'UTC'
		});
	}
	function tag(a: SeenAircraft): { label: string; cls: string } | null {
		if (a.mil) return { label: 'MIL', cls: 'bg-lime-500/20 text-lime-300' };
		if (a.interesting) return { label: '★', cls: 'bg-amber-500/20 text-amber-300' };
		if (a.rare) return { label: 'NEW', cls: 'bg-cyan-500/20 text-cyan-300' };
		return null;
	}
</script>

<div class="flex h-full flex-col px-8 py-4 max-lg:h-auto max-lg:min-h-full max-lg:px-4">
	<div class="mb-3 flex items-baseline justify-between">
		<div>
			<span class="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">First seen today</span>
			<span class="ml-3 text-xs text-muted-foreground">new airframes since 00:00Z</span>
		</div>
		<div class="text-xs text-muted-foreground tabular-nums">{aircraft.length} logged today</div>
	</div>

	{#if highlights.length > 0}
		<div class="mb-3 flex flex-wrap gap-2 rounded-lg border border-border/40 bg-card/30 p-3">
			<span class="self-center text-[10px] uppercase tracking-widest text-muted-foreground">Highlights</span>
			{#each highlights as a (a.hex)}
				{@const t = tag(a)}
				<span class="flex items-center gap-1.5 rounded border border-border/40 bg-background/40 px-2 py-1 text-xs">
					{#if t}<span class="rounded px-1 text-[9px] font-bold uppercase {t.cls}">{t.label}</span>{/if}
					<span class="font-bold text-foreground/90">{a.flight ?? a.registration ?? a.hex}</span>
					{#if a.type}<span class="text-muted-foreground">{a.type}</span>{/if}
				</span>
			{/each}
		</div>
	{/if}

	{#if loaded && aircraft.length === 0}
		<div class="flex flex-1 items-center justify-center text-sm text-muted-foreground">
			Collecting — no aircraft logged yet today.
		</div>
	{:else}
		<div class="grid flex-1 grid-cols-3 content-start gap-x-6 gap-y-0.5 overflow-hidden max-lg:grid-cols-1 max-lg:overflow-visible">
			{#each aircraft as a (a.hex)}
				{@const t = tag(a)}
				<div class="grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded px-2 py-1 text-sm odd:bg-white/[0.015]">
					<span class="font-mono text-xs text-muted-foreground tabular-nums">{zulu(a.first_seen)}</span>
					<span class="flex items-center gap-1.5 truncate">
						<span class="truncate font-bold">{a.flight ?? a.registration ?? a.hex}</span>
						{#if t}<span class="rounded px-1 text-[9px] font-bold uppercase {t.cls}">{t.label}</span>{/if}
					</span>
					<span class="truncate text-right text-xs text-muted-foreground">{a.type ?? a.operator ?? ''}</span>
				</div>
			{/each}
		</div>
	{/if}
</div>
