<script lang="ts">
	import { onMount } from 'svelte';
	import {
		getHourly,
		getSummary,
		getAirframeStats,
		type HourBucket,
		type HistorySummary,
		type AirframeStats
	} from '$lib/api/history';
	import { getPhotoStats, type PhotoCacheStats } from '$lib/api/photo';

	// Durable activity trends from the SQLite history: today-so-far vs yesterday,
	// plus an hourly bar chart of unique aircraft over the last 24h.
	let summary = $state<HistorySummary | null>(null);
	let buckets = $state<HourBucket[]>([]);
	let photo = $state<PhotoCacheStats | null>(null);
	let airframes = $state<AirframeStats | null>(null);

	async function load() {
		try {
			[summary, { buckets }, photo, airframes] = await Promise.all([
				getSummary(),
				getHourly(24),
				getPhotoStats(),
				getAirframeStats()
			]);
		} catch {
			// ignore
		}
	}
	onMount(() => {
		load();
		const t = setInterval(load, 60_000);
		return () => clearInterval(t);
	});

	// Bucket the last 24 hours, filling gaps so the chart x-axis is continuous.
	let series = $derived.by(() => {
		const byHour = new Map(buckets.map((b) => [b.hour, b]));
		const nowHour = Math.floor(Date.now() / 3_600_000) * 3600;
		const out: { hour: number; unique: number; peak: number }[] = [];
		for (let i = 23; i >= 0; i--) {
			const h = nowHour - i * 3600;
			const b = byHour.get(h);
			out.push({ hour: h, unique: b?.unique_ac ?? 0, peak: b?.peak_contacts ?? 0 });
		}
		return out;
	});
	let maxUnique = $derived(Math.max(1, ...series.map((s) => s.unique)));

	function hh(epoch: number): string {
		return new Date(epoch * 1000).toLocaleTimeString('en-GB', {
			hour: '2-digit',
			hour12: false,
			timeZone: 'UTC'
		});
	}

	const cards = [
		{ key: 'unique_ac', label: 'Unique aircraft', accent: 'text-cyan-300' },
		{ key: 'peak_contacts', label: 'Peak contacts', accent: 'text-violet-300' },
		{ key: 'max_range_nm', label: 'Max range (nm)', accent: 'text-emerald-300' },
		{ key: 'messages', label: 'Messages', accent: 'text-sky-300' }
	] as const;

	function fmt(v: number, key: string): string {
		if (key === 'messages') return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `${v}`;
		if (key === 'max_range_nm') return v.toFixed(0);
		return `${v}`;
	}
	function delta(key: string): number | null {
		if (!summary) return null;
		const t = summary.today[key as keyof typeof summary.today];
		const y = summary.yesterday[key as keyof typeof summary.yesterday];
		if (!y) return null;
		return Math.round(((t - y) / y) * 100);
	}

	let hitRate = $derived(photo?.hit_rate != null ? Math.round(photo.hit_rate * 100) : null);
	function mb(bytes: number): string {
		return `${(bytes / 1_048_576).toFixed(0)}M`;
	}

	// New airframes (first-ever sightings) by period, against the all-time total.
	const airframeCards = [
		{ key: 'today', label: 'Today' },
		{ key: 'week', label: 'This week' },
		{ key: 'month', label: 'This month' }
	] as const;
	function pct(n: number): string | null {
		const total = airframes?.total ?? 0;
		return total ? `${Math.round((n / total) * 100)}%` : null;
	}
</script>

