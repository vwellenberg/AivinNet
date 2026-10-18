<template>
    <div class="tilepreview" aria-hidden="true">
        <div ref="box" class="tilepreview-box">
            <div
                class="tilepreview-grid"
                :style="{
                    width: `${gridWidth}px`,
                    gap: `${gap}px`,
                    gridTemplateColumns: `repeat(auto-fill, minmax(${cell}px, 1fr))`,
                }"
            >
                <div v-for="(t, i) in tiles" :key="i" class="tp-tile">
                    <div class="tp-art" :class="[t.tone, { round: t.round }]"></div>
                    <div class="tp-plate">
                        <b>{{ t.name }}</b>
                        <span>{{ t.meta }}</span>
                    </div>
                </div>
            </div>
        </div>
        <div class="tilepreview-count">about {{ columns }} per row in this window</div>
    </div>
</template>

<script setup lang="ts">
import { useElementSize } from '@vueuse/core'
import { computed, ref } from 'vue'

import { content_width, win_width } from '@/stores/content-width'
import useSettings from '@/stores/settings'
import { CARD_GAP, cardColumns, cardMin } from '@/utils/cardColumns'

const settings = useSettings()

const box = ref<HTMLElement | null>(null)
const { width: boxWidth } = useElementSize(box)

// A MINIATURE of the real grid: every length (column minimum, gap, total width)
// is multiplied by the same factor, and floor((W + g) / (m + g)) does not change
// when all three scale together — so the preview builds exactly as many columns
// as the page behind the modal will. The factor fits the page's content width
// into the row this sits in (and never blows it up past half size).
const scale = computed(() => {
    if (!boxWidth.value || !content_width.value) return 0.3
    return Math.min(0.5, Math.max(0.15, boxWidth.value / content_width.value))
})

const gridWidth = computed(() => Math.max(content_width.value, 1) * scale.value)
const gap = computed(() => CARD_GAP * scale.value)
const cell = computed(() => cardMin(win_width.value, settings.tile_size) * scale.value)

const columns = computed(() => cardColumns(content_width.value, win_width.value, settings.tile_size))

const tiles = [
    { name: 'Playlist', meta: '42 tracks', tone: 'purple' },
    { name: 'Artist', meta: 'Artist', tone: 'coral', round: true },
    { name: 'Album', meta: '2024', tone: 'teal' },
    { name: 'Playlist', meta: '18 tracks', tone: 'pink' },
    { name: 'Artist', meta: 'Artist', tone: 'purple', round: true },
    { name: 'Album', meta: '2019', tone: 'coral' },
    { name: 'Playlist', meta: '120 tracks', tone: 'teal' },
    { name: 'Album', meta: '2021', tone: 'pink' },
    { name: 'Artist', meta: 'Artist', tone: 'coral', round: true },
    { name: 'Playlist', meta: '9 tracks', tone: 'purple' },
    { name: 'Album', meta: '2016', tone: 'teal' },
    { name: 'Playlist', meta: '64 tracks', tone: 'pink' },
    { name: 'Album', meta: '2023', tone: 'purple' },
    { name: 'Artist', meta: 'Artist', tone: 'teal', round: true },
    { name: 'Playlist', meta: '31 tracks', tone: 'coral' },
    { name: 'Album', meta: '2020', tone: 'pink' },
]
</script>

<style lang="scss">
.tilepreview {
    // A full-width row under the slider (the row is a two-column grid).
    grid-column: 1 / -1;
    display: grid;
    gap: $small;
    min-width: 0;

    // The height is FIXED, not the content's: the slider sits above this and
    // moves under the finger, so a preview that grew and shrank with the column
    // count would drag the slider out of reach mid-gesture. The fade says
    // "the grid goes on" instead of cutting a tile in half.
    .tilepreview-box {
        height: 8.5rem;
        overflow: hidden;
        padding: $smaller;
        mask-image: linear-gradient(to bottom, #000 62%, transparent);
    }

    .tilepreview-grid {
        display: grid;
        max-width: 100%;
    }

    .tp-tile {
        display: grid;
        gap: 0.2rem;
        align-content: start;
        min-width: 0;
    }

    .tp-art {
        aspect-ratio: 1;
        @include candy-box($mem-panel, $candy-radius-xs);

        &.round {
            border-radius: 50%;
        }

        &.purple {
            background-color: mem-pastel($mem-lavender);
        }
        &.coral {
            background-color: mem-pastel($mem-coral);
        }
        &.teal {
            background-color: mem-pastel($mem-teal);
        }
        &.pink {
            background-color: mem-pastel($mem-pink);
        }
    }

    .tp-plate {
        @include candy-box($mem-panel, $candy-radius-xs);
        padding: 2px 5px;
        min-width: 0;
        color: $candy-text;
        font-size: 0.6875rem;
        line-height: 1.25;

        b,
        span {
            display: block;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        b {
            font-weight: 700;
        }

        span {
            color: $mem-content-muted;
        }
    }

    .tilepreview-count {
        font-size: 0.8rem;
        font-weight: 500;
        color: $mem-content-muted;
    }
}
</style>
