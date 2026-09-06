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
            <img class="staticon statimage shadow-sm" :src="paths.images.thumb.small + props.image" alt="" />
        </router-link>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import StopWatchSvg from '@/assets/icons/timer.svg'
import HeadphoneSvg from '@/assets/icons/headphones.svg'
import FolderSvg from '@/assets/icons/folder.nopad.svg'
import Index1Svg from '@/assets/icons/index1.svg'
import SparklesSvg from '@/assets/icons/sparkles.svg'

import { paths } from '@/config'
import { Routes } from '@/router'
import { MEMPHIS } from '@/utils/colortools/pageGradient'

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

const formattedValue = computed(() => {
    return props.value.toLocaleString()
})

// Flat memphis tile colour, cycled by stat type across the palette
// [blush, lavender, teal, yellow]. The design is flat, so every route
// (including Album/Artist, which previously used cover-extracted colours) uses
// the same memphis tiles with black text.
const defaultBackgroundStyles = computed(() => {
    switch (props.icon) {
        case 'streams':
            return MEMPHIS.blush
        case 'playtime':
            return MEMPHIS.lavender
        case 'trackcount':
            return MEMPHIS.teal
        case 'toptrack':
        case 'topalbum':
            return MEMPHIS.yellow
        default:
            // "New favorites" and anything else unclaimed. Coral, not blush:
            // `streams` already takes blush, so the two sat side by side in
            // the same pink (#468). Coral is the palette's secondary accent and
            // the only one free here — teal means playback, yellow means "on".
            return MEMPHIS.coral
    }
})

const tileStyle = computed(() => ({
    backgroundColor: defaultBackgroundStyles.value,
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
        border-radius: $smaller;
        border: $candy-border;
    }
}

.statitem.toptrack,
.statitem.topalbum {
    aspect-ratio: 1.5;
}
</style>
