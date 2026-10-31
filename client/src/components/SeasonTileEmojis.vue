<script setup lang="ts">
// The Halloween emoji on the cover tiles, driven from the outside: this component
// renders nothing. It adds one emoji every few seconds to a visible cover
// that has none (utils/seasonTileEmojis.ts), up to the cap, and a scroll clears
// them all (utils/seasonScrolled.ts). The card lists never re-render for it: the
// emoji is two attributes on the cover, read by Global/_seasons.scss.
//
// Mounted in App.vue only while the season is Halloween, so leaving the season
// (or the page) unmounts it and clears what it drew.

// @libraries
import { useMediaQuery } from "@vueuse/core";
import { onBeforeUnmount, onMounted } from "vue";
import { useRouter } from "vue-router";

// @utils
import { SEASON_SCROLLED_CLASS, watchSeasonScroll, type SeasonScrollWatch } from "@/utils/seasonScrolled";
import { addOneTile, clearTiles, nextTileDelayMs } from "@/utils/seasonTileEmojis";

const router = useRouter();
// Reduce motion: the tiles would only pop, and nothing here is needed for the season.
const lessMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

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
    if (!paused) addOneTile(document, Math.random);
    schedule();
}

function startAgain(): void {
    // A new page, or the scroll has settled: nothing carries over.
    scroll?.reset();
    clearTiles(document);
}

onMounted(() => {
    if (lessMotion.value) return;
    // The scroll settles: the tiles are cleared and the count starts again from zero.
    scroll = watchSeasonScroll({ onSettle: () => clearTiles(document) });
    unhookRoute = router.afterEach(startAgain);
    schedule();
});

onBeforeUnmount(() => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    scroll?.stop();
    scroll = undefined;
    unhookRoute?.();
    unhookRoute = undefined;
    clearTiles(document);
});
</script>
