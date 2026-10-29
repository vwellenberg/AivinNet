<template>
    <div
        class="statitem"
        :class="[props.icon, { 'is-expandable': props.expandable, 'is-expanded': props.expandable && props.expanded }]"
        :style="tileStyle"
    >
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
            <path
                v-else-if="motif === 'sparkle'"
                d="M118 -38 L128 4 L170 14 L128 24 L118 66 L108 24 L66 14 L108 4 Z"
            />
            <!-- "How you listened" (#538): a pie with a slice taken out. -->
            <path
                v-else-if="motif === 'pie'"
                transform="rotate(-8 130 0)"
                d="M130 0 L77.4 19.2 A56 56 0 1 1 110.8 52.6 Z"
            />
            <rect v-else x="62" y="-8" width="120" height="34" transform="rotate(28 122 9)" />
        </svg>
        <div class="itemcontent">
            <!-- Each counted figure stands in a slot as wide as the widest text it
                 stands for (data-slot, drawn invisibly by ::before), so the words
                 around it break onto the same lines in every frame. -->
            <div v-if="tokens.length" class="count counting ellip2" :title="tooltip">
                <template v-for="(part, i) in parts" :key="i"
                    ><span v-if="part.slot !== undefined" class="countnum" :data-slot="part.slot"
                        ><span class="count-live">{{ part.text }}</span></span
                    ><template v-else>{{ part.text }}</template></template
                >
            </div>
            <div v-else class="count ellip2" :title="tooltip">{{ formattedValue }}</div>
            <div class="title">{{ text }}</div>
        </div>

        <component :is="icon" v-if="!props.icon.startsWith('top')" class="staticon" />
        <!-- A tile with something behind it ("new artists · new albums", #539)
             is one button over its whole face; the chevron says it opens. -->
        <template v-if="props.expandable">
            <ExpandSvg class="statchevron" aria-hidden="true" />
            <button
                type="button"
                class="statexpand"
                :aria-expanded="props.expanded"
                :aria-controls="props.controls"
                :aria-label="`${props.value} ${props.text}`"
                @click="emit('toggle')"
            ></button>
        </template>
        <button
            v-if="props.icon.startsWith('top') && props.image && props.trackhash"
            class="statplay"
            type="button"
            :title="`Play ${props.value}`"
            :aria-label="`Play ${props.value}`"
            @click="playTrack"
        >
            <img class="staticon statimage shadow-md" :src="paths.images.thumb.small + props.image" alt="" />
        </button>
        <router-link
            v-else-if="props.icon.startsWith('top') && props.image"
            :to="{
                name: Routes.album,
                params: {
                    albumhash: albumhash,
                },
            }"
        >
            <img class="staticon statimage shadow-md" :src="paths.images.thumb.small + props.image" alt="" />
        </router-link>
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { countParts, countTokens, countUpAt } from '@/utils/countUp'

import StopWatchSvg from '@/assets/icons/timer.svg'
import HeadphoneSvg from '@/assets/icons/headphones.svg'
import FolderSvg from '@/assets/icons/folder.nopad.svg'
import Index1Svg from '@/assets/icons/index1.svg'
import SparklesSvg from '@/assets/icons/sparkles.svg'
import CompassSvg from '@/assets/icons/compass.svg'
import PieSvg from '@/assets/icons/pie.svg'
import ExpandSvg from '@/assets/icons/expand.svg'

import { paths } from '@/config'
import { Routes } from '@/router'
import { playAlbumAt } from '@/helpers/usePlayFrom'

const props = defineProps<{
    value: string
    text: string
    icon: string
    image?: string
    trackhash?: string
    // A tile that opens a list (#539) is a control; every other one is not.
    // Two props, not an `expanded` left out: Vue casts a missing boolean
    // prop to false, so "left out" would read as "closed" on every tile.
    expandable?: boolean
    // Whether its list is open, and the id of that list.
    expanded?: boolean
    controls?: string
    // The whole answer where the value is only its head ("56% playlists ·
    // 30% albums" on a tile that shows "56% playlists"): its tooltip.
    detail?: string | null
}>()

const emit = defineEmits<{ toggle: [] }>()

// A track's image is `<albumhash>.webp?pathhash=…&fb=track`; only the part before
// the first dot is the album. Stripping just `.webp` left the query in the
// route param, so the tile's link opened an album that does not exist.
const albumhash = computed(() => props.image?.split('.')[0])

// A top-track tile that knows its track plays it, in its album, from that track.
function playTrack() {
    if (albumhash.value && props.trackhash) playAlbumAt(albumhash.value, 0, props.trackhash)
}

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

        case 'discoveries':
            return CompassSvg

        case 'sources':
            return PieSvg

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
// The widest figure each number passes through: the larger end of the count.
// Counting down (a shorter period's smaller value) starts wider than it ends.
const widest = ref<number[]>(tokens.value.map(token => token.value))
let frame = 0

function prefersLessMotion() {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function countTo(targets: number[]) {
    cancelAnimationFrame(frame)
    const from = figures.value.length === targets.length ? [...figures.value] : targets.map(() => 0)
    if (typeof requestAnimationFrame !== 'function' || prefersLessMotion()) {
        figures.value = targets
        widest.value = targets
        return
    }
    widest.value = targets.map((to, i) => Math.max(from[i], to))
    const start = performance.now()
    const step = (now: number) => {
        const elapsed = now - start
        figures.value = targets.map((to, i) => countUpAt(from[i], to, elapsed, COUNT_MS))
        if (elapsed < COUNT_MS) frame = requestAnimationFrame(step)
        // Landed: the slot shrinks to the value it now shows.
        else widest.value = targets
    }
    frame = requestAnimationFrame(step)
}

function startCount() {
    cancelAnimationFrame(frame)
    if (tokens.value.length === 0) {
        figures.value = []
        widest.value = []
        return
    }
    countTo(tokens.value.map(token => token.value))
}

onMounted(startCount)
watch(() => props.value, startCount)
onUnmounted(() => cancelAnimationFrame(frame))

// Between a new value and its watcher the figures still belong to the old one:
// show the value as it arrived rather than a mix of the two.
const settled = computed(
    () => figures.value.length === tokens.value.length && widest.value.length === tokens.value.length
)

const parts = computed(() => {
    const targets = tokens.value.map(token => token.value)
    return settled.value
        ? countParts(props.value, tokens.value, figures.value, widest.value)
        : countParts(props.value, tokens.value, targets, targets)
})

const formattedValue = computed(() => parts.value.map(part => part.text).join(''))
const tooltip = computed(() => props.detail || formattedValue.value)

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
        case 'discoveries':
            // The one accent none of the other tiles wears: the purple of the
            // doodle, which is also Stats in the navigation.
            return 'var(--mem-orchid)'
        case 'sources':
            // "How you listened" (#538): lime, worn by no other tile.
            return 'var(--mem-lime)'
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
        case 'discoveries':
            return 'sparkle'
        case 'sources':
            return 'pie'
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

            // A counted figure in a slot as wide as the widest text it shows
            // during the count. Without it the line broke wherever the figure
            // of the moment allowed: "1,234 tracks" fits on one line where
            // "12,420 tracks" needs two, so the word jumped up and down while
            // the number rose. Tabular digits keep every figure of the same
            // length exactly as wide as the slot; proportional ones made a
            // mid-count "10,888" wider than the final "12,420".
            .countnum {
                display: inline-grid;
                justify-items: start;
                font-variant-numeric: tabular-nums;

                &::before {
                    content: attr(data-slot);
                    visibility: hidden;
                }

                &::before,
                .count-live {
                    grid-area: 1 / 1;
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

    .statplay {
        display: contents;
        cursor: pointer;
    }

    // The open/close mark of a tile that opens a list, next to its icon:
    // pointing down at what opens, up once it is open.
    .statchevron {
        position: absolute;
        top: 1rem;
        left: 3rem;
        width: 1.5rem;
        height: 1.5rem;
        z-index: 1;
        color: $mem-ink;
        transform: rotate(90deg);
        transition: transform $motion-move $motion-curve;
    }

    &.is-expanded .statchevron {
        transform: rotate(-90deg);
    }

    // Over the whole face: the tile IS the control. No role of its own — a
    // role's hover plate would cover the tile; the TILE answers the pointer
    // (`candy-raised` below) and the button only carries focus and the click.
    .statexpand {
        position: absolute;
        inset: 0;
        z-index: 2;
        padding: 0;
        border: 0;
        border-radius: inherit;
        background: none;
        cursor: pointer;
        @include focus-ring;
    }

    // A tile that opens something lifts under the pointer like every card
    // (`$press: false`: `:active` would also match from the button inside).
    &.is-expandable {
        @include candy-raised(4px, 4px, $press: false);
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
