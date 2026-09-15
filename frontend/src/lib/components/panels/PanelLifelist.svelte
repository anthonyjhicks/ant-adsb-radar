<script lang="ts">
	import { onMount } from 'svelte';
	import { getLifelist, type Lifelist } from '$lib/api/history';

	// Type-Dex: a collection view of every aircraft TYPE the receiver has ever
	// logged, surfacing the rarest visitors first (fewest distinct days seen).
	// Like a birder's life list — each type designator is a card in the dex.
	let data = $state<Lifelist | null>(null);

	async function load() {
		try {
			data = await getLifelist();
		} catch {
			// ignore — keep the last good collection
		}
	}
	onMount(() => {
		load();
		const t = setInterval(load, 60_000);
		return () => clearInterval(t);
	});

	function shortDate(epoch: number): string {
		return new Date(epoch * 1000).toLocaleDateString('en-GB', {
			day: '2-digit',
			month: 'short',
			timeZone: 'UTC'
		});
	}

	function dayLabel(days: number): string {
		return days === 1 ? '1 day' : `${days} days`;
	}
</script>

<div class="flex h-full flex-col px-8 py-4 max-lg:h-auto max-lg:min-h-full max-lg:px-4">
	<div class="mb-3 flex items-baseline justify-between">
		<div>
			<span class="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">Type-dex</span>
			<span class="ml-3 text-xs text-muted-foreground">every type ever logged · rarest first</span>
		</div>
		{#if data}
			<div class="text-xs text-muted-foreground tabular-nums">
				{data.total_types} types · {data.total_airframes} airframes
			</div>
		{/if}
	</div>

	<!-- collection summary stat cards -->
	<div class="mb-4 grid grid-cols-2 gap-3">
		<div class="rounded-lg border border-border/50 bg-card/40 p-3">
			<div class="text-[10px] uppercase tracking-widest text-muted-foreground">Types collected</div>
			<div class="text-2xl font-bold tabular-nums text-cyan-300">
				{(data?.total_types ?? 0).toLocaleString()}
			</div>
		</div>
		<div class="rounded-lg border border-border/50 bg-card/40 p-3">
			<div class="text-[10px] uppercase tracking-widest text-muted-foreground">Airframes logged</div>
			<div class="text-2xl font-bold tabular-nums text-emerald-300">
				{(data?.total_airframes ?? 0).toLocaleString()}
			</div>
		</div>
	</div>

	{#if data && data.types.length === 0}
		<div class="flex flex-1 items-center justify-center text-sm text-muted-foreground">
			Collecting data…
		</div>
	{:else}
		<div
			class="grid min-h-0 flex-1 grid-cols-4 content-start gap-3 overflow-y-auto max-xl:grid-cols-3 max-lg:grid-cols-2 max-sm:grid-cols-1"
		>
			{#each data?.types ?? [] as t (t.label)}
				{@const veryRare = t.days <= 1}
				{@const rare = t.days <= 2}
				<div
					class="flex flex-col gap-2 rounded-lg border bg-card/40 p-3 {veryRare
						? 'border-amber-400/60 ring-1 ring-amber-400/40'
						: 'border-border/50'}"
				>
					<div class="flex items-start justify-between gap-2">
						<span class="font-mono text-xl font-bold tracking-wide text-foreground/90">{t.label}</span>
						<div class="flex shrink-0 items-center gap-1">
							{#if t.mil}
								<span class="rounded px-1 text-[9px] font-bold uppercase bg-lime-500/20 text-lime-300">MIL</span>
							{/if}
							{#if t.interesting}
								<span class="rounded px-1 text-[9px] font-bold uppercase bg-amber-500/20 text-amber-300">★</span>
							{/if}
						</div>
					</div>

					<div class="flex flex-wrap items-center gap-1.5">
						<span
							class="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tabular-nums {rare
								? 'bg-amber-500/20 text-amber-300'
								: 'bg-white/[0.04] text-muted-foreground'}"
						>
							{dayLabel(t.days)}
						</span>
						<span class="text-[11px] text-muted-foreground tabular-nums">
							{t.airframes} airframe{t.airframes === 1 ? '' : 's'}
						</span>
					</div>

					<div class="text-[10px] uppercase tracking-widest text-muted-foreground tabular-nums">
						first {shortDate(t.first_day)}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
