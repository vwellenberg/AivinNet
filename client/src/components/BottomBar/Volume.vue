<template>
    <div class="volume-control" @wheel.passive="handleMouseWheel">
        <!-- One glyph for both silent states (muted, or volume at 0) is right
             now that the button toggles AUDIBILITY rather than the mute flag:
             from here they are the same thing, and one tap gets sound back
             either way. The title says so. -->
        <button
            v-tip="settings.is_silent ? 'Unmute' : 'Mute'"
            class="speaker-icon"
            :class="{ silent: settings.is_silent }"
            @click="settings.toggleMute"
        >
            <VolumeMuteSvg v-if="level === 'mute'" />
            <VolumeHighSvg v-else-if="level === 'high'" />
            <VolumeMidSvg v-else-if="level === 'mid'" />
            <VolumeLowSvg v-else />
        </button>
        <!-- The seek bar's anatomy (LeftSidebar/NP/Progress.vue): the wrapper owns
             the geometry, the sprinkle covers what is painted, and while the
             pointer is over the bar a yellow span runs from the level to the
             pointer with a pill naming the level a click sets. Same classes, so
             the two bars share one stylesheet. -->
        <div
            ref="wrap"
            class="progress-wrap volume-wrap"
            :style="{ '--texture-frac': textureFrac }"
            @pointermove="onPointerMove"
            @pointerleave="onPointerLeave"
        >
            <input
                ref="input"
                class="volume-slider"
                type="range"
                name="volume"
                aria-label="Volume"
                max="1"
                min="0"
                step="0.01"
                :value="level01"
                :style="{ background: volumeBg }"
                @input="changeVolume"
                @pointerdown="onPress"
                @click="clickVolume"
            />
            <div class="progress-fill-sprinkle" />
            <div
                v-show="hover.active"
                class="progress-tooltip"
                :style="{ left: `${tooltipLeft}px`, top: `${hover.barTop}px`, '--pill-ratio': hover.ratio }"
            >
                {{ hoverLabel }}
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'

import VolumeHighSvg from '@/assets/icons/volume-high.svg'
import VolumeLowSvg from '@/assets/icons/volume-low.svg'
import VolumeMidSvg from '@/assets/icons/volume-mid.svg'
import VolumeMuteSvg from '@/assets/icons/volume-mute.svg'
import useSettingsStore from '@/stores/settings'
import { paintedFrac, previewSpan, ratioAt, spanLayer } from '@/utils/rangePreview'
import { volumeLevel } from '@/utils/volumeLevel'

const settings = useSettingsStore()

const level = computed(() => volumeLevel(settings.volume, settings.is_silent))

// What the bar shows: the level, or nothing while muted.
const level01 = computed(() => (settings.mute ? 0 : settings.volume))

const setLevel = (value: number) => {
    if (settings.mute) settings.toggleMute()
    settings.setVolume(value)
}

const changeVolume = (event: Event) => {
    setLevel(parseFloat((event.target as HTMLInputElement).value))
}

// --- hover preview, as on the seek bar --------------------------------------
const wrap = ref<HTMLElement | null>(null)
const input = ref<HTMLInputElement | null>(null)
const hover = reactive({ active: false, ratio: 0, barLeft: 0, barTop: 0, barWidth: 0 })

const ratioFromClientX = (clientX: number): number | null => {
    const el = input.value
    return el ? ratioAt(clientX, el.getBoundingClientRect()) : null
}

const onPointerMove = (e: PointerEvent) => {
    // Mouse and pen only: a touch has no hover, and a preview that stays
    // behind after the finger lifts reads as a stuck control.
    const ratio = e.pointerType === 'touch' ? null : ratioFromClientX(e.clientX)
    if (ratio === null || !input.value || !wrap.value) {
        hover.active = false
        return
    }
    const inRect = input.value.getBoundingClientRect()
    const wrapRect = wrap.value.getBoundingClientRect()
    hover.ratio = ratio
    hover.barLeft = inRect.left - wrapRect.left
    hover.barTop = inRect.top - wrapRect.top
    hover.barWidth = inRect.width
    hover.active = true
}

const onPointerLeave = () => {
    hover.active = false
}

