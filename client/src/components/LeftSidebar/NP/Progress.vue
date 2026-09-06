<template>
    <div
        ref="wrap"
        class="progress-wrap"
        :style="{ '--texture-frac': textureFrac }"
        @pointermove="onPointerMove"
        @pointerleave="onPointerLeave"
    >
        <input
            id="progress"
            ref="input"
            type="range"
            :value="displayValue"
            min="0"
            :max="time.full"
            step="0.1"
            :style="{
                background: progressBg,
            }"
            @input="onScrubInput"
            @change="seek"
            @click="seek"
        />

        <!-- Memphis sprinkle texture over the coloured part of the bar — the
             played teal fill plus, while hovering, the yellow seek span. An
             overlay div (the range input can't host pseudo-elements) whose
             width follows --texture-frac; fixed tile size, so the pattern never
             stretches. pointer-events off — seeks untouched. -->
        <div class="progress-fill-sprinkle" />

        <!--
            Spotify-style hover preview (#66): the seek span is painted as a
            background layer on the input itself (see progressBg), so the thumb
            keeps its ink ring on top of it. Only the time tooltip is an overlay.
            Mouse/pen only — touch is ignored (onPointerMove) and the tooltip is
            hidden on no-hover pointers (CSS), so mobile sees no stray preview.
        -->
        <div
            v-show="hover.active"
            class="progress-tooltip"
            :style="{ left: `${tooltipLeft}px`, top: `${hover.barTop}px` }"
        >
            {{ hoverLabel }}
        </div>
    </div>
</template>

<script setup lang="ts">
import { maxSeekPercent } from '@/stores/player'
import useQStore from '@/stores/queue'
import { formatSeconds } from '@/utils'
import { MEMPHIS } from '@/utils/colortools/pageGradient'
import { computed, reactive, ref } from 'vue'

const q = useQStore()

const { duration: time } = q

const wrap = ref<HTMLElement | null>(null)
const input = ref<HTMLInputElement | null>(null)

// Where the pointer is, plus the track's own box in pixels relative to the
// wrapper, so the overlays sit on the range track exactly regardless of the
// input's margins (which differ between the bottom bar and the Now-Playing
// header). Only measurements live here — the preview's own geometry is derived
// below, so it keeps up with the playhead while the pointer holds still.
const hover = reactive({
    active: false,
    ratio: 0,
    barLeft: 0,
    barTop: 0,
    barWidth: 0,
})

// Pointer X (px) -> clamped 0..1 ratio across the input's own width. Shared by
// the hover preview AND the click-to-seek so the tooltip, the fill and the
// actual seek target are always the same position. (A native range maps a
// click over a track inset by half the thumb, which would otherwise drift a
// few seconds from the tooltip off-centre — #66 wants tooltip == seek time.)
const ratioFromClientX = (clientX: number): number | null => {
    const el = input.value
    if (!el) return null
    const rect = el.getBoundingClientRect()
    if (rect.width === 0) return null
    const ratio = (clientX - rect.left) / rect.width
    return ratio < 0 ? 0 : ratio > 1 ? 1 : ratio
}

const onPointerMove = (e: PointerEvent) => {
    // Desktop pointers only; never show on touch (#66 acceptance: no stray
    // hover behaviour on mobile). Also skip when there is no track loaded.
    if (e.pointerType === 'touch' || !time.full) {
        hover.active = false
        return
    }

    const el = input.value
    const wrapEl = wrap.value
    const ratio = ratioFromClientX(e.clientX)
    if (!el || !wrapEl || ratio === null) {
        hover.active = false
        return
    }

    const inRect = el.getBoundingClientRect()
    const wrapRect = wrapEl.getBoundingClientRect()

    hover.ratio = ratio
    hover.barLeft = inRect.left - wrapRect.left
    hover.barTop = inRect.top - wrapRect.top
    hover.barWidth = inRect.width
    hover.active = true
}

const onPointerLeave = () => {
    hover.active = false
}

// While a scrub is in progress the bar shows the DRAGGED position, not the
// playhead. Two reasons, both of which made dragging on a touch screen feel
// broken: the bound `value` is re-rendered from `time.current` a few times a
// second, which yanks the knob back under the finger mid-drag; and the painted
// fill (drawn from the same store value) stayed behind while the knob moved.
const scrub = reactive({ active: false, value: 0 })

const displayValue = computed(() => (scrub.active ? scrub.value : time.current))

const onScrubInput = (e: Event) => {
    scrub.active = true
    scrub.value = Number((e.target as HTMLInputElement).value)
}

let prevHash = ''

const seek = (e: Event) => {
    // The scrub ends with this event (`change` fires on release, `click` on a
    // plain tap) — hand the bar back to the playhead either way.
    scrub.active = false

    if (prevHash && prevHash !== q.currenttrackhash) {
        prevHash = ''
        return
    }

    // A genuine mouse click seeks to the exact cursor position so the landing
    // spot matches the tooltip and the preview fill (full-width mapping).
    // Keyboard (arrow/Home/End) and drag fire `change` and fall back to the
    // native input value, keeping the range fully accessible. `detail > 0`
    // tells a real click apart from a keyboard-synthesised one.
    let value: number
    if (e.type === 'click' && (e as MouseEvent).detail > 0) {
        const ratio = ratioFromClientX((e as MouseEvent).clientX)
        if (ratio === null) return
        value = ratio * (time.full || 0)
    } else {
        value = Number((e.target as HTMLInputElement).value)
    }

    prevHash = q.currenttrackhash
    q.seek(value)
}

// How far along the bar the playhead sits, 0..1 — from the scrub position while
// dragging, so the fill travels with the knob instead of lagging behind. Drives
// the painted fill, the sprinkle overlay and the hover span below.
const playedRatio = computed(() => displayValue.value / (time.full || 1))
const currentPercent = computed(() => playedRatio.value * 100)

// The stretch a click would skip (or hand back): playhead <-> cursor, in
// percent. Painting the hover preview from zero instead covered the played fill
// whenever the cursor was ahead of the playhead, so it hid how far you had
// listened. Null while nothing is hovered.
//
// Derived rather than stored so the edges track the playhead while the pointer
// holds still — the fill grows a percent a second, and a span measured once on
// pointermove would drift away from it.
const seekSpan = computed(() => {
    if (!hover.active) return null
    const from = Math.min(playedRatio.value, hover.ratio) * 100
    const to = Math.max(playedRatio.value, hover.ratio) * 100
    return { from, to }
})

// Seek bar background, layered so the played portion reads as a solid teal
// fill (the memphis primary-action colour) over a soft-blush track:
//   1. seek span [from..to%]  — flat $mem-yellow, only while hovering
//   2. played [0..current%]   — flat $mem-teal
//   3. buffered [0..max%]     — flat $mem-blush, sits UNDER the played fill so
//                               it only shows between the playhead and buffer edge
//   4. track (base)           — flat $mem-blush-soft fills the remainder
// The 2px ink border, pill radius and white bordered thumb come from the
// global range styling (ProgressBar.scss); this only paints the fill. The
// sprinkle texture lives on the .progress-fill-sprinkle overlay div (the
// background layers here clip via background-size, which would stretch a
// fixed-tile pattern).
//
// The span belongs in THIS stack rather than in an overlay div: the thumb is a
// pseudo-element of the input, so anything stacked on top of the input covers
// its ink ring — the yellow used to swallow the knob it was drawn next to. As a
// background layer it sits under the thumb by construction. Hard colour stops
// place it (rather than background-position, whose percentages are measured
// against the leftover width and would need the span's own size folded in).
const progressBg = computed(() => {
    const span = seekSpan.value
    const seek = span
        ? `linear-gradient(to right, transparent ${span.from}%, ${MEMPHIS.yellow} ${span.from}%, ${MEMPHIS.yellow} ${span.to}%, transparent ${span.to}%) left center / 100% 100% no-repeat, `
        : ''
    const played = `linear-gradient(${MEMPHIS.teal}, ${MEMPHIS.teal}) left center / ${currentPercent.value}% 100% no-repeat`
    const buffered = `linear-gradient(${MEMPHIS.blush}, ${MEMPHIS.blush}) left center / ${maxSeekPercent.value}% 100% no-repeat`
    return `${seek}${played}, ${buffered}, ${MEMPHIS.blushSoft}`
})

// Seek target under the cursor, formatted like every other time in the app.
const hoverLabel = computed(() => formatSeconds(hover.ratio * (time.full || 0)))

// How much of the bar carries the sprinkle texture: everything painted, so the
// yellow span is textured exactly like the teal fill instead of reading as a
// flat patch pasted over a patterned bar.
const textureFrac = computed(() =>
    hover.active ? Math.max(playedRatio.value, hover.ratio) : playedRatio.value
)

// The tooltip stays on the cursor: it names the seek target, not the span.
const tooltipLeft = computed(() => hover.barLeft + hover.ratio * hover.barWidth)
</script>

<style lang="scss">
// Unscoped to match the codebase convention; everything is nested under
// .progress-wrap so the helper classes stay local to this component.
.progress-wrap {
    // The wrapper owns the slider's geometry, so the input AND the overlays
    // stacked on top of it read the same numbers. A host that wants a
    // touch-sized bar overrides this on the wrapper, not on the input — see
    // `range-geometry` in _candy.scss.
    @include range-geometry;

    position: relative;
    display: block;
    width: 100%;
    // Collapse the inline-block baseline gap under the range input so wrapping
    // it does not nudge the bar down a couple of pixels.
    line-height: 0;

    // Sprinkle overlay tracking the painted part of the bar — the played fill,
    // and while hovering the yellow seek span too (width via --texture-frac set
    // on the wrapper). The insets keep it inside the input's ink border, so
    // they are the border width — not a number that happens to match it today.
    .progress-fill-sprinkle {
        position: absolute;
        left: $candy-border-w;
        top: 50%;
        transform: translateY(-50%);
        // The bar's INNER height, so a taller touch-friendly bar keeps the
        // texture inside it. It used to subtract the border by hand from
        // --range-h, and — being a sibling of the input rather than a child —
        // it could not see the value a host set there anyway, so on phones it
        // stayed a 3.6px strip in a 20px bar.
        height: var(--range-track, #{$range-track-default});
        width: calc((100% - #{$candy-border-w * 2}) * var(--texture-frac, 0));
        border-radius: $candy-radius-pill;
        @include mem-sprinkle(20px);
        opacity: 0.4;
        pointer-events: none;
        z-index: 1;
    }

    // Floating time pill centred on the cursor, sitting just above the bar.
    .progress-tooltip {
        position: absolute;
        pointer-events: none;
        transform: translate(-50%, calc(-100% - 0.4rem));
        padding: 2px 6px;
        border-radius: $candy-radius-sm;
        background: $candy-white;
        border: 1px solid $mem-line;
        color: $candy-text;
        font-size: $medium;
        line-height: 1.2;
        font-weight: 500;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        z-index: 3;
    }

    // Hover effects are desktop-only. onPointerMove already ignores touch, which
    // is what keeps the yellow span out of the input's background there; this is
    // the CSS belt-and-braces for the one part CSS can reach (#66 acceptance).
    @media (hover: none) {
        .progress-tooltip {
            display: none !important;
        }
    }
}
</style>
