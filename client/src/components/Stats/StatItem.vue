<template>
    <div class="statitem" :class="props.icon" :style="tileStyle">
        <svg class="statmotif" viewBox="0 0 150 90" aria-hidden="true" focusable="false">
            <circle v-if="motif === 'disc'" cx="128" cy="-6" r="58" />
            <polygon v-else-if="motif === 'triangle'" points="52,-14 168,6 104,74" />
            <path
                v-else-if="motif === 'wave'"
                class="line"
                transform="rotate(-14 150 40)"
                d="M40 42 q14 -18 28 0 t28 0 t28 0 t28 0 t28 0"
            />
            <path
                v-else-if="motif === 'zigzag'"
                class="line"
                d="M50 62 l16 -20 l16 20 l16 -20 l16 20 l16 -20 l16 20"
            />
            <rect v-else x="62" y="-8" width="120" height="34" transform="rotate(28 122 9)" />
        </svg>
        <div class="itemcontent">
            <!-- While counting, the box is sized by the FINAL value (data-final, drawn
                 invisibly by ::before) and the live figure floats in it, so a wider
                 intermediate figure cannot wrap onto a second line. -->
            <div
                v-if="tokens.length"
                ref="countEl"
                class="count counting ellip2"
                :class="{ oneline }"
                :title="formattedValue"
                :data-final="props.value"
            >
                <span class="count-live">{{ formattedValue }}</span>
            </div>
            <div v-else class="count ellip2" :title="formattedValue">{{ formattedValue }}</div>
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
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { countTokens, countUpAt, renderCounts } from '@/utils/countUp'

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

// The numbers in the value count up from zero (or from the figure they showed
// before) to their value; the words around them stay. A top tile shows a title
// or an album, where a number is not a count, so it is never counted. Reduced
// motion jumps straight to the value.
const COUNT_MS = 900
const tokens = computed(() => (props.icon.startsWith('top') ? [] : countTokens(props.value)))
const figures = ref<number[]>(tokens.value.map(() => 0))
let frame = 0

function prefersLessMotion() {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function countTo(targets: number[]) {
    cancelAnimationFrame(frame)
    const from = figures.value.length === targets.length ? [...figures.value] : targets.map(() => 0)
    if (typeof requestAnimationFrame !== 'function' || prefersLessMotion()) {
        figures.value = targets
        return
    }
    const start = performance.now()
    const step = (now: number) => {
        const elapsed = now - start
        figures.value = targets.map((to, i) => countUpAt(from[i], to, elapsed, COUNT_MS))
        if (elapsed < COUNT_MS) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
}

function startCount() {
    cancelAnimationFrame(frame)
    if (tokens.value.length === 0) {
        figures.value = []
        return
    }
    countTo(tokens.value.map(token => token.value))
}

// Whether the final value fits on one line: only then may the live figure refuse
// to wrap. A value that wraps anyway ("12 hrs, 49 mins listened") keeps wrapping.
const countEl = ref<HTMLElement | null>(null)
const oneline = ref(true)
function measureLines() {
    const el = countEl.value
    if (!el) return
    const size = parseFloat(getComputedStyle(el).fontSize) || 0
    oneline.value = !size || el.offsetHeight < size * 1.5
}

onMounted(() => {
    measureLines()
    startCount()
})
watch(
    () => props.value,
    () => {
        startCount()
        nextTick(measureLines)
    }
)
onUnmounted(() => cancelAnimationFrame(frame))

const formattedValue = computed(() => {
    // Between a new value and its watcher the figures still belong to the old
    // one: show the value as it arrived rather than a mix of the two.
    if (figures.value.length !== tokens.value.length) return props.value
    return renderCounts(props.value, tokens.value, figures.value)
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

// One Memphis shape per kind, drawn big and tone in tone in the top-right corner
// and cropped by the tile's edge. It is a motif, not a texture: a whole shape
// can end clear of the text, where a dot pattern could only be cut off at the
// letters. Same split as the colour above: top tiles share one, and the kinds
// nobody claimed ("New favorites") take the zigzag.
const motif = computed(() => {
    switch (props.icon) {
        case 'toptrack':
        case 'topalbum':
            return 'disc'
        case 'streams':
            return 'triangle'
        case 'playtime':
            return 'wave'
        case 'trackcount':
            return 'bar'
        default:
            return 'zigzag'
    }
})

// In Memphis dark the tile keeps `--mem-tile-depth` of its accent and takes the
// rest from the dusk base, like every pastel there (Global/index.scss). Light
// mode sets neither, so the mix is the accent itself.
const tileStyle = computed(() => ({
    backgroundColor: `color-mix(in srgb, ${defaultBackgroundStyles.value} var(--mem-tile-depth, 100%), var(--mem-pastel-base, var(--mem-paper)))`,
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

    // The motif, behind the content. It is the top-right 150x90 of the tile and
    // the tile's `overflow: hidden` crops what leaves it. All of it ends above
    // the text: the number has two lines at most and starts 85px below the
    // tile's outer edge, while the lowest point of any shape (the triangle's tip)
    // is at 77px, so 8px of air at the closest (measured on the running client,
    // light and dark, desktop and phone). Not the hatch and not dots — those say
    // "pressable" or run behind the letters; this stays out of the way.
    //
    // The colour is the tile's own ink at 13 %, so it reads on every accent
    // and in both themes, and it follows a colour scheme's ink. `--shape-motif`
    // lets a look drop it (Boring: `none`).
    .statmotif {
        display: var(--shape-motif, block);
        position: absolute;
        top: 0;
        right: 0;
        width: 150px;
        height: 90px;
        overflow: visible;
        pointer-events: none;
        color: mem-alpha($mem-ink, 0.13);
        fill: currentColor;
        transform-origin: 100% 0;
        @include mem-motif-pop;

        // Open shapes (the wave, the zigzag) are strokes, not fills.
        .line {
            fill: none;
            stroke: currentColor;
            stroke-width: 9;
            stroke-linecap: round;
            stroke-linejoin: round;
        }
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

        .count {
            font-size: 1.55rem;
            font-weight: 900;
            // Always two lines of room (the most `ellip2` lets it have), with
            // the text at the TOP of it. The block stands at the bottom of the
            // tile, so a one-line value ("12,671 tracks") used to start a
            // whole line lower than its two-line neighbours (measured 116px
            // against 85px). Now every value starts at 85px — where the motif
            // comment above measures its 8px of air — and every caption
            // stands on one line too.
            min-height: 2lh;

            // Only for a value that fits on one line. A value that wraps anyway
            // stays in the flow: floating it would clip a line the box has no
            // room for.
            &.counting.oneline {
                position: relative;

                &::before {
                    content: attr(data-final);
                    display: block;
                    visibility: hidden;
                }

                // Anchored to the top, like the text it stands in for.
                .count-live {
                    position: absolute;
                    left: 0;
                    right: 0;
                    top: 0;
                    white-space: nowrap;
                }
            }
        }

        .title {
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

// The wave along the row: each tile's motif pops in one stagger after the one
// before it.
@for $i from 1 through 6 {
    .statitem:nth-child(#{$i}) .statmotif {
        animation-delay: $motion-stagger * ($i - 1);
    }
}
</style>
