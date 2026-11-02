<template>
    <div
        v-if="season && !lessMotion"
        class="season-particles"
        :class="{ 'is-paused': visibility === 'hidden' }"
        :style="layerVars"
        aria-hidden="true"
    >
        <span
            v-for="(p, i) in particles"
            :key="i"
            class="season-particle"
            :class="[`season-${p.kind}`, { 'is-ground': p.ground, 'is-hanger': hangs(p) }]"
            :style="varsOf(p)"
        >
            <span
                v-for="(g, j) in p.group"
                :key="j"
                class="season-glyph"
                :style="glyphVars(p, j)"
            >{{ g }}</span>
            <!-- New Year's rocket: its head (the trail hangs below it in CSS), then the sparks of its burst. -->
            <span v-if="p.kind === 'rocket'" class="season-rocket-head" />
            <span
                v-for="(s, k) in p.sparks"
                :key="k"
                class="season-spark"
                :style="sparkVars(s)"
            />
        </span>
        <!-- The snow on the player bar's top edge (Christmas). Keyed by the page change, so each one clears it. -->
        <span
            v-if="season === 'christmas'"
            :key="navigation"
            class="season-drift"
            :style="{ '--season-drift-dur': `${DRIFT_SETTLE_S}s` }"
        />
    </div>
</template>

<script setup lang="ts">
// @libraries
import { useDocumentVisibility, useEventListener, useMediaQuery, useResizeObserver } from "@vueuse/core";
import { computed, onMounted, ref } from "vue";

// @utils
import { crossing, DRIFT_SETTLE_S, hangs, particlesFor, type Particle, type Ribbon, type Spark } from "@/utils/seasonParticles";
import type { Season } from "@/utils/seasons";

// `navigation` counts the page changes (App.vue): a change re-keys the snow drift, so it starts over.
const props = withDefaults(defineProps<{ season: Season | null; navigation?: number }>(), { navigation: 0 });

// A hanger's thread colour, as theme tokens (`--season-ribbon`, the hanger rules below).
const RIBBON: Record<Ribbon, string> = { line: "var(--mem-line)", gold: "var(--mem-gold)", red: "var(--mem-coral)" };

// The OS "reduce motion" setting: the same query confetti.ts and coverMorph.ts
// read. The app has no motion setting of its own, so this is the whole rule.
// Under it nothing is drawn at all; a few drifting dots would only be motion
// nobody asked for.
const lessMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
// A hidden tab stops its particles (the class below), not just its frames.
const visibility = useDocumentVisibility();

// Where the player bar really starts, in px from the bottom of the window. The
// `$bottombarheight*` tokens are the bar's nominal height, but on a phone the bar
// also carries the navigation row and the home-indicator inset (measured 167 px
// against a 152 px token at 390 × 844), so the snow drift sat behind the bar.
// Unset until measured: the CSS falls back to the token.
const barHeight = ref<number | null>(null);
const bar = ref<HTMLElement | null>(null);

function measureBar(): void {
    const el = bar.value;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    barHeight.value = top > 0 ? Math.max(0, window.innerHeight - top) : null;
}

onMounted(() => {
    bar.value = document.querySelector<HTMLElement>(".b-bar");
    measureBar();
});
useResizeObserver(bar, measureBar);
useEventListener(window, "resize", measureBar, { passive: true });

const layerVars = computed<Record<string, string>>(() => {
    const vars: Record<string, string> = {};
    if (barHeight.value !== null) vars["--season-bar-h"] = `${barHeight.value}px`;
    return vars;
});

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
        // The ground lane: rem above the player bar. The hangers: how far they let themselves down, and their thread.
        "--season-lift": `${p.lift}rem`,
        "--season-drop": `${p.drop}vh`,
        "--season-ribbon": RIBBON[p.ribbon],
        // The chase's cluster: its box, in glyph sizes (utils/seasonParticles.ts, chaseHorde).
        "--season-w": String(p.extent.w),
        "--season-h": String(p.extent.h),
    };
}

