<template>
    <!-- The album's own find, the first row of the list. Cmd/Ctrl+F lands here
         (helpers/useListFind.ts, registered by AlbumView). -->
    <div class="album-find">
        <ListFind
            :model-value="album.query"
            field-id="album-find"
            placeholder="Find in album"
            @update:model-value="value => (album.query = value)"
        />
    </div>
</template>

<script setup lang="ts">
import ListFind from '@/components/shared/ListFind.vue'
import useAlbumStore from '@/stores/pages/album'

const album = useAlbumStore()
</script>

<style lang="scss">
// The gap around the field is PADDING, not margin: the scroller measures this
// component's height, and a margin is not part of it.
.album-find {
    display: flex;
    justify-content: flex-end;
    padding: $small 1rem;
}
</style>