// A real click lands where the pill says: the native range maps it over a
// track inset by half the thumb, a few percent off near the ends. Keyboard and
// drag keep the native value (`input` above): `detail > 0` tells a pointer
// click from a keyboard-synthesised one, and a pointer that travelled since it
// went down was a drag — its release fires `click` too, and the full-width
// ratio there is not the value the knob was dragged to (a knob dragged to the
// left end would land at ~11 %).
const DRAG_PX = 3
let pressAt: number | null = null
const onPress = (e: PointerEvent) => {
    pressAt = e.clientX
}
const clickVolume = (e: MouseEvent) => {
    const dragged = pressAt !== null && Math.abs(e.clientX - pressAt) > DRAG_PX
    pressAt = null
    if (e.detail === 0 || dragged) return
    const ratio = ratioFromClientX(e.clientX)
    if (ratio !== null) setLevel(Math.round(ratio * 100) / 100)
}

const hoverRatio = computed(() => (hover.active ? hover.ratio : null))
const span = computed(() => previewSpan(level01.value, hoverRatio.value))
const textureFrac = computed(() => paintedFrac(level01.value, hoverRatio.value))
const hoverLabel = computed(() => `${Math.round(hover.ratio * 100)}%`)
const tooltipLeft = computed(() => hover.barLeft + hover.ratio * hover.barWidth)

// Look tokens with the palette properties as fallback, like the seek bar: the
// span, then the level, over the track.
const SPAN = 'var(--look-track-seek, var(--mem-yellow))'
const FILL = 'var(--look-track-played, var(--mem-teal))'
const TRACK = 'var(--look-track, var(--mem-track-strong))'
const volumeBg = computed(
    () =>
        `${spanLayer(span.value, SPAN)}linear-gradient(${FILL}, ${FILL}) left center / ${level01.value * 100}% 100% no-repeat, ${TRACK}`
)

const handleMouseWheel = (event: WheelEvent) => {
    const delta = event.deltaY / 1000
    let newVolume = settings.volume - delta / 3

    if (newVolume > 1) newVolume = 1
    if (newVolume < 0) newVolume = 0

    settings.setVolume(newVolume)
}
</script>

<style lang="scss">
// The level pill slides along the cursor by its own width — left edge on the
// cursor at 0 %, right edge at 100 % — instead of centring on it like the seek
// bar's. The volume bar ends a few pixels from the window edge, and a centred
// "100%" ran past it (measured: 2px at 1024 wide, 5px with four digits).
.progress-wrap.volume-wrap .progress-tooltip {
    transform: translate(calc(var(--pill-ratio, 0.5) * -100%), calc(-100% - 0.4rem));
}

.b-bar .right-group .volume-control {
    display: flex;
    align-items: center;
    // Tighter than the bar's gap on purpose: the slider is the speaker's other
    // half, not a third neighbour. Same reasoning the token carries.
    gap: $bar-gap-tight;

    // Mute: the same plated role and the same footprint as every other bar
    // control. It used to be the odd one out at 2.25rem — the smallest button
    // in a bar whose next-smallest was 3rem.
    .speaker-icon {
        @include btn-action($size: $bar-control);
        // The speaker glyph is currentColor; drive it from the adaptive text
        // colour so it reads on the bar in both themes.
        color: $candy-text;

        // Silence is a STATE, and it wears the state box — the same yellow an
        // active shuffle or repeat wears. A crossed-out speaker in the quiet
        // role differs from a plain one by a few strokes; on a phone held in
        // landscape (>900px, so it gets this bar) that difference was missed
        // entirely, and a muted player just looked like a broken one. See #335.
        &.silent {
            @include btn-toggle-on;
        }
    }

    // Horizontal volume slider. Track pill, ink border and the white bordered
    // thumb come from the global range styling (ProgressBar.scss); the fill,
    // the preview span and the track are painted inline (`volumeBg`); the
    // sprinkle and the pill are the seek bar's (`.progress-wrap`, Progress.vue).
    //
    // The size sits on the WRAPPER: the sprinkle and the pill are siblings of
    // the input and measure against the wrapper (styling.md, "Regler-Geometrie").
    .volume-wrap {
        width: 6rem;
        min-width: 4rem;
        flex: 0 0 auto;
    }

    .volume-slider {
        margin-right: 0; // neutralise the global range's 15px right margin
    }

    @include allPhones {
        .volume-wrap {
            display: none;
        }
    }
}
</style>
