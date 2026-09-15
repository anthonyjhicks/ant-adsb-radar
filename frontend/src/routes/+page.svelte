<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { sseConnection } from '$lib/stores/sse.svelte';
	import { radarStore } from '$lib/stores/radar.svelte';
	import { scopeSettings } from '$lib/stores/scopeSettings.svelte';
	import ScopeControls from '$lib/components/panels/ScopeControls.svelte';
	import PanelScope from '$lib/components/panels/PanelScope.svelte';
	import {
		EMERGENCY_PANEL_ID,
		PANELS,
		applyDwell,
		applyOrder,
		applyStation,
		visiblePanels,
		withoutEmergency
	} from '$lib/panels';
	import { DEFAULT_STATION } from '$lib/api/config';

	let { data } = $props();

	// The station settings saved at /config (name, position, scope ranges…);
	// nothing saved, or an unreachable backend, means the built-in defaults.
	let stationCfg = $derived({ ...DEFAULT_STATION, ...(data.station ?? {}) });

	// The rotation: the registry's default order, re-sorted by whatever was saved
	// from /config, minus the views hidden there, with the station's scope ranges
	// applied. An empty/missing saved config (or an unreachable backend) just
	// leaves the defaults in place. Derived, so returning from the config page
	// (which re-runs load) picks up a new order without a hard reload.
	let ordered = $derived(
		applyStation(applyDwell(applyOrder(data.panelOrder), data.panelDwell), data.station)
	);
	// Set when ?view= names a view that isn't in the rotation — hidden, or the
	// emergency view. An explicit deep-link wins: pinning a wall display to a
	// view kept out of the rotation is a reason to hide it, not a contradiction.
	let showAll = $state(false);
	// The emergency view is a takeover rather than a rotation member (see below),
	// so it never takes a slot in the normal cycle.
	let panels = $derived(
		showAll ? ordered : withoutEmergency(visiblePanels(ordered, data.panelHidden))
	);

	let snap = $derived(radarStore.snapshot);

	// --- Emergency takeover ----------------------------------------------------
	// While anything is squawking an emergency the kiosk drops whatever it was
	// showing, holds on the emergency view, and stays there until the emergency
	// clears — an unattended wall display shouldn't rotate away from it.
	//
	// `snap.emergencies` is the backend's list: the 7500/7600/7700 trio plus the
	// ADS-B emergency/priority field. Deliberately narrower than the special
	// squawks the panel itself also surfaces (7777, 7400, 0000) — 0000 in
	// particular is common enough that locking the kiosk on it would be noise.
	const EMERGENCY_PANEL = PANELS.find((p) => p.id === EMERGENCY_PANEL_ID)!;
	let emergencies = $derived(snap?.emergencies ?? []);
	// Navigating by hand lets a person look elsewhere during a long incident; a
	// *new* emergency re-locks (see the klaxon effect).
	let lockReleased = $state(false);
	let locked = $derived(emergencies.length > 0 && !lockReleased);

	let index = $state(0);
	let paused = $state(false);
	let now = $state(new Date());
	let progress = $state(0);
	let lastTick = $state(Date.now());

	// The kiosk is a fixed 1920×1080 stage. On the wall display it renders 1:1;
	// on smaller screens (phones/tablets) we scale the whole stage to fit so it's
	// viewable anywhere without touching the layout. Desktop keeps no transform.
	let vw = $state(1920);
	let vh = $state(1080);
	// Below lg (1024px) we reflow to a mobile layout via max-lg: classes (no
	// stage). At lg+ but smaller than a full 1080p kiosk we scale the fixed
	// 16:9 stage to fit. The wall display (≥1280×720) renders 1:1.
	let useStage = $derived(vw >= 1024 && (vw < 1280 || vh < 720));
	let scale = $derived(useStage ? Math.min(vw / 1920, vh / 1080) : 1);

	let current = $derived(locked ? EMERGENCY_PANEL : (panels[index] ?? panels[0]));

	// Hiding views from /config shrinks the rotation under a live kiosk, so an
	// index left past the end would leave the dots highlighting nothing until
	// the next advance. Pull it back in range as soon as that happens.
	$effect(() => {
		if (index >= panels.length) index = 0;
	});

	function go(i: number) {
		// Any deliberate navigation releases the lock, so the operator isn't
		// trapped on the emergency view for as long as the squawk lasts.
		lockReleased = true;
		index = (i + panels.length) % panels.length;
		progress = 0;
		lastTick = Date.now();
	}

	function togglePause() {
		paused = !paused;
		lastTick = Date.now();
	}

	// Touch gestures (mobile only): swipe left/right to change view, tap to
	// pause/resume the auto-rotation. Gated to <lg so the wall kiosk is untouched.
	let touchX = 0;
	let touchY = 0;
	let touchT = 0;
	function onTouchStart(e: TouchEvent) {
		if (vw >= 1024) return;
		const t = e.changedTouches[0];
		touchX = t.clientX;
		touchY = t.clientY;
		touchT = Date.now();
	}
	function onTouchEnd(e: TouchEvent) {
		if (vw >= 1024) return;
		const t = e.changedTouches[0];
		const dx = t.clientX - touchX;
		const dy = t.clientY - touchY;
		const dt = Date.now() - touchT;
		if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.3) {
			go(dx < 0 ? index + 1 : index - 1); // swipe left → next, right → prev
		} else if (Math.abs(dx) < 12 && Math.abs(dy) < 12 && dt < 350) {
			togglePause(); // tap
		}
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'ArrowRight') go(index + 1);
		else if (e.key === 'ArrowLeft') go(index - 1);
		else if (e.key === ' ' || e.key.toLowerCase() === 'p') {
			togglePause();
		} else if (e.key.toLowerCase() === 's') {
			scopeSettings.toggle('sweep');
		} else if (e.key.toLowerCase() === 'v') {
			scopeSettings.toggle('vectors');
		} else if (/^[1-9]$/.test(e.key)) {
			const i = parseInt(e.key, 10) - 1;
			if (i < panels.length) go(i);
		}
	}

	onMount(() => {
		sseConnection.connect();
		scopeSettings.init();
		radarStore.hydrate(data.snapshot ?? null, data.stats ?? null);

		// Deep-link / kiosk override: ?view=<panel id> starts on that panel,
		// ?paused=1 holds it there (handy for wall displays pinned to one view).
		const params = new URLSearchParams(window.location.search);
		const view = params.get('view');
		// Deep-linking a view that's out of the rotation brings it back, this tab only.
		if (view && !panels.some((p) => p.id === view) && ordered.some((p) => p.id === view)) {
			showAll = true;
		}
		const start = panels.findIndex((p) => p.id === view);
		if (start >= 0) index = start;
		if (params.get('paused') === '1') paused = true;
		if (params.get('sweep') === '0') scopeSettings.set('sweep', false);
		if (params.get('vectors') === '0') scopeSettings.set('vectors', false);

		const tick = setInterval(() => {
			now = new Date();
			if (paused) {
				lastTick = Date.now();
				return;
			}
			// Locked on an emergency: hold this view, and don't run the dwell down.
			if (locked) {
				lastTick = Date.now();
				return;
			}
			const elapsed = Date.now() - lastTick;
			progress = Math.min(elapsed / current.ms, 1);
			if (elapsed >= current.ms) go(index + 1);
		}, 100);

		window.addEventListener('keydown', onKey);
		return () => {
			clearInterval(tick);
			window.removeEventListener('keydown', onKey);
		};
	});

	let connected = $derived(sseConnection.connected);

	// --- Emergency klaxon (#10) ------------------------------------------------
	// When a new emergency squawk appears, flash the screen, sound an alert tone,
	// and jump to the Emergency Watch panel so an unattended kiosk draws the eye.
	let flashing = $state(false);
	const knownEmergencies = new Set<string>();
	let audioCtx: AudioContext | null = null;
	let flashTimer: ReturnType<typeof setTimeout> | null = null;

	function klaxon() {
		try {
			const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
			audioCtx ??= new Ctor();
			const ctx = audioCtx;
			if (ctx.state === 'suspended') ctx.resume();
			// Two-tone alternating warble, ~1.6s.
			for (let i = 0; i < 4; i++) {
				const osc = ctx.createOscillator();
				const gain = ctx.createGain();
				osc.type = 'square';
				osc.frequency.value = i % 2 === 0 ? 880 : 660;
				osc.connect(gain).connect(ctx.destination);
				const t0 = ctx.currentTime + i * 0.4;
				gain.gain.setValueAtTime(0.0001, t0);
				gain.gain.exponentialRampToValueAtTime(0.15, t0 + 0.02);
				gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
				osc.start(t0);
				osc.stop(t0 + 0.38);
			}
		} catch {
			// audio unavailable (autoplay policy / no device) — visual alert still fires
		}
	}

	$effect(() => {
		const list = snap?.emergencies ?? [];
		const fresh = list.filter((a) => !knownEmergencies.has(a.hex));
		// Re-sync to currently-active emergencies so a cleared-then-returned
		// squawk re-alerts, and stale hexes don't suppress a genuinely new one.
		knownEmergencies.clear();
		for (const a of list) knownEmergencies.add(a.hex);
		// Everything cleared: arm the lock again for the next one.
		if (list.length === 0) lockReleased = false;
		if (fresh.length === 0) return;

		klaxon();
		flashing = true;
		// A new emergency re-takes the screen even if someone had navigated away
		// during an earlier one.
		lockReleased = false;
		if (flashTimer) clearTimeout(flashTimer);
		flashTimer = setTimeout(() => (flashing = false), 6000);
	});
	let zulu = $derived(
		now.toLocaleTimeString('en-GB', {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hour12: false,
			timeZone: 'UTC'
		})
	);
	let dateStr = $derived(
		now.toLocaleDateString('en-GB', {
			day: '2-digit',
			month: 'short',
			year: 'numeric',
			timeZone: 'UTC'
		})
	);

	// The receiver's coordinates in the header — only when switched on at
	// /config, since a wall display is often in view of visitors.
	let station = $derived.by(() => {
		const r = snap?.receiver;
		if (!stationCfg.show_coords || !r || r.lat == null || r.lon == null) return '';
		return `${r.lat.toFixed(3)}°, ${r.lon.toFixed(3)}°`;
	});

	const accentBar: Record<string, string> = {
		emerald: 'bg-emerald-400',
		cyan: 'bg-cyan-400',
		amber: 'bg-amber-400',
		violet: 'bg-violet-400',
		sky: 'bg-sky-400',
		red: 'bg-red-400'
	};
	const accentText: Record<string, string> = {
		emerald: 'text-emerald-300',
		cyan: 'text-cyan-300',
		amber: 'text-amber-300',
		violet: 'text-violet-300',
		sky: 'text-sky-300',
		red: 'text-red-300'
	};
