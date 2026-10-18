<template>
    <div class="tilepreview" aria-hidden="true">
        <div class="tilepreview-grid" :style="{ gridTemplateColumns: `repeat(auto-fill, minmax(${cell}px, 1fr))` }">
            <div v-for="t in tiles" :key="t.name" class="tp-tile">
                <div class="tp-art" :class="[t.tone, { round: t.round }]"></div>
                <div class="tp-plate">
                    <b>{{ t.name }}</b>
                    <span>{{ t.meta }}</span>
                </div>
            </div>
        </div>
        <div class="tilepreview-count">{{ columns }} per row in this window</div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { content_width, win_width } from '@/stores/content-width'
import useSettings from '@/stores/settings'
import { cardColumns } from '@/utils/cardColumns'

// The settings row is narrow, so the real grid is drawn at this fraction of its
// size. The layout rules are the app's (auto-fill, 1fr, a gap that scales with
// the cell), the dimensions are scaled.
const SCALE = 0.3

const settings = useSettings()

const cell = computed(() => settings.tile_size * SCALE)

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
]
</script>

<style lang="scss">
.tilepreview {
    // A full-width row under the slider (the row is a two-column grid).
    grid-column: 1 / -1;
    display: grid;
    gap: $small;
    // Reads the app's own content width: the preview must never claim more
    // columns than the page behind it will build.
    max-width: 100%;

    .tilepreview-grid {
        display: grid;
        gap: 0.6rem;
        // Two rows are enough to see the rhythm; a third only makes the row tall.
        max-height: 9.5rem;
        overflow: hidden;
        padding: $smaller;
    }

    .tp-tile {
        display: grid;
        gap: 0.2rem;
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
