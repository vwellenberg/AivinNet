<template>
    <div v-if="collage" class="playlist-collage no-scroll">
        <img v-for="(img, i) in collage" :key="`${i}-${img}`" :src="tileBase + img" />
    </div>
    <img v-else-if="first" :src="base + first" />
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { paths } from '@/config'
import { getCollageImages, imageName, PlaylistImageEntry } from '@/utils/playlistImages'

/**
 * Playlist thumbnail: a Spotify-style 2x2 collage of the first 4 album
 * covers when the playlist has 4 genuinely different ones, otherwise the
 * plain first cover (the previous behavior).
 *
 * Callers keep owning the uploaded-image (`has_image`) and placeholder
 * branches — an uploaded playlist image always takes precedence over this
 * component.
 */
const props = defineProps<{
    images: PlaylistImageEntry[]
    size: 'small' | 'medium' | 'large'
}>()

const base = computed(() => paths.images.thumb[props.size])
// Collage tiles render at half the surface's edge length, so one resolution
// tier below the single-cover image is plenty (large card tile ≈ medium thumb).
const tileBase = computed(() => paths.images.thumb[props.size === 'large' ? 'medium' : props.size])
const collage = computed(() => getCollageImages(props.images))
const first = computed(() => (props.images.length ? imageName(props.images[0]) : ''))
</script>

<style lang="scss">
.playlist-collage {
    display: grid;
    grid-template-columns: 1fr 1fr;
    width: 100%;
    aspect-ratio: 1;

    img {
        display: block;
        width: 100%;
        height: 100%;
        aspect-ratio: 1;
        object-fit: cover;
    }
}
</style>
