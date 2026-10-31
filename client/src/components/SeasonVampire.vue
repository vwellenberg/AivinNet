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
// tab is hidden, and a peek ends early when the page scrolls or the route changes
// (the overlay is fixed, so it would otherwise float away from its card).
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
    PEEK_SIZE_PX,
    nextPeekDelayMs,
    peekAnchor,
    pickPeekTarget,
} from "@/utils/vampirePeek";

interface Peek {
    key: number;
    x: number;
    y: number;
}

const lessMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
const visibility = useDocumentVisibility();
const route = useRoute();

const peek = ref<Peek | null>(null);
let seq = 0;
let nextTimer: ReturnType<typeof setTimeout> | undefined;
let endTimer: ReturnType<typeof setTimeout> | undefined;

// The CSS reads these; the durations are custom properties, not literals.
const peekStyle = computed(() =>
    peek.value
        ? {
              "--peek-x": `${peek.value.x}px`,
              "--peek-y": `${peek.value.y}px`,
              "--peek-size": `${PEEK_SIZE_PX}px`,
              "--peek-dur": `${PEEK_DURATION_MS}ms`,
          }
        : {}
);

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
    const { x, y } = peekAnchor(rects[index]);
    peek.value = { key: ++seq, x, y };
    window.addEventListener("scroll", endPeek, { capture: true, passive: true });
    endTimer = setTimeout(endPeek, PEEK_DURATION_MS);
}

/** Ends the peek (on time, or early on scroll or a route change) and books the next one. */
function endPeek(): void {
    if (endTimer !== undefined) clearTimeout(endTimer);
    endTimer = undefined;
    window.removeEventListener("scroll", endPeek, { capture: true });
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

watch(
    () => route.fullPath,
    () => endPeek()
);

onMounted(schedule);

onBeforeUnmount(() => {
    clearNext();
    if (endTimer !== undefined) clearTimeout(endTimer);
    endTimer = undefined;
    window.removeEventListener("scroll", endPeek, { capture: true });
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

// Rise in the first 18 %, a pause of about a second, down out of sight at 49 %.
@keyframes season-peek-rise {
    0% {
        transform: translate3d(-50%, 100%, 0);
    }
    18%,
    48% {
        transform: translate3d(-50%, 0, 0);
    }
    49%,
    100% {
        transform: translate3d(-50%, 100%, 0);
    }
}

// The puff: a 💨 that opens from the edge at 50 % and thins out.
@keyframes season-peek-puff {
    0%,
    47% {
        opacity: 0;
        transform: translate3d(-50%, 50%, 0) scale(0.3);
    }
    50% {
        opacity: 1;
        transform: translate3d(-50%, 50%, 0) scale(0.6);
    }
    72% {
        opacity: 0.9;
        transform: translate3d(-50%, 50%, 0) scale(1.4);
    }
    100% {
        opacity: 0;
        transform: translate3d(-50%, 50%, 0) scale(1.7);
    }
}

// The bat leaves from the puff, up and to the left, fading as it goes.
@keyframes season-peek-bat {
    0%,
    50% {
        opacity: 0;
        transform: translate3d(-50%, -50%, 0);
    }
    53% {
        opacity: 1;
        transform: translate3d(-50%, -50%, 0);
    }
    100% {
        opacity: 0;
        transform: translate3d(calc(-50% - 10rem), calc(-50% - 12rem), 0);
    }
}
</style>
