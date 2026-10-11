<template>
    <div class="statitem" :class="props.icon" :style="tileStyle">
        <div class="itemcontent">
            <div class="count ellip2" :title="formattedValue">{{ formattedValue }}</div>
            <div class="title">{{ text }}</div>
        </div>

        <component :is="icon" v-if="!props.icon.startsWith('top')" class="staticon" />
        <router-link
            v-if="props.icon.startsWith('top') && props.image"
            :to="{
                name: Routes.album,
                params: {
                    albumhash: props.image?.replace('.webp', ''),
                },
            }"
        >
            <img class="staticon statimage shadow-md" :src="paths.images.thumb.small + props.image" alt="" />
        </router-link>
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { countSeparator, countUpAt, formatCount } from '@/utils/countUp'

import StopWatchSvg from '@/assets/icons/timer.svg'
import HeadphoneSvg from '@/assets/icons/headphones.svg'
import FolderSvg from '@/assets/icons/folder.nopad.svg'
import Index1Svg from '@/assets/icons/index1.svg'
import SparklesSvg from '@/assets/icons/sparkles.svg'

import { paths } from '@/config'
import { Routes } from '@/router'

const props = defineProps<{
    value: string
    text: string
    icon: string
    image?: string
}>()

const icon = computed(() => {
    switch (props.icon) {
        case 'streams':
            return HeadphoneSvg
        case 'playtime':
            return StopWatchSvg

        case 'trackcount':
            return FolderSvg

        case 'toptrack':
            return Index1Svg

        default:
            return SparklesSvg
    }
})

// A plain count counts up from zero (or from the figure it showed before) to
// its value. Anything that is not a count — a unit, a date — is shown as it
// arrives, with no motion at all.
const COUNT_MS = 900
const separator = computed(() => countSeparator(props.value))
const counted = ref<number | null>(separator.value === null ? null : 0)
let frame = 0

function prefersLessMotion() {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function countTo(to: number) {
    cancelAnimationFrame(frame)
    const from = counted.value ?? 0
    if (typeof requestAnimationFrame !== 'function' || prefersLessMotion()) {
        counted.value = to
        return
    }
    const start = performance.now()
    const step = (now: number) => {
        const elapsed = now - start
        counted.value = countUpAt(from, to, elapsed, COUNT_MS)
        if (elapsed < COUNT_MS) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
}

function startCount() {
    if (separator.value === null) {
        cancelAnimationFrame(frame)
        counted.value = null
        return
    }
    countTo(Number(props.value.replace(/\D/g, '')))
}

onMounted(startCount)
watch(() => props.value, startCount)
onUnmounted(() => cancelAnimationFrame(frame))

const formattedValue = computed(() => {
    if (counted.value === null || separator.value === null) return props.value.toLocaleString()
    return formatCount(counted.value, separator.value)
})

// Flat memphis tile colour, cycled by stat type across the palette
// [blush, lavender, teal, yellow]. The design is flat, so every route
// (including Album/Artist, which previously used cover-extracted colours) uses
// the same memphis tiles with black text.
const defaultBackgroundStyles = computed(() => {
    switch (props.icon) {
        case 'streams':
            return 'var(--mem-blush)'
        case 'playtime':
            return 'var(--mem-lavender)'
        case 'trackcount':
            return 'var(--mem-teal)'
        case 'toptrack':
        case 'topalbum':
            return 'var(--mem-yellow)'
        default:
            // "New favorites" and anything else unclaimed. Coral, not blush:
            // `streams` already takes blush, so the two sat side by side in
            // the same pink (#468). Coral is the palette's secondary accent and
            // the only one free here — teal means playback, yellow means "on".
            return 'var(--mem-coral)'
    }
})

// `--row-fill` is the tile's one fill source: the label covers below read it, so
// a cover always matches the tile it sits on.
const tileStyle = computed(() => ({
    backgroundColor: defaultBackgroundStyles.value,
    '--row-fill': defaultBackgroundStyles.value,
}))
</script>

<style lang="scss">
.statitem {
    @include candy-box($mem-blush, $candy-radius);
    // The hard offset every other card in this design carries (#468). It was
    // missing because `candy-box` is fill + frame + radius ONLY — the shadow
    // lives in `candy-shadow`, and nobody added the second half, so the tiles
    // lay flat on the ground while the rows and buttons above them stood up.
    //
    // `candy-shadow`, not `candy-raised`: the tile is not a control (only the
    // cover inside the top-track tile links anywhere), and `candy-raised`'s
    // `:active` also matches ANCESTORS — pressing that link would push the
    // whole tile down. 4px is the card offset; rows and buttons take 3px.
    @include candy-shadow(4px, 4px);
    // Accent-filled tiles (blush/lavender/teal/yellow) → static ink text.
    color: $mem-ink;
    height: 12rem;
    aspect-ratio: 1;
    overflow: hidden;
    position: relative;

    // Dots, not hatch: the tile is read, never pressed (mem-halftone). They cover
    // the whole tile, like the Continue card, and build up as a wave along the
    // row; the tiles' places in it are set below.
    &::before {
        @include mem-halftone($reach: null);
        @include mem-dots-wave;
    }

    .itemcontent {
        position: relative;
        z-index: 1;
        height: 100%;
        padding: 1rem;

        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        align-items: flex-start;
        gap: $small;

        // Small type takes a plain cover, so no dot lands under a letter. The
        // number is large: the dots read through it, and a box around it would
        // only cut gaps in the tile. The cover's own inset is pulled back so the
        // title keeps its line.
        .count {
            font-size: 1.55rem;
            font-weight: 900;
        }

        .title {
            @include mem-hatch-clear(6px);
            margin-left: -4px;
            font-size: 14px;
            font-weight: 500;
        }
    }

    .staticon {
        position: absolute;
        top: 1rem;
        left: 1rem;
        width: 1.5rem;
        z-index: 1;
        color: $mem-ink;
    }

    .statimage {
        height: 54px;
        width: 54px;
        border-radius: $candy-radius-sm;
        border: $candy-border;
    }
}

.statitem.toptrack,
.statitem.topalbum {
    aspect-ratio: 1.5;
}

// The wave along the row: each tile starts one stagger after the one before it.
@for $i from 1 through 6 {
    .statitem:nth-child(#{$i})::before {
        animation-delay: $motion-stagger * ($i - 1);
    }
}
</style>
