<template>
    <div v-if="flight" :key="flight.id" class="sat-flyby" :style="vars" aria-hidden="true">
        <span class="sat-static"></span>
        <span v-for="i in WAVES" :key="i" class="sat-wave" :style="{ '--sat-i': i - 1 }"></span>
        <span class="sat-path">
            <span class="sat-craft"></span>
        </span>
    </div>
</template>

<script setup lang="ts">
// The satellite easter egg (#544), drawn once for the whole app. Launched by
// the desktop logo or the phone icon (composables/useLogoSatellite.ts): radio
// waves ring out of the planet, the screen flickers like an old TV for a
// moment, and the satellite flies off the planet and out past the right edge,
// sending its own pulses as it goes. Never under reduced motion: the
// composable does not launch then, and the stylesheet hides the layer too.
import { computed } from 'vue'

import { FLIGHT_MS, useSatelliteFlight } from '@/composables/useLogoSatellite'

const WAVES = 3
/** One wave from the planet; the next starts this much later. */
const WAVE_MS = 1200
const WAVE_GAP_MS = 300
/** The burst of static at the start. */
const STATIC_MS = 600

const flight = useSatelliteFlight()

// Every duration comes in through a custom property: one source of truth in
// the script, and no literals for motionScale.test.ts to chase.
const vars = computed(() => ({
    '--sat-x': `${flight.value?.x ?? 0}px`,
    '--sat-y': `${flight.value?.y ?? 0}px`,
    '--sat-flight': `${FLIGHT_MS}ms`,
    '--sat-wave': `${WAVE_MS}ms`,
    '--sat-wave-gap': `${WAVE_GAP_MS}ms`,
    '--sat-static': `${STATIC_MS}ms`,
}))
</script>

<style lang="scss">
// Above the menus (1000) and below the toast (Notification.vue, 1003), which
// says "Signal received" while this flies. Pointer events off: nothing here
// may block a click.
.sat-flyby {
    position: fixed;
    inset: 0;
    z-index: 1002;
    overflow: hidden;
    pointer-events: none;
}

// The old-TV moment: scanlines over grey noise, flickering, then gone.
.sat-static {
    position: absolute;
    inset: 0;
    opacity: 0;
    background:
        repeating-linear-gradient(0deg, rgb(0 0 0 / 0.28) 0 1px, transparent 1px 3px),
        url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="100%" height="100%" filter="url(%23n)"/></svg>');
    mix-blend-mode: hard-light;
    animation: sat-static var(--sat-static) steps(6) forwards;
}

@keyframes sat-static {
    0% {
        opacity: 0.8;
        background-position: 0 0, 0 0;
    }
    35% {
        opacity: 0.35;
        background-position: 0 2px, 40px -30px;
    }
    55% {
        opacity: 0.7;
        background-position: 0 1px, -60px 20px;
    }
    100% {
        opacity: 0;
        background-position: 0 3px, 20px 70px;
    }
}

// Radio waves out of the planet: hard ink rings, growing and fading. Ink, not
// an accent: a pale accent ring vanished on the light paper.
.sat-wave {
    position: absolute;
    top: var(--sat-y);
    left: var(--sat-x);
    width: 560px;
    height: 560px;
    margin: -280px 0 0 -280px;
    border: $candy-border-w solid $mem-line;
    border-radius: 50%;
    opacity: 0;
    transform: scale(0.1);
    animation: sat-wave var(--sat-wave) ease-out calc(var(--sat-i) * var(--sat-wave-gap)) forwards;
}

@keyframes sat-wave {
    0% {
        opacity: 1;
        transform: scale(0.1);
    }
    60% {
        opacity: 0.7;
    }
    100% {
        opacity: 0;
        transform: scale(1);
    }
}

// The flight: off the planet, slowly at first, then out past the right edge
// and a little down the page. `translate` carries the path, so the craft's own
// wobble below can use `transform` on the inner element.
.sat-path {
    position: absolute;
    top: 0;
    left: 0;
    translate: var(--sat-x) var(--sat-y);
    animation: sat-flight var(--sat-flight) cubic-bezier(0.5, 0, 0.75, 0.6) forwards;

    // The craft sends pulses as it goes.
    &::before {
        content: '';
        position: absolute;
        top: -24px;
        left: -24px;
        width: 48px;
        height: 48px;
        border: $mem-ring-w solid $mem-line;
        border-radius: 50%;
        animation: sat-pulse calc(var(--sat-wave) / 2) ease-out infinite;
    }
}

@keyframes sat-flight {
    0% {
        translate: var(--sat-x) var(--sat-y);
        opacity: 0;
    }
    6% {
        opacity: 1;
    }
    100% {
        translate: calc(100vw + 80px) calc(var(--sat-y) + 30vh);
        opacity: 1;
    }
}

@keyframes sat-pulse {
    0% {
        opacity: 0.8;
        transform: scale(0.3);
    }
    100% {
        opacity: 0;
        transform: scale(1.4);
    }
}

// The pixel satellite: body, antenna with a red tip, two solar panels.
.sat-craft {
    position: absolute;
    top: -20px;
    left: -40px;
    width: 80px;
    height: 40px;
    background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 12" shape-rendering="crispEdges"><rect x="0" y="3" width="8" height="6" fill="%2317171A"/><rect x="1" y="4" width="6" height="4" fill="%232E6FD8"/><rect x="4" y="4" width="1" height="4" fill="%2317171A"/><rect x="16" y="3" width="8" height="6" fill="%2317171A"/><rect x="17" y="4" width="6" height="4" fill="%232E6FD8"/><rect x="19" y="4" width="1" height="4" fill="%2317171A"/><rect x="8" y="5" width="1" height="2" fill="%2317171A"/><rect x="15" y="5" width="1" height="2" fill="%2317171A"/><rect x="9" y="3" width="6" height="7" fill="%2317171A"/><rect x="10" y="4" width="4" height="5" fill="%23D9D9D9"/><rect x="11" y="5" width="2" height="2" fill="%23F5C542"/><rect x="11" y="1" width="2" height="2" fill="%2317171A"/></svg>') center / contain no-repeat;
    filter: drop-shadow(0 0 3px rgb(0 0 0 / 0.45));
    animation: sat-wobble calc(var(--sat-flight) / 4) ease-in-out infinite alternate;

    // The antenna tip blinks: one red pixel, on and off.
    &::after {
        content: '';
        position: absolute;
        top: 0;
        left: 50%;
        width: calc(100% / 24);
        height: calc(100% / 12);
        background: $mem-coral;
        animation: sat-blink calc(var(--sat-wave) / 3) steps(1) infinite;
    }
}

@keyframes sat-wobble {
    from {
        transform: rotate(-8deg);
    }
    to {
        transform: rotate(6deg);
    }
}

@keyframes sat-blink {
    50% {
        opacity: 0;
    }
}

@media (prefers-reduced-motion: reduce) {
    .sat-flyby {
        display: none;
    }
}
</style>
