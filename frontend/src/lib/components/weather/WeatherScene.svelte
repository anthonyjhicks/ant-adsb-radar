<script lang="ts">
	// Canvas host for the animated sky (scene.ts). Owns the render loop for as
	// long as it's on screen; the kiosk unmounts the view when it rotates away.
	import { onMount } from 'svelte';
	import type { SceneConditions } from '$lib/utils/weather';
	import { WeatherSceneRenderer } from './scene';

	let {
		conditions,
		sunElevation = 30,
		sunAzimuth = null
	}: { conditions: SceneConditions; sunElevation?: number; sunAzimuth?: number | null } = $props();

	let canvas: HTMLCanvasElement;
	let renderer: WeatherSceneRenderer | null = null;

	onMount(() => {
		renderer = new WeatherSceneRenderer(canvas);
		renderer.resize();
		renderer.setConditions(conditions);
		renderer.setSun({ elevation: sunElevation, azimuth: sunAzimuth });
		const ro = new ResizeObserver(() => renderer?.resize());
		ro.observe(canvas);
		renderer.start();
		return () => {
			ro.disconnect();
			renderer?.stop();
			renderer = null;
		};
	});

	// Read the props unconditionally so the effects track them even before the
	// renderer exists (an optional-chained argument wouldn't be evaluated).
	$effect(() => {
		const c = conditions;
		renderer?.setConditions(c);
	});
	$effect(() => {
		const sun = { elevation: sunElevation, azimuth: sunAzimuth };
		renderer?.setSun(sun);
	});
</script>

<canvas bind:this={canvas} class="absolute inset-0 h-full w-full"></canvas>
