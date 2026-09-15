<script lang="ts">
	import { radarStore } from '$lib/stores/radar.svelte';
	import { formatNumber } from '$lib/utils/format';

	let snap = $derived(radarStore.snapshot);
	let stats = $derived(radarStore.stats);
	let hist = $derived(radarStore.rateHistory);

	// Custom message-rate sparkline.
	const W = 760;
	const H = 150;
	let spark = $derived.by(() => {
		if (hist.length < 2) return { line: '', area: '', max: 0, min: 0 };
		const max = Math.max(...hist) * 1.1 || 1;
		const min = Math.min(...hist) * 0.9;
		const range = max - min || 1;
		const x = (i: number) => (i / (hist.length - 1)) * W;
		const y = (v: number) => H - ((v - min) / range) * H;
		const pts = hist.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
		return {
			line: `M${pts.join(' L')}`,
			area: `M0,${H} L${pts.join(' L')} L${W},${H} Z`,
			max,
			min
		};
	});

	// Polar coverage rose (full, normalized to max range).
	const PC = 110;
	let rosePath = $derived.by(() => {
		const polar = snap?.polar_range ?? [];
		if (polar.length < 3) return '';
		const polarMax = Math.max(...polar.map((p) => p[1])) || 1;
		const pts = polar.map(([deg, nm]) => {
			const r = (nm / polarMax) * 92;
			const rad = (deg * Math.PI) / 180;
			return `${PC + r * Math.sin(rad)},${PC - r * Math.cos(rad)}`;
		});
		return `M${pts.join(' L')} Z`;
	});

	let signalPct = $derived.by(() => {
		// Map signal (dBFS, ~-30..0) and noise to a 0..100 bar.
		const sig = stats?.latest.local_signal;
		if (sig == null) return 0;
		return Math.max(0, Math.min(100, ((sig + 35) / 35) * 100));
	});
</script>

