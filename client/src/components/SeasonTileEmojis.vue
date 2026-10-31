<template>
    <!-- The layer the glyphs stand in: fixed over the page, so no cover's overflow clips them. -->
    <div ref="layer" class="season-tile-layer" aria-hidden="true"></div>
</template>

<script setup lang="ts">
// The seasonal emoji on the cover tiles, driven from the outside: each emoji
// stands on the top edge of a visible cover that has none (utils/seasonTileEmojis.ts),
// one every few seconds, up to the cap. This component draws them into its own layer
// (the covers are not clipped that way), and a scroll clears them all
// (utils/seasonScrolled.ts). The card lists never re-render for it.
//
// Mounted in App.vue while a season is active, with that season as the prop; the
// weights are the season's own (tileEmojiWeightsFor). Leaving the season (or the
// page) unmounts it and clears what it drew.

// @libraries
import { useMediaQuery } from "@vueuse/core";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";

// @utils
import { SEASON_SCROLLED_CLASS, watchSeasonScroll, type SeasonScrollWatch } from "@/utils/seasonScrolled";
import { addOneTile, clearTiles, layoutTiles, nextTileDelayMs, tileEmojiWeightsFor } from "@/utils/seasonTileEmojis";
import type { Season } from "@/utils/seasons";

const props = defineProps<{ season: Season }>();

const router = useRouter();
const weights = computed(() => tileEmojiWeightsFor(props.season));
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
        addOneTile(document, Math.random, undefined, undefined, weights.value);
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

// The season can change while mounted (the Appearance preview): the tiles drawn
// for the old season go, and the count starts again.
watch(
    () => props.season,
    () => clearAll()
);

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
