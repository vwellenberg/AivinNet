<template>
    <div class="playlist-banner-images no-scroll">
        <PlaylistImages v-if="playlist.info.images.length" :images="playlist.info.images" size="medium" />
    </div>
</template>

<script setup lang="ts">
import usePStore from '@/stores/pages/playlist'

import PlaylistImages from '@/components/shared/PlaylistImages.vue'

const playlist = usePStore()
</script>

<style lang="scss">
.playlist-banner-images {
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    background: $candy-pink-soft;
    border: $candy-border;
    border-radius: $candy-radius-sm;
    transition: all 0.2s ease-in-out;

    img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        transition: all 0.2s ease-in-out;
    }

    // The component's own aspect-ratio sizing is replaced by the square
    // banner box, which already fixes both dimensions.
    .playlist-collage {
        height: 100%;
    }
}
</style>