<div class="grid h-full grid-cols-3 grid-rows-[auto_1fr] gap-4 px-6 py-4 max-lg:flex max-lg:h-auto max-lg:min-h-full max-lg:flex-col max-lg:px-4">
	<!-- Top stat strip -->
	<div class="col-span-3 grid grid-cols-5 gap-3 max-lg:grid-cols-2">
		{#snippet kpi(label: string, value: string, sub: string, accent: string)}
			<div class="rounded-lg border border-border/50 bg-card/40 px-4 py-3">
				<div class="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
				<div class="mt-0.5 text-3xl font-bold tabular-nums {accent}">{value}</div>
				<div class="text-[11px] text-muted-foreground">{sub}</div>
			</div>
		{/snippet}

		{@render kpi('Mode S / sec', formatNumber(Math.round(snap?.messages_per_sec ?? 0)), 'live rate', 'text-violet-300')}
		{@render kpi('Contacts', String(snap?.counts.total ?? 0), `${snap?.counts.positioned ?? 0} positioned`, 'text-cyan-300')}
		{@render kpi('Max range', `${(snap?.max_range_nm ?? 0).toFixed(0)}`, 'nm all-time', 'text-emerald-300')}
		{@render kpi('Total msgs', formatNumber(snap?.messages_total ?? 0), 'since start', 'text-foreground')}
		{@render kpi(
			'MLAT tracks',
			String(stats?.latest.tracks_mlat ?? 0),
			`${stats?.latest.tracks_with_position ?? 0} w/ position`,
			'text-sky-300'
		)}
	</div>

	<!-- Message rate chart -->
	<div class="col-span-2 flex flex-col rounded-lg border border-border/50 bg-card/40 p-4">
		<div class="mb-2 flex items-baseline justify-between">
			<span class="text-[11px] uppercase tracking-widest text-muted-foreground">Message rate</span>
			<span class="text-xs tabular-nums text-violet-300"
				>{Math.round(snap?.messages_per_sec ?? 0)} /s · peak {Math.round(spark.max)}</span
			>
		</div>
		<div class="relative flex-1">
			<svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" class="h-full w-full">
				<defs>
					<linearGradient id="rateFill" x1="0" y1="0" x2="0" y2="1">
						<stop offset="0%" stop-color="var(--color-primary)" stop-opacity="0.35" />
						<stop offset="100%" stop-color="var(--color-primary)" stop-opacity="0" />
					</linearGradient>
				</defs>
				{#if spark.line}
					<path d={spark.area} fill="url(#rateFill)" />
					<path d={spark.line} fill="none" stroke="oklch(0.74 0.14 300)" stroke-width="2" vector-effect="non-scaling-stroke" />
				{:else}
					<text x={W / 2} y={H / 2} fill="var(--color-muted-foreground)" font-size="14" text-anchor="middle">collecting…</text>
				{/if}
			</svg>
		</div>
	</div>

	<!-- Coverage rose -->
	<div class="row-span-1 flex flex-col items-center rounded-lg border border-border/50 bg-card/40 p-4">
		<div class="mb-1 w-full text-[11px] uppercase tracking-widest text-muted-foreground">Coverage</div>
		<svg viewBox="0 0 {PC * 2} {PC * 2}" class="h-40 w-40">
			<circle cx={PC} cy={PC} r="92" fill="var(--scope-bg)" stroke="var(--scope-line)" stroke-opacity="0.25" />
			<circle cx={PC} cy={PC} r="46" fill="none" stroke="var(--scope-line)" stroke-opacity="0.15" />
			{#each ['N', 'E', 'S', 'W'] as d, i (d)}
				{@const rad = (i * 90 * Math.PI) / 180}
				<text x={PC + 102 * Math.sin(rad)} y={PC - 102 * Math.cos(rad)} fill="var(--scope-line)" fill-opacity="0.55" font-size="12" text-anchor="middle" dominant-baseline="middle" font-family="monospace">{d}</text>
			{/each}
			{#if rosePath}
				<path d={rosePath} fill="var(--scope-line)" fill-opacity="0.18" stroke="var(--scope-line)" stroke-opacity="0.6" stroke-width="1.5" />
			{/if}
		</svg>
		<div class="mt-1 text-xs text-emerald-300/80">max {(snap?.max_range_nm ?? 0).toFixed(0)} nm</div>
	</div>

	<!-- Signal + CPR -->
	<div class="col-span-2 grid grid-cols-2 gap-4 max-lg:grid-cols-1">
		<div class="rounded-lg border border-border/50 bg-card/40 p-4">
			<div class="mb-3 text-[11px] uppercase tracking-widest text-muted-foreground">Signal (dBFS)</div>
			<div class="flex flex-col gap-3 text-sm">
				{#snippet sig(label: string, v: number | null | undefined, accent: string)}
					<div class="flex items-center justify-between">
						<span class="text-muted-foreground">{label}</span>
						<span class="font-bold tabular-nums {accent}">{v != null ? v.toFixed(1) : '—'}</span>
					</div>
				{/snippet}
				{@render sig('Mean signal', stats?.latest.local_signal, 'text-emerald-300')}
				{@render sig('Peak signal', stats?.latest.local_peak_signal, 'text-cyan-300')}
				{@render sig('Noise floor', stats?.latest.local_noise, 'text-amber-300')}
				<div class="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
					<div class="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400" style="width:{signalPct}%"></div>
				</div>
				<div class="flex justify-between text-[11px] text-muted-foreground">
					<span>strong msgs {formatNumber(stats?.latest.local_strong_signals ?? 0)}</span>
				</div>
			</div>
		</div>

		<div class="rounded-lg border border-border/50 bg-card/40 p-4">
			<div class="mb-3 text-[11px] uppercase tracking-widest text-muted-foreground">Decoding</div>
			<div class="flex flex-col gap-3 text-sm">
				{#snippet row(label: string, v: string, accent = 'text-foreground')}
					<div class="flex items-center justify-between">
						<span class="text-muted-foreground">{label}</span>
						<span class="font-bold tabular-nums {accent}">{v}</span>
					</div>
				{/snippet}
				{@render row('CPR global ok', formatNumber(stats?.latest.cpr_global_ok ?? 0), 'text-emerald-300')}
				{@render row('CPR global bad', formatNumber(stats?.latest.cpr_global_bad ?? 0), 'text-amber-300')}
				{@render row('New tracks', formatNumber(stats?.latest.tracks_new ?? 0), 'text-cyan-300')}
				{@render row('Airborne / ground', `${snap?.counts.airborne ?? 0} / ${snap?.counts.on_ground ?? 0}`)}
				{@render row('Emergencies', String(snap?.counts.emergencies ?? 0), (snap?.counts.emergencies ?? 0) > 0 ? 'text-red-400' : 'text-emerald-300')}
			</div>
		</div>
	</div>
</div>
