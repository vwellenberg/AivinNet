<template>
    <div
        v-if="season && !lessMotion"
        class="season-particles"
        :class="{ 'is-paused': visibility === 'hidden' }"
        aria-hidden="true"
    >
        <span
            v-for="(p, i) in particles"
            :key="i"
            class="season-particle"
            :class="`season-${p.kind}`"
            :style="varsOf(p)"
        >
            <span v-if="p.glyph" class="season-glyph">{{ p.glyph }}</span>
        </span>
    </div>
</template>

<script setup lang="ts">
// @libraries
import { useDocumentVisibility, useMediaQuery } from "@vueuse/core";
import { computed } from "vue";

// @utils
import { particlesFor, type Particle } from "@/utils/seasonParticles";
import type { Season } from "@/utils/seasons";

const props = defineProps<{ season: Season | null }>();

// The OS "reduce motion" setting: the same query confetti.ts and coverMorph.ts
// read. The app has no motion setting of its own, so this is the whole rule.
// Under it nothing is drawn at all; a few drifting dots would only be motion
// nobody asked for.
const lessMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
// A hidden tab stops its particles (the class below), not just its frames.
const visibility = useDocumentVisibility();

// Rolled once per season: a re-roll on every render would make the layout jump.
const particles = computed(() => particlesFor(props.season));

function varsOf(p: Particle): Record<string, string> {
    return {
        "--season-left": `${p.left}%`,
        "--season-top": `${p.top}%`,
        "--season-size": `${p.size}px`,
        "--season-dur": `${p.duration}s`,
        "--season-delay": `${p.delay}s`,
        "--season-drift": `${p.drift}px`,
        "--season-wobble": `${p.wobble}s`,
        // Off the left edge to off the right edge, or the other way round.
        "--season-from": `${p.dir > 0 ? -12 : 112}vw`,
        "--season-to": `${p.dir > 0 ? 112 : -12}vw`,
    };
}
</script>

<style lang="scss">
// ============================================================================
// SEASONAL PARTICLES: snow at Christmas, bats, ghosts and a pumpkin at
// Halloween. Mounted once in App.vue, shown only while a season is active
// (utils/seasons.ts) and never under "reduce motion" (the component above).
//
// One fixed layer, above the page and below the bottom bar (z-index 50), the
// modal (60) and the menus (1000). Pointer events are off, so nothing here can
// block a click. Every value comes in through a custom property, so the
// durations are not written as literals here (motionScale.test.ts).
// ============================================================================

.season-particles {
    position: fixed;
    inset: 0;
    z-index: 40;
    overflow: hidden;
    pointer-events: none;
}

.season-particle {
    position: absolute;
    top: var(--season-top, 0%);
    left: var(--season-left, 0%);
}

// Paused, not removed, when the tab is hidden: the layer keeps its layout.
.season-particles.is-paused .season-particle,
.season-particles.is-paused .season-glyph {
    animation-play-state: paused;
}

// Snow: a white snowflake falling from above the top edge, swaying as it goes.
.season-flake {
    top: 0;
    width: var(--season-size);
    height: var(--season-size);
    background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18"><path fill="none" stroke="%23FFFFFF" stroke-width="1.6" stroke-linecap="round" d="M9 1V17M1.5 5L16.5 13M1.5 13L16.5 5"/></svg>') center / contain no-repeat;
    opacity: 0.9;
    // White alone vanishes on the light paper; a soft dark rim keeps it on both modes.
    filter: drop-shadow(0 0 1.5px rgb(0 0 0 / 0.45));
    animation: season-snow var(--season-dur) linear var(--season-delay) infinite backwards;
}

@keyframes season-snow {
    0% {
        transform: translate3d(0, -5vh, 0);
    }
    50% {
        transform: translate3d(calc(var(--season-drift) * -1), 50vh, 0);
    }
    100% {
        transform: translate3d(var(--season-drift), 105vh, 0);
    }
}

// Bats: fly across the screen now and then, flutter in place as they go.
// `translate` and `transform` are separate properties, so the crossing and the
// flutter run side by side on one element.
//
// `backwards` goes IN the shorthand: the shorthand resets the fill mode, so a
// fill mode set on the parent rule would be lost, and a bat with a delay would
// sit at its left edge until its first crossing.
.season-bat {
    animation: season-cross var(--season-dur) linear var(--season-delay) infinite backwards;
}

.season-bat .season-glyph,
.season-pumpkin .season-glyph {
    animation: season-bob var(--season-wobble) ease-in-out infinite alternate;
}

@keyframes season-cross {
    0% {
        translate: var(--season-from) 0;
        opacity: 0;
    }
    2% {
        opacity: 1;
    }
    12% {
        translate: var(--season-to) 0;
        opacity: 1;
    }
    13%,
    100% {
        translate: var(--season-to) 0;
        opacity: 0;
    }
}

// Ghosts: float up the whole time, slowly.
.season-ghost {
    animation: season-rise var(--season-dur) linear var(--season-delay) infinite backwards;
}

.season-ghost .season-glyph {
    animation: season-bob var(--season-wobble) ease-in-out infinite alternate;
}

@keyframes season-rise {
    0% {
        transform: translate3d(0, 105vh, 0);
        opacity: 0;
    }
    10%,
    90% {
        opacity: 0.85;
    }
    100% {
        transform: translate3d(0, -10vh, 0);
        opacity: 0;
    }
}

// Pumpkin: rare. It waits a long while, then rolls along the lower screen.
.season-pumpkin {
    animation: season-cross var(--season-dur) linear var(--season-delay) infinite backwards;
}

.season-glyph {
    display: block;
    font-size: var(--season-size);
    line-height: 1;
}

@keyframes season-bob {
    from {
        transform: translate3d(0, -6px, 0) rotate(-8deg);
    }
    to {
        transform: translate3d(0, 6px, 0) rotate(8deg);
    }
}
</style>
