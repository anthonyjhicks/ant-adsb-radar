<script lang="ts">
	// Shared aircraft-photo presentation. planespotters only serves ~500px
	// images, so filling a large area with object-cover visibly upscales them.
	// Instead we float a sharp, size-capped copy over a blurred, dimmed fill of
	// the same image: it reads as a full-bleed hero without the pixelation, and
	// scales down crisply in small slots (the closest-contact card).
	let {
		src,
		alt = 'aircraft',
		credit = null,
		maxImgPx = 1100
	}: { src: string; alt?: string; credit?: string | null; maxImgPx?: number } = $props();
</script>

<div class="relative h-full w-full overflow-hidden">
	<!-- blurred, dimmed backdrop fills the frame -->
	<img
		{src}
		alt=""
		aria-hidden="true"
		class="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover blur-2xl brightness-[0.45] saturate-150"
	/>
	<div class="absolute inset-0 bg-black/20"></div>

	<!-- sharp foreground, capped near native size so it stays crisp -->
	<div class="relative flex h-full w-full items-center justify-center p-2">
		<img
			{src}
			{alt}
			class="max-h-full max-w-full rounded-lg object-contain shadow-2xl ring-1 ring-white/10"
			style="max-width:min(100%,{maxImgPx}px); max-height:min(100%,{Math.round(maxImgPx * 0.56)}px);"
		/>
	</div>

	{#if credit}
		<div class="absolute bottom-1.5 right-2 rounded bg-black/45 px-1.5 py-0.5 text-[10px] text-white/65">
			© {credit} · planespotters.net
		</div>
	{/if}
</div>
