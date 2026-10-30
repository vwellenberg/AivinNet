<template>
    <div v-if="burst" :key="burst.id" class="sig-burst" :style="vars" aria-hidden="true">
        <span
            v-for="i in WAVES"
            :key="`w${i}`"
            class="sig-wave"
            :class="{ 'is-dashed': i % 2 === 0 }"
            :style="{ '--sig-i': i - 1 }"
        ></span>
        <svg class="sig-trace" :viewBox="`0 0 ${trace.width} ${TRACE_H}`" :width="trace.width" :height="TRACE_H">
            <path class="sig-trace-under" :d="trace.d" pathLength="1" />
            <path class="sig-trace-line" :d="trace.d" pathLength="1" />
        </svg>
        <span class="sig-static"></span>
        <span class="sig-roll"></span>
        <span v-for="(tear, i) in tears" :key="`t${i}`" class="sig-tear" :style="tear"></span>
        <span class="sig-flash"></span>
    </div>
</template>

<script setup lang="ts">
// The signal easter egg (#544), drawn once for the whole app. Launched by the
// desktop logo or the phone icon (composables/useLogoSignal.ts):
//
//   1. radio waves ring out of the planet, ink and dashed accent in turn, far
//      enough to cross the whole screen;
//   2. a signal trace runs from the planet to the right edge;
//   3. the picture goes: static with scanlines, a rolling bar, torn bands;
//   4. and comes back with the flash of an old tube switching on.
//
// Never under reduced motion: the composable does not launch then, and the
// stylesheet hides the layer too.
import { computed } from 'vue'

import { BURST_MS, useSignalBurst } from '@/composables/useLogoSignal'

const WAVES = 5
const WAVE_MS = 1600
const WAVE_GAP_MS = 180
const TRACE_MS = 1500
const STATIC_MS = 950
const STATIC_DELAY_MS = 120
const FLASH_MS = 320
/** The trace's box: tall enough for the widest swing plus its ink edge. */
const TRACE_H = 64

const burst = useSignalBurst()

function viewport() {
    return { w: window.innerWidth || 1024, h: window.innerHeight || 768 }
}

/** The diameter a wave needs to leave the screen at its farthest corner. */
function reach(x: number, y: number): number {
    const { w, h } = viewport()
    return Math.ceil(2 * Math.hypot(Math.max(x, w - x), Math.max(y, h - y)))
}

/**
 * A sine from the planet to the right edge: it swells out of the planet and
 * dies away towards the edge, like a signal fading with distance.
 */
const trace = computed(() => {
    const x = burst.value?.x ?? 0
    const width = Math.max(60, viewport().w - x)
    const mid = TRACE_H / 2
    const wavelength = 34
    const points: string[] = []
    for (let px = 0; px <= width; px += 2) {
        const t = px / width
        const envelope = Math.min(1, t * 8) * (1 - t) * 22
        const y = mid + Math.sin((px / wavelength) * 2 * Math.PI) * envelope
        points.push(`${px.toFixed(0)},${y.toFixed(1)}`)
    }
    return { width, d: `M${points.join('L')}` }
})

/** Three torn bands at random heights, rolled once per burst. */
const tears = computed(() => {
    if (!burst.value) return []
    return [0, 1, 2].map(i => ({
        '--sig-tear-top': `${Math.round(10 + Math.random() * 75)}%`,
        '--sig-tear-h': `${Math.round(6 + Math.random() * 30)}px`,
        '--sig-tear-i': i,
    }))
})

// Every duration comes in through a custom property: one source of truth in
// the script, and no literals for motionScale.test.ts to chase.
const vars = computed(() => {
    const x = burst.value?.x ?? 0
    const y = burst.value?.y ?? 0
    return {
        '--sig-x': `${x}px`,
        '--sig-y': `${y}px`,
        '--sig-reach': `${reach(x, y)}px`,
        '--sig-burst': `${BURST_MS}ms`,
        '--sig-wave': `${WAVE_MS}ms`,
        '--sig-wave-gap': `${WAVE_GAP_MS}ms`,
        '--sig-trace': `${TRACE_MS}ms`,
        '--sig-trace-h': `${TRACE_H}px`,
        '--sig-static': `${STATIC_MS}ms`,
        '--sig-static-delay': `${STATIC_DELAY_MS}ms`,
        '--sig-flash': `${FLASH_MS}ms`,
    }
})
</script>

<style lang="scss">
// Above the menus (1000) and below the toast (Notification.vue, 1003), which
// says "Signal received" meanwhile. Pointer events off: nothing here may block
// a click.
.sig-burst {
    position: fixed;
    inset: 0;
    z-index: 1002;
    overflow: hidden;
    pointer-events: none;
}

