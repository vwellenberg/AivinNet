<template>
    <!-- One plate: media cell, dividing rule, text side. Shape, frame, shadow
         and the small-screen sizes live in Global/detail-head.scss — the four
         detail headers share them. -->
    <div ref="albumheaderthing" class="a-header">
        <div class="dh-art no-scroll">
            <img :src="imguri.thumb.large + album.image + (store.coverVersion ? '?v=' + store.coverVersion : '')" />
        </div>
        <Info />
    </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { ref } from 'vue'

import { paths } from '@/config'
import { isHeaderSmall } from '@/stores/content-width'

import useNavStore from '@/stores/nav'
import useAlbumStore from '@/stores/pages/album'

import Info from '@/components/AlbumView/Header/Info.vue'
import useVisibility from '@/utils/useVisibility'

const albumheaderthing = ref<any>(null)
const imguri = paths.images

const nav = useNavStore()
const store = useAlbumStore()

const { info: album } = storeToRefs(store)

defineEmits<{
    // eslint-disable-next-line no-unused-vars
    (event: 'playThis'): void
}>()

function handleVisibilityState(state: boolean) {
    nav.toggleShowPlay(state)
}

useVisibility(albumheaderthing, handleVisibilityState)
</script>

<style lang="scss">
.balance-text-temp {
    visibility: hidden;
    position: absolute;
    top: -9999px;
    left: -9999px;
}

// Geometry, frame, shadow and every small-screen size come from the shared
// anatomy in Global/detail-head.scss. What used to stand here — a 16rem cover
// with a 12rem variant, `$banner-height`, and two breakpoint blocks that
// restated the cover size and the title size a third and fourth time — is the
// drift that anatomy exists to prevent.
.a-header {
    // The album is the one head whose artwork is not always square: a wide
    // scan should sit inside the cell rather than be cropped to it.
    .dh-art img {
        object-fit: contain;
        background-color: $candy-pink-soft;
    }
}
</style>
