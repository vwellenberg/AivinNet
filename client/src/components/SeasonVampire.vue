<template>
    <div
        v-if="peek && !lessMotion"
        :key="peek.key"
        class="season-peek"
        :style="peekStyle"
        aria-hidden="true"
    >
        <span class="season-peek-clip">
            <span class="season-peek-vampire">🧛</span>
        </span>
        <span class="season-peek-puff">💨</span>
        <span class="season-peek-bat">🦇</span>
    </div>
</template>

<script setup lang="ts">
// A vampire rises from behind the top edge of a card cover, pauses, puffs into
// a bat and flies off up and to the left. Mounted in App.vue only while the
// season is Halloween. It draws nothing under "reduce motion", nothing while the
// tab is hidden. A scroll or a route change ends a peek that is still behind its
// card (the overlay is fixed, so it would otherwise float away from it); once the
// bat has taken off it flies off the screen on its own, and the peek ends there.
//
// The timing and the choice of card are in utils/vampirePeek.ts; this component
// only runs the clock and draws the overlay.

// @libraries
import { useDocumentVisibility, useMediaQuery } from "@vueuse/core";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";

// @utils
import { COVER_SELECTOR } from "@/utils/seasonTileEmojis";
import {
    PEEK_DURATION_MS,
    PEEK_LAUNCH_FRACTION,
    PEEK_SIZE_PX,
    nextPeekDelayMs,
    peekAnchor,
    peekExit,
    pickPeekTarget,
} from "@/utils/vampirePeek";

interface Peek {
    key: number;
    x: number;
    y: number;
    /** Where the bat flies to, relative to the anchor (utils/vampirePeek.ts::peekExit). */
    exitX: number;
    exitY: number;
}

const lessMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
const visibility = useDocumentVisibility();
const route = useRoute();

const peek = ref<Peek | null>(null);
let seq = 0;
let nextTimer: ReturnType<typeof setTimeout> | undefined;
let endTimer: ReturnType<typeof setTimeout> | undefined;
let launchTimer: ReturnType<typeof setTimeout> | undefined;

// The CSS reads these; the durations are custom properties, not literals.
const peekStyle = computed(() =>
    peek.value
        ? {
              "--peek-x": `${peek.value.x}px`,
              "--peek-y": `${peek.value.y}px`,
              "--peek-exit-x": `${peek.value.exitX}px`,
              "--peek-exit-y": `${peek.value.exitY}px`,
              "--peek-size": `${PEEK_SIZE_PX}px`,
              "--peek-dur": `${PEEK_DURATION_MS}ms`,
          }
        : {}
);

/**
 * A scroll takes the peek away while the vampire is still behind its card. Once
 * the bat has taken off it is left to fly off screen (it no longer rides the
 * card), so the scroll listener goes at the launch.
 */
function unhookScroll(): void {
    if (launchTimer !== undefined) clearTimeout(launchTimer);
    launchTimer = undefined;
    window.removeEventListener("scroll", endPeek, { capture: true });
}

function clearNext(): void {
    if (nextTimer !== undefined) clearTimeout(nextTimer);
    nextTimer = undefined;
}

function schedule(): void {
    clearNext();
    if (visibility.value === "hidden") return;
    nextTimer = setTimeout(tryPeek, nextPeekDelayMs(Math.random));
}

function tryPeek(): void {
    nextTimer = undefined;
    if (visibility.value === "hidden") return;
    if (lessMotion.value) {
        schedule();
        return;
    }
    const covers = Array.from(document.querySelectorAll<HTMLElement>(COVER_SELECTOR));
    const rects = covers.map((el) => el.getBoundingClientRect());
    const index = pickPeekTarget(rects, { width: window.innerWidth, height: window.innerHeight }, Math.random);
    if (index === null) {
        schedule();
        return;
    }
    const anchor = peekAnchor(rects[index]);
    const exit = peekExit(anchor);
    peek.value = { key: ++seq, x: anchor.x, y: anchor.y, exitX: exit.x, exitY: exit.y };
    window.addEventListener("scroll", endPeek, { capture: true, passive: true });
    launchTimer = setTimeout(unhookScroll, PEEK_DURATION_MS * PEEK_LAUNCH_FRACTION);
    // The whole peek: the bat has flown off the screen by the end of it.
    endTimer = setTimeout(endPeek, PEEK_DURATION_MS);
}

/** Ends the peek (on time, or early on a scroll before the launch, or a route change) and books the next one. */
function endPeek(): void {
    if (endTimer !== undefined) clearTimeout(endTimer);
    endTimer = undefined;
    unhookScroll();
    peek.value = null;
    schedule();
}

