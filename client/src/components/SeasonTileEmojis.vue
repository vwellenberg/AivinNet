<template>
    <!-- The layer the glyphs stand in: fixed over the page, so no cover's overflow clips them. -->
    <div ref="layer" class="season-tile-layer" aria-hidden="true"></div>
</template>

<script setup lang="ts">
// The Halloween emoji on the cover tiles, driven from the outside: each emoji
// stands on the top edge of a visible cover that has none (utils/seasonTileEmojis.ts),
// one every few seconds, up to the cap. This component draws them into its own layer
// (the covers are not clipped that way), and a scroll clears them all
// (utils/seasonScrolled.ts). The card lists never re-render for it.
//
// Mounted in App.vue only while the season is Halloween, so leaving the season
// (or the page) unmounts it and clears what it drew.

// @libraries
import { useMediaQuery } from "@vueuse/core";
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

// @utils
import { SEASON_SCROLLED_CLASS, watchSeasonScroll, type SeasonScrollWatch } from "@/utils/seasonScrolled";
import { addOneTile, clearTiles, layoutTiles, nextTileDelayMs } from "@/utils/seasonTileEmojis";

const router = useRouter();
// Reduce motion: the tiles would only pop, and nothing here is needed for the season.
const lessMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
const layer = ref<HTMLElement | null>(null);

let timer: ReturnType<typeof setTimeout> | undefined;
let scroll: SeasonScrollWatch | undefined;
let unhookRoute: (() => void) | undefined;

function schedule(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(tick, nextTileDelayMs(Math.random));
}

function tick(): void {
    timer = undefined;
    // Paused, not stopped: a hidden tab, or a page that is being scrolled right now.
    const paused =
        document.visibilityState === "hidden" || document.documentElement.classList.contains(SEASON_SCROLLED_CLASS);
    if (!paused && layer.value) {
        addOneTile(document, Math.random);
        layoutTiles(document, layer.value);
    }
    schedule();
}

function clearAll(): void {
    clearTiles(document, layer.value ?? undefined);
}

function startAgain(): void {
    // A new page, or the scroll has settled: nothing carries over.
    scroll?.reset();
    clearAll();
}

/** The glyphs sit on the covers' edges in viewport px: a resize moves the covers, so they follow. */
function relayout(): void {
    if (layer.value) layoutTiles(document, layer.value);
}

onMounted(() => {
    if (lessMotion.value) return;
    // The scroll settles: the tiles are cleared and the count starts again from zero.
    scroll = watchSeasonScroll({ onSettle: clearAll });
    unhookRoute = router.afterEach(startAgain);
    window.addEventListener("resize", relayout, { passive: true });
    schedule();
});

onBeforeUnmount(() => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    scroll?.stop();
    scroll = undefined;
    unhookRoute?.();
    unhookRoute = undefined;
    window.removeEventListener("resize", relayout);
    clearAll();
});
</script>