/** One spark's variables: where it flies, how far, how big, its colour and its sag (utils/seasonParticles.ts, sparkBurst). */
function sparkVars(s: Spark): Record<string, string> {
    return {
        "--spark-angle": `${s.angle}deg`,
        "--spark-dist": `${s.dist}px`,
        "--spark-size": `${s.size}px`,
        "--spark-colour": s.colour,
        "--spark-sag": `${s.sag}px`,
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
// the sled and Santa, right to left across the upper sky), a bell on a ribbon, a present
// tumbling along the ground and a waddle of penguins (right to left); at Halloween bats,
// ghosts, a pumpkin, a chase (a runner and a horde of zombies, right to left) and a
// spider on its thread. The bell and the spider share one hanger mechanic.
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
.season-particles.is-paused .season-glyph,
.season-particles.is-paused .season-rocket-head,
.season-particles.is-paused .season-spark {
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
// The waddle is a cluster the same way (waddleGroup): the same box and offsets.
.season-chase,
.season-waddle {
    width: calc(var(--season-size) * var(--season-w, 1));
    height: calc(var(--season-size) * var(--season-h, 1));
}

// The horde's bob runs once through the whole group: each glyph's stagger is its share
// of one bob cycle (the cycle is 2 × wobble, alternate), so the wave ripples from the
// runner back through the zombies. A quarter-wobble step per glyph wrapped round the
// cycle with eleven glyphs, and glyphs 0 and 8 bobbed in step.
.season-chase .season-glyph,
.season-waddle .season-glyph {
    position: absolute;
    left: calc(var(--season-gx, 0) * var(--season-size));
    bottom: calc(var(--season-gy, 0) * var(--season-size) * -1);
    animation: season-bob var(--season-wobble) ease-in-out calc(var(--season-i, 0) * var(--season-wobble) * -2 / var(--season-n, 1)) infinite alternate;
}

// The runner, a third bigger: 🏃 is a whole small figure in its em box while 🧟 is
// a bust that fills it, so at the same font size the runner looked like a child in
// front of the horde (measured in the headless preview, 2026-10-31).
.season-chase .season-glyph:first-child {
    font-size: calc(var(--season-size) * 1.3);
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

// Pumpkin, chase, present, waddle and sleigh: rare. They wait a long while, then roll,
// run, waddle or fly across.
.season-pumpkin,
.season-chase,
.season-present,
.season-waddle,
.season-sleigh {
    animation: season-cross var(--season-dur) linear var(--season-delay) infinite backwards;
}

// The present tumbles: one full turn per wobble, in place, while the crossing carries it
// along the ground lane (the pumpkin's rhythm, and its lift). Linear, so it reads as a
// tumble and not as a bob.
.season-present .season-glyph {
    animation: season-tumble var(--season-wobble) linear infinite;
}

@keyframes season-tumble {
    from {
        transform: rotate(0deg);
    }
    to {
        transform: rotate(360deg);
    }
}

// The hangers: the spider and the bell. Each is let down on a thread from the top edge
// (`is-hanger`, utils/seasonParticles.ts, hangs): the thread is a 1 px line from the
// glyph up past the top edge, in the particle's ribbon colour (`--season-ribbon`: the
// theme's line colour for the spider, gold or red for the bell).
//
// ⚠️ The thread hangs on the GLYPH, not on the particle, and ends at the body's
// centre (`bottom: 50%`), behind the glyph. It used to hang on the particle
// from the top of the glyph's box, and that left a visible gap of air: the
// glyph bobbed ±6 px and tilted ±8° under a thread that stayed put, and the
// spider is drawn a few px below the top of its em box anyway (user,
// 2026-10-31: "da geht der faden nicht bis zur spinne"). On the glyph, the
// thread moves with every bob. A hanger bounces on its thread, straight up
// and down: a tilt would swing a 100vh-long thread through the whole sky.
.season-particle.is-hanger {
    animation: season-hang var(--season-dur) linear var(--season-delay) infinite backwards;
}

.season-particle.is-hanger .season-glyph {
    position: relative;
    animation: season-hang-bob var(--season-wobble) ease-in-out infinite alternate;
}

.season-particle.is-hanger .season-glyph::before {
    content: '';
    position: absolute;
    left: 50%;
    bottom: 50%;
    width: 1px;
    height: 100vh;
    background: var(--season-ribbon, var(--mem-line));
    // Behind the glyph's body: the glyph is its own stacking context (it is
    // animated with a transform), so -1 stays inside it, above the page.
    z-index: -1;
}

@keyframes season-hang-bob {
    from {
        transform: translate3d(0, -4px, 0);
    }
    to {
        transform: translate3d(0, 4px, 0);
    }
}

// One cycle, rare: the hanger is hidden (above the top edge, thread and all) for
// most of it. It lets itself down in the first 4 %, hangs for 5 % (the glyph's
// bob sways it), climbs back up over the next 4 %, and is gone.
@keyframes season-hang {
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

// The shooting star: across the upper sky, always right to left, with a short gold trail
// streaming behind it. The trail is the glyph's `::before`, on its right, because the star
// flies left. It crosses in the first 1.2 % of its cycle (about two seconds), then is gone.
.season-star {
    animation: season-shoot var(--season-dur) linear var(--season-delay) infinite backwards;
}

.season-star .season-glyph {
    position: relative;
}

.season-star .season-glyph::before {
    content: '';
    position: absolute;
    left: 100%;
    top: 50%;
    width: 5em;
    height: 2px;
    margin-top: -1px;
    border-radius: 2px;
    background: linear-gradient(to right, var(--mem-gold), transparent);
}

@keyframes season-shoot {
    0% {
        translate: var(--season-from) 0;
        opacity: 0;
    }
    0.4% {
        opacity: 1;
    }
    1.2% {
        translate: var(--season-to) 0;
        opacity: 1;
    }
    1.3%,
    100% {
        translate: var(--season-to) 0;
        opacity: 0;
    }
}

// The snow on the player bar's top edge (Christmas): a drift of soft humps that settles in
// over a few minutes (--season-drift-dur, DRIFT_SETTLE_S). It sits in the fixed layer below
// the bar (z-index 40, the bar is 50), so the bar covers its foot and nothing reflows. Each
// page change re-keys it, so it starts over. Under "reduce motion" the layer is not drawn.
.season-drift {
    position: absolute;
    left: 0;
    right: 0;
    // On the bar's real top edge (`--season-bar-h`, measured in the script), 2 px of
    // its foot behind the bar; the token is only the fallback until it is measured.
    bottom: calc(var(--season-bar-h, #{$bottombarheight}) - 2px);
    height: 0.75rem;
    transform-origin: 50% 100%;
    // Explicit radii, not the nearest-side keyword: with the centre ON the bottom
    // edge the nearest side is 0 px away, the ellipse has no height and nothing is painted
    // (the first cut of this drift drew nothing at all).
    // Two rows of humps in different widths, offset, so the drift reads as snow
    // and not as a row of teeth.
    background:
        radial-gradient(ellipse 50% 100% at 50% 100%, #ffffff 92%, transparent) 0 100% / 3.2rem 70% repeat-x,
        radial-gradient(ellipse 50% 100% at 50% 100%, #ffffff 92%, transparent) 1.3rem 100% / 5.1rem 100% repeat-x;
    filter: drop-shadow(0 -1px 1px rgb(0 0 0 / 0.2));
    animation: season-drift-settle var(--season-drift-dur) ease-out both;

    @include allPhones {
        bottom: calc(var(--season-bar-h, #{$bottombarheight-phone}) - 2px);
    }

    @include shortViewport {
        bottom: calc(var(--season-bar-h, #{$bottombarheight-short}) - 2px);
    }
}

.season-particles.is-paused .season-drift {
    animation-play-state: paused;
}

@keyframes season-drift-settle {
    from {
        transform: scaleY(0);
    }
    to {
        transform: scaleY(1);
    }
}

.season-glyph {
    display: block;
    font-size: var(--season-size);
    line-height: 1;
}

// ----------------------------------------------------------------------------
// New Year's Eve (#674): the rockets and the sparkles.
//
// A rocket is a point on the ground lane (is-ground, above the player bar). Its
// particle climbs to the upper third of the screen; the head hangs on it, and at the
// top the head goes out and the sparks fly out from the same point. Every keyframe is
// a percentage of the cycle (--season-dur), and the timing is in those percentages,
// so no duration is written as a literal.
// ----------------------------------------------------------------------------

// The climb is 67 vh less the bar and the lift: from the bar's top edge up to a third
// of the way down from the top. The bar's height is per layout, as the ground lane's.
.season-rocket {
    --rocket-bar: #{$bottombarheight};
    --rocket-rise: calc(67vh - var(--rocket-bar) - var(--season-lift, 0rem));
    width: 0;
    height: 0;
    animation: season-rocket var(--season-dur) linear var(--season-delay) infinite backwards;

    @include allPhones {
        --rocket-bar: #{$bottombarheight-phone};
    }

    @include shortViewport {
        --rocket-bar: #{$bottombarheight-short};
    }
}

// The climb: the first 4.5 % of the cycle, quick at the start and easing in at the top.
@keyframes season-rocket {
    0% {
        translate: 0 0;
        animation-timing-function: ease-out;
    }
    4.5%,
    100% {
        translate: 0 calc(var(--rocket-rise) * -1);
    }
}

// The head: lit from the first moment of the climb to the burst, then out.
.season-rocket-head {
    position: absolute;
    left: -2px;
    bottom: 0;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: #FFFFFF;
    box-shadow: 0 0 6px 1px #F2B233;
    animation: season-rocket-head var(--season-dur) linear var(--season-delay) infinite backwards;

    // The trail, hanging below the head as it climbs.
    &::after {
        content: '';
        position: absolute;
        left: 1px;
        top: 100%;
        width: 2px;
        height: 2.5rem;
        background: linear-gradient(to bottom, rgb(242 178 51 / 0.85), rgb(242 178 51 / 0));
    }
}

@keyframes season-rocket-head {
    0% {
        opacity: 0;
    }
    0.5%,
    4.5% {
        opacity: 1;
    }
    4.6%,
    100% {
        opacity: 0;
    }
}

// A spark: from the burst point, out along its angle, sagging a little, and gone
// by 10.5 % of the cycle (about four seconds of burst on a 70 s cycle).
.season-spark {
    position: absolute;
    left: 0;
    top: 0;
    // A streak along its flight, not a dot: the element's x axis IS the flight
    // (rotate, then translateX), so a width three times the height draws the trail.
    width: calc(var(--spark-size, 6px) * 3);
    height: var(--spark-size, 6px);
    margin: calc(var(--spark-size, 6px) / -2) 0 0 calc(var(--spark-size, 6px) * -1.5);
    border-radius: $candy-radius-pill;
    background: linear-gradient(to right, transparent, var(--spark-colour, #FFFFFF) 70%, #FFFFFF);
    box-shadow: 0 0 10px 2px var(--spark-colour, #FFFFFF);
    animation: season-spark var(--season-dur) linear var(--season-delay) infinite backwards;
}

@keyframes season-spark {
    0%,
    4.5% {
        opacity: 0;
        transform: rotate(var(--spark-angle, 0deg)) translateX(0);
        translate: 0 0;
    }
    4.6% {
        opacity: 1;
        transform: rotate(var(--spark-angle, 0deg)) translateX(0);
        translate: 0 0;
        animation-timing-function: ease-out;
    }
    10.5% {
        opacity: 0;
        transform: rotate(var(--spark-angle, 0deg)) translateX(var(--spark-dist, 60px));
        translate: 0 var(--spark-sag, 12px);
    }
    100% {
        opacity: 0;
        transform: rotate(var(--spark-angle, 0deg)) translateX(var(--spark-dist, 60px));
        translate: 0 var(--spark-sag, 12px);
    }
}

// The sparkles: the snow's fall and sway, on a glyph.
.season-glitter {
    top: 0;
    animation: season-snow var(--season-dur) linear var(--season-delay) infinite backwards;
}

.season-glitter .season-glyph {
    opacity: 0.85;
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
