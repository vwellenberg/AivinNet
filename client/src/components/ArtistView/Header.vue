<template>
    <div class="headparent">
        <!-- One plate: media cell, dividing rule, text side — the same anatomy
             the album and playlist heads wear (Global/detail-head.scss).
             Gone with it: the ambient wash behind the head (a second absolutely
             positioned element that had to be kept in sync with the head's own
             height), the dark scrim for the small-phone layout, and the photo
             on the RIGHT, which made this the one detail page that read in the
             opposite direction. -->
        <div ref="artistheader" class="artist-page-header">
            <div class="dh-art" :class="{ 'is-round': useCircularImage, 'is-glyph': imageMissing }">
                <!-- The glyph branch is defensive only. The image endpoint
                     answers 200 even for an artist with no photo: it falls back
                     to the backend's own assets/artist.webp, so `@error` does
                     NOT fire in the common no-photo case. This covers the two
                     cases the backend can't: an empty `image` field, and a
                     genuine network failure. -->
                <ArtistSvg v-if="imageMissing" title="No artist image" />
                <img
                    v-else
                    id="artist-avatar"
                    :src="paths.images.artist.large + artist.image"
                    @load="store.setBgColor"
                    @error="imageFailed = true"
                />
            </div>
            <Info :artist="artist" :use-circular-image="useCircularImage" />
        </div>
    </div>
</template>

<script setup lang="ts">
import { useElementSize } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { Ref, computed, onMounted, ref } from 'vue'
import { onBeforeRouteUpdate } from 'vue-router'

import { paths } from '@/config'
import updatePageTitle from '@/utils/updatePageTitle'

import useArtistStore from '@/stores/pages/artist'
import ArtistSvg from '@/assets/icons/artist.svg'
import Info from './HeaderComponents/Info.vue'

const store = useArtistStore()

// `@error` only fires for an image that was actually requested, so an artist
// with an empty `image` (nothing to request) has to be caught up front.
const imageFailed = ref(false)

const props = defineProps<{
    on_sidebar?: boolean
}>()

const { info: artist } = storeToRefs(store)

const imageMissing = computed(() => imageFailed.value || !artist.value.image)

function updateTitle() {
    props.on_sidebar ? () => {} : updatePageTitle(artist.value.name)
}

onMounted(() => updateTitle())
onBeforeRouteUpdate(() => {
    // Without this the placeholder sticks: the component is reused across
    // artist routes, so a failure on one artist would hide the next one's photo.
    imageFailed.value = false
    updateTitle()
})

const artistheader: Ref<HTMLElement | null> = ref(null)
const { width } = useElementSize(artistheader)

// Still measured, but only to decide whether the portrait is a disc: the plate
// itself no longer changes shape with the width — Global/detail-head.scss owns
// the small-screen sizes for all four heads.
const isSmallPhone = computed(() => width.value <= 660)
const useCircularImage = computed(() => !isSmallPhone.value)
</script>

<style lang="scss">
.headparent {
    height: 100%;
    width: 100%;
}

// Geometry, frame, shadow and the small-screen sizes come from the shared
// anatomy in Global/detail-head.scss. Gone with the plate: the ambient wash
// (a second absolutely positioned element whose height had to be kept in sync
// with the header's), the dark scrim over the small-phone photo, and the
// per-breakpoint container heights.
.artist-page-header {
    // The portrait is the one head image that may be a disc; `.dh-art.is-round`
    // owns that. Nothing else here.
    .dh-art img {
        object-position: top;
    }
}
</style>