<div class="flex h-full flex-col px-8 py-4 max-lg:h-auto max-lg:min-h-full max-lg:px-4">
	<div class="mb-3 flex items-baseline justify-between">
		<div>
			<span class="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">Activity trends</span>
			<span class="ml-3 text-xs text-muted-foreground">today vs yesterday · UTC</span>
		</div>
	</div>

	<!-- today vs yesterday stat cards -->
	<div class="mb-4 grid grid-cols-4 gap-3 max-lg:grid-cols-2">
		{#each cards as c (c.key)}
			{@const today = summary?.today[c.key] ?? 0}
			{@const yest = summary?.yesterday[c.key] ?? 0}
			{@const d = delta(c.key)}
			<div class="rounded-lg border border-border/50 bg-card/40 p-3">
				<div class="text-[10px] uppercase tracking-widest text-muted-foreground">{c.label}</div>
				<div class="flex items-baseline gap-2">
					<span class="text-2xl font-bold tabular-nums {c.accent}">{fmt(today, c.key)}</span>
					{#if d != null}
						<span class="text-[11px] tabular-nums {d >= 0 ? 'text-emerald-400/80' : 'text-red-400/80'}">
							{d >= 0 ? '▲' : '▼'}{Math.abs(d)}%
						</span>
					{/if}
				</div>
				<div class="text-[11px] text-muted-foreground tabular-nums">yest {fmt(yest, c.key)}</div>
			</div>
		{/each}
	</div>

	<!-- photo cache effectiveness -->
	<div class="mb-4 flex items-center justify-between gap-4 rounded-lg border border-border/50 bg-card/40 px-3 py-2">
		<div class="flex items-baseline gap-2">
			<span class="text-[10px] uppercase tracking-widest text-muted-foreground">Photo cache</span>
			{#if hitRate != null}
				<span class="text-xl font-bold tabular-nums text-amber-300">{hitRate}%</span>
				<span class="text-[11px] text-muted-foreground">hit rate</span>
			{:else}
				<span class="text-[11px] text-muted-foreground">collecting…</span>
			{/if}
		</div>
		<div class="flex items-baseline gap-4 text-[11px] text-muted-foreground tabular-nums">
			{#if photo}
				<span>{photo.hits.toLocaleString()} hits · {photo.misses.toLocaleString()} miss</span>
				<span>{photo.cached_aircraft.toLocaleString()} cached · {mb(photo.bytes_used)}/{mb(photo.bytes_max)}</span>
			{/if}
		</div>
	</div>

	<!-- new airframes seen, by period, vs all-time total -->
	<div class="mb-4 flex items-center justify-between gap-4 rounded-lg border border-border/50 bg-card/40 px-3 py-2">
		<div class="flex items-baseline gap-2">
			<span class="text-[10px] uppercase tracking-widest text-muted-foreground">New airframes</span>
			<span class="text-[11px] text-muted-foreground">first-ever sightings</span>
		</div>
		<div class="flex items-baseline gap-5 tabular-nums">
			{#each airframeCards as c (c.key)}
				{@const n = airframes?.[c.key] ?? 0}
				<div class="flex items-baseline gap-1.5">
					<span class="text-[10px] uppercase tracking-widest text-muted-foreground">{c.label}</span>
					<span class="text-xl font-bold text-teal-300">{n.toLocaleString()}</span>
					{#if pct(n)}
						<span class="text-[11px] text-muted-foreground">{pct(n)}</span>
					{/if}
				</div>
			{/each}
			<div class="flex items-baseline gap-1.5 border-l border-border/50 pl-5">
				<span class="text-[10px] uppercase tracking-widest text-muted-foreground">All-time</span>
				<span class="text-xl font-bold text-foreground">{(airframes?.total ?? 0).toLocaleString()}</span>
			</div>
		</div>
	</div>

	<!-- hourly unique-aircraft bars -->
	<div class="flex min-h-0 flex-1 flex-col rounded-lg border border-border/50 bg-card/30 p-4">
		<div class="mb-2 flex items-baseline justify-between">
			<span class="text-[10px] uppercase tracking-widest text-muted-foreground">Unique aircraft · last 24h</span>
			<span class="text-[11px] text-muted-foreground tabular-nums">peak {maxUnique}/h</span>
		</div>
		<div class="flex min-h-0 flex-1 items-end gap-[3px]">
			{#each series as s (s.hour)}
				<div class="flex flex-1 flex-col items-center justify-end gap-1" style="height:100%">
					<div
						class="w-full rounded-t bg-cyan-400/70"
						style="height:{(s.unique / maxUnique) * 100}%; min-height:{s.unique > 0 ? '2px' : '0'}"
						title="{hh(s.hour)}Z · {s.unique} unique"
					></div>
				</div>
			{/each}
		</div>
		<div class="mt-1 flex justify-between text-[9px] text-muted-foreground/60 tabular-nums">
			<span>{hh(series[0]?.hour ?? 0)}Z</span>
			<span>{hh(series[12]?.hour ?? 0)}Z</span>
			<span>now</span>
		</div>
	</div>
</div>
