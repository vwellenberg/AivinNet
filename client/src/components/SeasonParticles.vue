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
            <span
                v-for="(g, j) in p.group"
                :key="j"
                class="season-glyph"
                :style="{ '--season-i': String(j) }"
            >{{ g }}</span>
            <span v-if="p.kind === 'frankenstein'" class="season-glyph season-monster-face"></span>
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
// SEASONAL PARTICLES: snow at Christmas, bats, ghosts, a pumpkin, a vampire, a
// chase (a runner and two zombies) and Frankenstein's monster at Halloween. Mounted once in App.vue,
// shown only while a season is active (utils/seasons.ts) and never under
// "reduce motion" (the component above).
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

// Bats: fly across the screen now and then, right to left, flutter in place as they go.
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
.season-pumpkin .season-glyph,
.season-vampire .season-glyph,
.season-chase .season-glyph,
.season-frankenstein .season-glyph {
    // The delay is the glyph's index times a quarter bob cycle, so the glyphs of a
    // group bob out of step. It sits IN the shorthand: the shorthand resets the
    // delay (styling.md), and a single glyph has index 0, i.e. no delay at all.
    animation: season-bob var(--season-wobble) ease-in-out calc(var(--season-i, 0) * var(--season-wobble) * -1 / 4) infinite alternate;
}

// The chase: its glyphs sit side by side in one row, the runner in front (the
// first span of the group, the leftmost), the zombies a gap behind it.
.season-chase {
    display: flex;
    align-items: flex-end;
    gap: calc(var(--season-size) * 0.2);
}

// The 🏃 emoji faces right; the runner goes left, so it is turned to face its
// way of travel. `scale` is its own property, so the bob's transform keeps working.
.season-chase .season-glyph:first-child {
    scale: -1 1;
}

// The crossing takes 8 % of the cycle and the rest is waiting: the cycles are
// HALLOWEEN_RARITY (1.5) times longer than the first cut's 12 %, so a crosser
// is as fast as before and only comes by less often (utils/seasonParticles.ts).
@keyframes season-cross {
    0% {
        translate: var(--season-from) 0;
        opacity: 0;
    }
    1.3% {
        opacity: 1;
    }
    8% {
        translate: var(--season-to) 0;
        opacity: 1;
    }
    8.7%,
    100% {
        translate: var(--season-to) 0;
        opacity: 0;
    }
}

// Ghosts: float up slowly, then stay away for a while.
.season-ghost {
    animation: season-rise var(--season-dur) linear var(--season-delay) infinite backwards;
}

.season-ghost .season-glyph {
    animation: season-bob var(--season-wobble) ease-in-out infinite alternate;
}

// The rise takes the first half of the cycle, then the ghost stays away for
// as long again (the cycle is twice the old one, so it rises as slowly).
@keyframes season-rise {
    0% {
        transform: translate3d(0, 105vh, 0);
        opacity: 0;
    }
    5%,
    45% {
        opacity: 0.85;
    }
    50%,
    100% {
        transform: translate3d(0, -10vh, 0);
        opacity: 0;
    }
}

// Pumpkin: rare. It waits a long while, then rolls along the lower screen.
// The vampire swoops like a bat; the chase and the monster shamble along the bottom.
.season-pumpkin,
.season-vampire,
.season-chase,
.season-frankenstein {
    animation: season-cross var(--season-dur) linear var(--season-delay) infinite backwards;
}

.season-glyph {
    display: block;
    font-size: var(--season-size);
    line-height: 1;
}

// Frankenstein's monster has no emoji: a pixel head, flat black hair, bolts.
.season-monster-face {
    width: var(--season-size);
    height: var(--season-size);
    background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 15" shape-rendering="crispEdges"><rect x="2" y="2" width="10" height="11" fill="%237FB069"/><rect x="2" y="0" width="10" height="3" fill="%2317171A"/><rect x="2" y="3" width="1" height="1" fill="%2317171A"/><rect x="5" y="3" width="1" height="1" fill="%2317171A"/><rect x="8" y="3" width="1" height="1" fill="%2317171A"/><rect x="11" y="3" width="1" height="1" fill="%2317171A"/><rect x="4" y="5" width="6" height="1" fill="%23C8E0B4"/><rect x="5" y="4" width="1" height="3" fill="%2317171A" opacity=".55"/><rect x="7" y="4" width="1" height="3" fill="%2317171A" opacity=".55"/><rect x="3" y="7" width="3" height="1" fill="%2317171A"/><rect x="8" y="7" width="3" height="1" fill="%2317171A"/><rect x="4" y="8" width="1" height="1" fill="%23FFFFFF"/><rect x="9" y="8" width="1" height="1" fill="%23FFFFFF"/><rect x="4" y="11" width="6" height="1" fill="%2317171A"/><rect x="5" y="10" width="1" height="3" fill="%2317171A"/><rect x="8" y="10" width="1" height="3" fill="%2317171A"/><rect x="0" y="10" width="2" height="2" fill="%239AA0A6"/><rect x="12" y="10" width="2" height="2" fill="%239AA0A6"/><rect x="4" y="13" width="6" height="2" fill="%235E8B4A"/></svg>') center / contain no-repeat;
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