// 1. Radio waves: rings out of the planet, big enough to leave the screen.
.sig-wave {
    position: absolute;
    top: var(--sig-y);
    left: var(--sig-x);
    width: var(--sig-reach);
    height: var(--sig-reach);
    translate: -50% -50%;
    border: $candy-border-w solid $mem-line;
    border-radius: 50%;
    opacity: 0;
    scale: 0.02;
    animation: sig-wave var(--sig-wave) cubic-bezier(0.2, 0.6, 0.3, 1) calc(var(--sig-i) * var(--sig-wave-gap))
        forwards;

    // Every other wave is the accent, dashed: one reads as the signal, the
    // other as its echo.
    &.is-dashed {
        border: calc(#{$candy-border-w} * 2) dashed $mem-teal;
    }
}

@keyframes sig-wave {
    0% {
        opacity: 1;
        scale: 0.02;
    }
    55% {
        opacity: 0.8;
    }
    100% {
        opacity: 0;
        scale: 1;
    }
}

// 2. The trace: drawn from the planet outwards, then it fades.
.sig-trace {
    position: absolute;
    top: calc(var(--sig-y) - var(--sig-trace-h) / 2);
    left: var(--sig-x);
    overflow: visible;
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
    animation: sig-trace-fade var(--sig-trace) linear forwards;

    path {
        stroke-dasharray: 1;
        stroke-dashoffset: 1;
        animation: sig-trace-draw calc(var(--sig-trace) / 2) cubic-bezier(0.3, 0, 0.2, 1) forwards;
    }

    .sig-trace-under {
        stroke: $mem-line;
        stroke-width: 7;
    }

    .sig-trace-line {
        stroke: $mem-teal;
        stroke-width: 3;
    }
}

@keyframes sig-trace-draw {
    to {
        stroke-dashoffset: 0;
    }
}

@keyframes sig-trace-fade {
    0%,
    65% {
        opacity: 1;
    }
    100% {
        opacity: 0;
    }
}

// 3. The picture goes: grey noise under scanlines, flickering in steps, with a
// dark rim like a curved screen.
.sig-static {
    position: absolute;
    inset: 0;
    opacity: 0;
    background:
        radial-gradient(ellipse at center, transparent 55%, rgb(0 0 0 / 0.45) 100%),
        repeating-linear-gradient(0deg, rgb(0 0 0 / 0.32) 0 1px, transparent 1px 3px),
        url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="100%" height="100%" filter="url(%23n)"/></svg>');
    mix-blend-mode: hard-light;
    animation: sig-static var(--sig-static) steps(10) var(--sig-static-delay) forwards;
}

@keyframes sig-static {
    0% {
        opacity: 0.9;
        background-position: 0 0, 0 0, 0 0;
    }
    20% {
        opacity: 0.55;
        background-position: 0 0, 0 1px, 60px -40px;
    }
    40% {
        opacity: 0.85;
        background-position: 0 0, 0 2px, -80px 30px;
    }
    70% {
        opacity: 0.4;
        background-position: 0 0, 0 1px, 30px 90px;
    }
    100% {
        opacity: 0;
        background-position: 0 0, 0 3px, -40px -70px;
    }
}

// The bright bar of a picture that has lost its hold, rolling down twice.
.sig-roll {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    height: 22vh;
    opacity: 0;
    background: linear-gradient(
        180deg,
        transparent,
        rgb(255 255 255 / 0.28) 45%,
        rgb(255 255 255 / 0.4) 50%,
        rgb(255 255 255 / 0.28) 55%,
        transparent
    );
    animation: sig-roll calc(var(--sig-static) / 2) linear var(--sig-static-delay) 2;
}

@keyframes sig-roll {
    0% {
        opacity: 1;
        translate: 0 -22vh;
    }
    100% {
        opacity: 1;
        translate: 0 100vh;
    }
}

// Torn bands: strips of the picture whose colour slips, on and off.
.sig-tear {
    position: absolute;
    left: 0;
    right: 0;
    top: var(--sig-tear-top);
    height: var(--sig-tear-h);
    opacity: 0;
    backdrop-filter: hue-rotate(170deg) saturate(2.4) contrast(1.2);
    animation: sig-tear calc(var(--sig-static) / 2) steps(1)
        calc(var(--sig-static-delay) + var(--sig-tear-i) * var(--sig-static) / 8) forwards;
}

@keyframes sig-tear {
    0%,
    30%,
    60% {
        opacity: 1;
        translate: 0 0;
    }
    15%,
    45% {
        opacity: 0;
    }
    50% {
        translate: 0 14px;
    }
    100% {
        opacity: 0;
    }
}

// 4. The picture comes back: the bright line of a tube switching on, opening
// from the middle and closing again.
.sig-flash {
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: 3px;
    margin-top: -1.5px;
    opacity: 0;
    background: #fff;
    box-shadow:
        0 0 12px 3px rgb(255 255 255 / 0.8),
        0 0 40px 8px $mem-teal;
    animation: sig-flash var(--sig-flash) ease-out calc(var(--sig-static-delay) + var(--sig-static)) forwards;
}

@keyframes sig-flash {
    0% {
        opacity: 1;
        scale: 0 1;
    }
    40% {
        opacity: 1;
        scale: 1 1;
    }
    100% {
        opacity: 0;
        scale: 1 0.2;
    }
}

@media (prefers-reduced-motion: reduce) {
    .sig-burst {
        display: none;
    }
}
</style>
