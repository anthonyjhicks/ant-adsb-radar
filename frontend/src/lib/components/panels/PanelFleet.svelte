<script lang="ts">
	import { onMount } from 'svelte';
	import { radarStore } from '$lib/stores/radar.svelte';
	import { getLeaders, type Leaders } from '$lib/api/history';

	// Operators and aircraft types — either who's overhead right now (from the
	// live snapshot), or the most-seen over the last 7 / 30 days (durable SQLite
	// history, counted by distinct airframes). One panel, three windows.
	let window = $state<'now' | 'week' | 'month'>('now');
	let leaders = $state<Leaders | null>(null);

	async function load() {
		try {
			leaders = await getLeaders();
		} catch {
			// ignore
		}
	}
	onMount(() => {
		load();
		const t = setInterval(load, 60_000);
		return () => clearInterval(t);
	});

	let snap = $derived(radarStore.snapshot);
	let ac = $derived(snap?.aircraft ?? []);

	function tally(values: (string | null | undefined)[]): { label: string; count: number }[] {
		const m = new Map<string, number>();
		for (const v of values) {
			const k = (v ?? '').trim();
			if (!k) continue;
			m.set(k, (m.get(k) ?? 0) + 1);
		}
		return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
	}

	const TOP = 13;
	let operators = $derived.by(() => {
		if (window === 'now') return tally(ac.map((a) => a.operator)).slice(0, TOP);
		return leaders?.[window].operators ?? [];
	});
	let types = $derived.by(() => {
		if (window === 'now')
			return tally(
				ac.map((a) => (a.type_long ? `${a.type_long}${a.type ? ` (${a.type})` : ''}` : a.type))
			).slice(0, TOP);
		return leaders?.[window].types ?? [];
	});
	let opMax = $derived(Math.max(1, ...operators.map((o) => o.count)));
	let typeMax = $derived(Math.max(1, ...types.map((t) => t.count)));

	let ranked = $derived(window !== 'now'); // number the rows for the league windows
	let subtitle = $derived(
		window === 'now'
			? "who's overhead right now"
			: `most-seen airframes · last ${window === 'week' ? 7 : 30} days`
	);
	let empty = $derived(operators.length === 0 && types.length === 0);

	const TABS = [
		['now', 'Now'],
		['week', '7 days'],
		['month', '30 days']
	] as const;
</script>

<div class="flex h-full flex-col px-8 py-4 max-lg:h-auto max-lg:min-h-full max-lg:px-4">
	<div class="mb-3 flex items-baseline justify-between">
		<div>
			<span class="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">Fleet &amp; operators</span>
			<span class="ml-3 text-xs text-muted-foreground">{subtitle}</span>
		</div>
		<div class="flex items-center gap-1">
			{#each TABS as [key, name] (key)}
				<button
					type="button"
					onclick={() => (window = key)}
					class="rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider transition-colors {window ===
					key
						? 'bg-violet-500/70 text-foreground'
						: 'bg-muted/40 text-muted-foreground hover:text-foreground'}"
				>
					{name}
				</button>
			{/each}
		</div>
	</div>

	{#if empty}
		<div class="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
			{window === 'now' ? 'no aircraft tracked' : 'collecting data…'}
		</div>
	{:else}
		<div class="grid min-h-0 flex-1 grid-cols-2 gap-8 max-lg:flex-none max-lg:grid-cols-1 max-lg:gap-4">
			{#snippet chart(title: string, rows: { label: string; count: number }[], max: number, barClass: string, textClass: string)}
				<div class="flex min-h-0 flex-col rounded-lg border border-border/50 bg-card/30 p-4">
					<div class="mb-3 flex items-baseline justify-between">
						<span class="text-sm font-bold uppercase tracking-wider {textClass}">{title}</span>
						<span class="text-[11px] text-muted-foreground">{rows.length} {ranked ? 'ranked' : 'identified'}</span>
					</div>
					<div class="flex min-h-0 flex-1 flex-col justify-between gap-1">
						{#each rows as r, i (r.label)}
							<div class="flex items-center gap-3">
								{#if ranked}
									<span class="w-5 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">{i + 1}.</span>
								{/if}
								<span class="{ranked ? 'w-40' : 'w-44'} shrink-0 truncate text-xs" title={r.label}>{r.label}</span>
								<div class="relative h-4 flex-1 overflow-hidden rounded-sm bg-muted/40">
									<div class="h-full rounded-sm {barClass}" style="width: {(r.count / max) * 100}%"></div>
								</div>
								<span class="w-6 shrink-0 text-right text-xs font-bold tabular-nums {textClass}">{r.count}</span>
							</div>
						{:else}
							<div class="text-xs text-muted-foreground">No data</div>
						{/each}
					</div>
				</div>
			{/snippet}

			{@render chart('Operators', operators, opMax, 'bg-violet-500/70', 'text-violet-300')}
			{@render chart('Aircraft types', types, typeMax, 'bg-cyan-500/70', 'text-cyan-300')}
		</div>
	{/if}
</div>