watch(visibility, (state) => {
    if (state === "hidden") {
        clearNext();
    } else if (!peek.value) {
        schedule();
    }
});

// A route change ends a peek that is still behind its card. Once the bat has
// taken off (no launch timer left) it flies on to its end, like a scroll does.
watch(
    () => route.fullPath,
    () => {
        if (launchTimer !== undefined) endPeek();
    }
);

onMounted(schedule);

onBeforeUnmount(() => {
    clearNext();
    if (endTimer !== undefined) clearTimeout(endTimer);
    endTimer = undefined;
    unhookScroll();
    peek.value = null;
});
</script>

<style lang="scss">
// ============================================================================
// THE VAMPIRE PEEK (Halloween): a fixed overlay anchored to the middle of a
// card cover's top edge. `.season-peek` has no size; its children hang from its
// point. The vampire sits in a clip box whose bottom IS that edge, so only the
// part above the card shows: it rises from behind the card.
//
// Every keyframe is a percentage of one custom property (`--peek-dur`), so the
// sequence keeps its proportions and the CSS holds no duration literal. Nothing
// here takes a pointer event.
// ============================================================================

.season-peek {
    position: fixed;
    left: var(--peek-x, 0);
    top: var(--peek-y, 0);
    width: 0;
    height: 0;
    z-index: 41;
    pointer-events: none;
}

// The clip: its bottom is the anchor (the card's top edge), so nothing below
// the edge can show.
.season-peek-clip {
    position: absolute;
    left: calc(var(--peek-size) * -0.5);
    bottom: 0;
    width: var(--peek-size);
    height: var(--peek-size);
    overflow: hidden;
}

.season-peek-vampire,
.season-peek-puff,
.season-peek-bat {
    position: absolute;
    bottom: 0;
    font-size: var(--peek-size);
    line-height: 1;
    white-space: nowrap;
}

// Hidden at rest: the animation's end state is the hidden one, and with no fill
// the base style is what shows after it.
.season-peek-vampire {
    left: 50%;
    transform: translate3d(-50%, 100%, 0);
    animation: season-peek-rise var(--peek-dur) $motion-curve-settle backwards;
}

.season-peek-puff {
    left: 0;
    opacity: 0;
    animation: season-peek-puff var(--peek-dur) ease-out backwards;
}

.season-peek-bat {
    left: 0;
    opacity: 0;
    animation: season-peek-bat var(--peek-dur) ease-out backwards;
}

// The percentages are of PEEK_DURATION_MS (4000 ms) and keep the vampire's and
// the puff's milliseconds from when it was 3200 ms: only the bat's flight got
// longer (utils/vampirePeek.ts). The launch is at 40 % = PEEK_LAUNCH_FRACTION.
//
// Rise in the first 14.4 % (576 ms), a pause of about a second, down out of
// sight at 39.2 %.
@keyframes season-peek-rise {
    0% {
        transform: translate3d(-50%, 100%, 0);
    }
    14.4%,
    38.4% {
        transform: translate3d(-50%, 0, 0);
    }
    39.2%,
    100% {
        transform: translate3d(-50%, 100%, 0);
    }
}

// The puff: a 💨 that opens from the edge at the launch (40 %) and thins out by 80 %.
@keyframes season-peek-puff {
    0%,
    37.6% {
        opacity: 0;
        transform: translate3d(-50%, 50%, 0) scale(0.3);
    }
    40% {
        opacity: 1;
        transform: translate3d(-50%, 50%, 0) scale(0.6);
    }
    57.6% {
        opacity: 0.9;
        transform: translate3d(-50%, 50%, 0) scale(1.4);
    }
    80%,
    100% {
        opacity: 0;
        transform: translate3d(-50%, 50%, 0) scale(1.7);
    }
}

// The bat leaves from the puff and flies up and to the left at full opacity, all
// the way off the screen: `--peek-exit-x/y` is the offset to a point past both
// edges (utils/vampirePeek.ts::peekExit), so it is gone before the peek ends
// and never fades out in view.
@keyframes season-peek-bat {
    0%,
    40% {
        opacity: 0;
        transform: translate3d(-50%, -50%, 0);
    }
    42.4% {
        opacity: 1;
        transform: translate3d(-50%, -50%, 0);
    }
    100% {
        opacity: 1;
        transform: translate3d(calc(-50% + var(--peek-exit-x, 0px)), calc(-50% + var(--peek-exit-y, 0px)), 0);
    }
}
</style>