</script>

<svelte:head><title>{stationCfg.name}</title></svelte:head>

<svelte:window bind:innerWidth={vw} bind:innerHeight={vh} />

<div class="flex h-dvh w-dvw items-center justify-center overflow-hidden bg-black">
<div
	class="relative flex shrink-0 flex-col overflow-hidden font-mono"
	style="width: {useStage ? '1920px' : '100%'}; height: {useStage ? '1080px' : '100%'}; transform: {useStage
		? `scale(${scale})`
		: 'none'}; transform-origin: center center; background: radial-gradient(ellipse at center, oklch(0.18 0.02 220) 0%, oklch(0.12 0.015 240) 70%, oklch(0.1 0.01 250) 100%);"
>
	<!-- Top status bar -->
	<header
		class="z-10 flex items-center justify-between border-b border-border/40 bg-background/50 px-8 py-2.5 backdrop-blur max-lg:px-3 max-lg:py-1.5"
	>
		<div class="flex items-center gap-5 max-lg:gap-2">
			<div class="flex items-center gap-2.5">
				<span
					class="h-2.5 w-2.5 rounded-full {connected
						? 'bg-emerald-400 shadow-[0_0_10px] shadow-emerald-400/70'
						: 'animate-pulse bg-red-500'}"
				></span>
				<span class="text-xs uppercase tracking-[0.3em] text-muted-foreground">
					{stationCfg.name}
				</span>
			</div>
			{#if station}
				<span class="text-xs uppercase tracking-widest text-muted-foreground max-lg:hidden">{station}</span>
			{/if}
			<span class="hidden text-xs uppercase tracking-wider text-muted-foreground md:inline">
				· {current.name}
			</span>
		</div>

		<div class="flex items-center gap-7 max-lg:gap-3">
			<div class="text-right">
				<div class="text-[10px] uppercase tracking-widest text-muted-foreground">Contacts</div>
				<div class="text-lg font-bold leading-none tabular-nums text-cyan-300">
					{snap?.counts.total ?? 0}
					<span class="text-[10px] font-normal text-muted-foreground"
						>/ {snap?.counts.positioned ?? 0} pos</span
					>
				</div>
			</div>
			{#if (snap?.counts.emergencies ?? 0) > 0}
				<div class="text-right">
					<div class="text-[10px] uppercase tracking-widest text-red-400">Emergency</div>
					<div class="animate-pulse text-lg font-bold leading-none tabular-nums text-red-400">
						{snap?.counts.emergencies}
					</div>
				</div>
			{/if}
			<div class="text-right">
				<div class="text-[10px] uppercase tracking-widest text-muted-foreground">{dateStr}</div>
				<div class="text-2xl font-bold leading-none tabular-nums">
					{zulu}<span class="ml-1 text-sm font-normal text-muted-foreground">Z</span>
				</div>
			</div>
		</div>
	</header>

	<!-- Rotating content -->
	<main
		class="relative flex-1 overflow-hidden"
		style="touch-action: pan-y;"
		ontouchstart={onTouchStart}
		ontouchend={onTouchEnd}
	>
		{#key current.id}
			{@const Panel = current.component as typeof PanelScope}
			<div class="absolute inset-0 max-lg:overflow-y-auto" in:fade={{ duration: 300 }} out:fade={{ duration: 200 }}>
				<Panel {...current.props} />
			</div>
		{/key}
		{#if paused}
			<div
				class="absolute right-6 top-4 rounded-full bg-amber-500/20 px-3 py-1 text-xs font-bold uppercase tracking-widest text-amber-300"
			>
				Paused
			</div>
		{/if}
	</main>

	<!-- Emergency klaxon: pulsing red frame when a new emergency squawk appears -->
	{#if flashing}
		<div class="pointer-events-none absolute inset-0 z-20 animate-pulse border-[6px] border-red-500/80 bg-red-600/10"></div>
	{/if}

	<!-- Bottom progress -->
	<footer
		class="z-10 flex items-center gap-4 border-t border-border/40 bg-background/50 px-8 py-2.5 backdrop-blur max-lg:gap-2 max-lg:px-3"
	>
		<div class="flex gap-2">
			{#each panels as p, i (p.id)}
				<button
					onclick={() => go(i)}
					class="h-1.5 rounded-full transition-all duration-300 {i === index && !locked
						? 'w-10 ' + accentBar[p.accent]
						: 'w-1.5 bg-muted-foreground/30'}"
					aria-label={p.name}
				></button>
			{/each}
		</div>
		<div class="text-[11px] uppercase tracking-widest {accentText[current.accent]}">
			{current.name}
		</div>
		{#if locked}
			<span
				class="animate-pulse rounded bg-red-500/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-red-300"
			>
				Holding · {emergencies.length} emergency{emergencies.length === 1 ? '' : ' contacts'}
			</span>
		{/if}
		<div class="ml-auto flex items-center gap-3 text-[10px] uppercase tracking-widest">
			<span class="flex items-center gap-2 max-lg:hidden">
				{#if current.id === 'scope' || current.id === 'local' || current.id === 'home'}
					<ScopeControls />
				{:else if locked}
					<span class="text-red-300/80">rotation held · ← → to resume</span>
				{:else}
					<span class="text-muted-foreground/70">← → switch · space pause · 1–9 jump</span>
				{/if}
			</span>
			<a
				href="/config"
				class="shrink-0 text-muted-foreground/60 transition-colors hover:text-cyan-300"
				title="Set the view order">Config</a
			>
		</div>
		<!-- dwell progress -->
		<div class="absolute inset-x-0 bottom-0 h-0.5 bg-transparent">
			<div
				class="h-full {accentBar[current.accent]} transition-[width] duration-100 ease-linear"
				style="width: {locked ? 100 : progress * 100}%"
			></div>
		</div>
	</footer>
</div>
</div>
