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
            :class="[`season-${p.kind}`, { 'is-ground': p.ground }]"
            :style="varsOf(p)"
        >
            <span
                v-for="(g, j) in p.group"
                :key="j"
                class="season-glyph"
                :style="glyphVars(p, j)"
            >{{ g }}</span>
        </span>
    </div>
</template>

<script setup lang="ts">
// @libraries
import { useDocumentVisibility, useMediaQuery } from "@vueuse/core";
import { computed } from "vue";

// @utils
import { crossing, particlesFor, type Particle } from "@/utils/seasonParticles";
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
    const { from, to } = crossing(p);
    return {
        "--season-left": `${p.left}%`,
        "--season-top": `${p.top}%`,
        "--season-size": `${p.size}px`,
        "--season-dur": `${p.duration}s`,
        "--season-delay": `${p.delay}s`,
        "--season-drift": `${p.drift}px`,
        "--season-wobble": `${p.wobble}s`,
        // Off the left edge to off the right edge, or the other way round (utils/seasonParticles.ts::crossing).
        "--season-from": from,
        "--season-to": to,
        // The ground lane: rem above the player bar. The spider: how far it lets itself down.
        "--season-lift": `${p.lift}rem`,
        "--season-drop": `${p.drop}vh`,
        // The chase's cluster: its box, in glyph sizes (utils/seasonParticles.ts, chaseHorde).
        "--season-w": String(p.extent.w),
        "--season-h": String(p.extent.h),
    };
}

/**
 * One glyph's variables. Every glyph gets its index and the group's length (the
 * bob's stagger). A cluster glyph also gets its own offset from the runner, and a
 * z-index: the runner (index 0) is in front, the zombies behind it, the front row
 * over the rows behind.
 */
function glyphVars(p: Particle, j: number): Record<string, string> {
    const vars: Record<string, string> = { "--season-i": String(j), "--season-n": String(p.group.length) };
    const at = p.offsets[j];
    if (at) {
        vars["--season-gx"] = String(at.x);
        vars["--season-gy"] = String(at.y);
        vars["z-index"] = j === 0 ? "200" : String(Math.round(100 + at.y * 10));
    }
    return vars;
}
</script>

<style lang="scss">
// ============================================================================
// SEASONAL PARTICLES: snow at Christmas, and now and then a sleigh (two reindeer,
// the sled and Santa, right to left across the upper sky); at Halloween bats, ghosts,
// a pumpkin, a chase (a runner and a horde of zombies, right to left) and a spider on its thread.
// Mounted once in App.vue, shown only while a season is active
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

// The ground lane (the pumpkin, the chase) stands on the player bar's top edge:
// `bottom` from the bar's own row height, per breakpoint (_variables.scss), so it
// clears the bar on every layout. The lift keeps the bob and the emoji's own
// line box above the bar's edge.
.season-particle.is-ground {
    top: auto;
    bottom: calc(#{$bottombarheight} + var(--season-lift, 0rem));

    @include allPhones {
        bottom: calc(#{$bottombarheight-phone} + var(--season-lift, 0rem));
    }

    @include shortViewport {
        bottom: calc(#{$bottombarheight-short} + var(--season-lift, 0rem));
    }
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
.season-sleigh .season-glyph {
    // The delay is the glyph's index times a quarter bob cycle, so the glyphs of a
    // group bob out of step. It sits IN the shorthand: the shorthand resets the
    // delay (styling.md), and a single glyph has index 0, i.e. no delay at all.
    animation: season-bob var(--season-wobble) ease-in-out calc(var(--season-i, 0) * var(--season-wobble) * -1 / 4) infinite alternate;
}

// The sleigh: its glyphs sit side by side in one row (reindeer first, see below).
.season-sleigh {
    display: flex;
    align-items: flex-end;
    gap: calc(var(--season-size) * 0.2);
}

// The chase: a horde, not a row. Each glyph stands at its own offset from the runner
// (utils/seasonParticles.ts, chaseHorde), in glyph sizes, and the group is exactly as
// big as the cluster, so the crossing (`crossing`, the group's own width) moves all of
// it off screen. The runner is the leftmost, in front; the zombies behind it.
.season-chase {
    width: calc(var(--season-size) * var(--season-w, 1));
    height: calc(var(--season-size) * var(--season-h, 1));
}

// The horde's bob runs once through the whole group: each glyph's stagger is its share
// of one bob cycle (the cycle is 2 × wobble, alternate), so the wave ripples from the
// runner back through the zombies. A quarter-wobble step per glyph wrapped round the
// cycle with eleven glyphs, and glyphs 0 and 8 bobbed in step.
.season-chase .season-glyph {
    position: absolute;
    left: calc(var(--season-gx, 0) * var(--season-size));
    bottom: calc(var(--season-gy, 0) * var(--season-size) * -1);
    animation: season-bob var(--season-wobble) ease-in-out calc(var(--season-i, 0) * var(--season-wobble) * -2 / var(--season-n, 1)) infinite alternate;
}

// The sleigh: the same row, reindeer first, so the reindeer lead right to left
// (utils/seasonParticles.ts, SLEIGH_GROUP). Its glyphs face left by default, unmirrored.

// The crossing takes 8 % of the cycle and the rest is waiting: the cycles are
// CROSSER_RARITY (1.5) times longer than the first cut's 12 %, so a crosser
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

// Pumpkin and chase: rare. They wait a long while, then roll or run along the
// ground lane above the player bar.
.season-pumpkin,
.season-chase,
.season-sleigh {
    animation: season-cross var(--season-dur) linear var(--season-delay) infinite backwards;
}

// The spider: its thread is a 1 px line in the theme's line colour, from the
// spider's body up past the top edge.
//
// ⚠️ The thread hangs on the GLYPH, not on the particle, and ends at the body's
// centre (`bottom: 50%`), behind the spider. It used to hang on the particle
// from the top of the glyph's box, and that left a visible gap of air: the
// glyph bobbed ±6 px and tilted ±8° under a thread that stayed put, and the
// spider is drawn a few px below the top of its em box anyway (user,
// 2026-10-31: "da geht der faden nicht bis zur spinne"). On the glyph, the
// thread moves with every bob. The spider bounces on its thread, straight up
// and down: a tilt would swing a 100vh-long thread through the whole sky.
.season-spider {
    animation: season-spider var(--season-dur) linear var(--season-delay) infinite backwards;
}

.season-spider .season-glyph {
    position: relative;
    animation: season-spider-bob var(--season-wobble) ease-in-out infinite alternate;
}

.season-spider .season-glyph::before {
    content: '';
    position: absolute;
    left: 50%;
    bottom: 50%;
    width: 1px;
    height: 100vh;
    background: var(--mem-line);
    // Behind the spider's body: the glyph is its own stacking context (it is
    // animated with a transform), so -1 stays inside it, above the page.
    z-index: -1;
}

@keyframes season-spider-bob {
    from {
        transform: translate3d(0, -4px, 0);
    }
    to {
        transform: translate3d(0, 4px, 0);
    }
}

// One cycle, rare: the spider is hidden (above the top edge, thread and all) for
// most of it. It lets itself down in the first 4 %, hangs for 5 % (the glyph's
// bob sways it), climbs back up over the next 4 %, and is gone.
@keyframes season-spider {
    0%,
    100% {
        translate: 0 -6rem;
        animation-timing-function: ease-in-out;
    }
    4% {
        translate: 0 var(--season-drop);
        animation-timing-function: ease-in-out;
    }
    9% {
        translate: 0 var(--season-drop);
        animation-timing-function: ease-in-out;
    }
    13% {
        translate: 0 -6rem;
    }
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
