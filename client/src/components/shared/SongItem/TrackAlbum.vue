<template>
    <router-link
        v-if="!hide_album"
        v-tooltip
        class="song-album ellip"
        :to="{
            name: 'AlbumView',
            params: {
                albumhash: albumhash || 'Unknown',
            },
        }"
    >
        {{ album }}
    </router-link>
</template>

<script setup lang="ts">
defineProps<{
    hide_album: boolean
    albumhash: string
    album: string
}>()
</script>

<style lang="scss">
.song-album {
    max-width: max-content;
    max-width: calc(100% - 10px);
    // Renders on the page ground -> theme-aware muted (ink-muted on paper,
    // lavender-white on indigo). Filled rows re-pin ink-muted in SongItem.vue.
    color: $mem-content-muted;
    cursor: pointer !important;

    &:hover {
        text-decoration: underline;
    }
}
</style>
