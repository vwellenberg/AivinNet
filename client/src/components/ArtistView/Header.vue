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
                    :src="store.imageUrl()"
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

    // Phones: the action row leaves the text column and becomes a strip
    // under the whole plate. On a 390px phone the text side is ~175px wide,
    // so Play (96px) + Favourite + Overflow wrapped and the overflow button
    // stood on a line of its own; the text side then outgrew the 120px cell
    // and stretched the photo into a 120×224 portrait crop (plate 230px, at
    // 360px with a two-line name 274px). With the strip, the row has the full
    // plate width and the cell only has to match type, name and meta.
    @include largePhones {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        // The body's pastel and its dots (`.dh-body::before`, absolutely
        // positioned) now cover the plate: text and strip are one surface.
        position: relative;
        background-color: var(--look-detail-head-fill, var(--dh-fill, #{$mem-panel}));

        // The body's box goes away; its two children (text, actions) become
        // grid items of the plate. Its type/title/meta sizes, `--row-fill`
        // and the dots still apply — selected by class and inherited, not
        // painted by the box.
        .artist-info {
            display: contents;
        }

        // Above the dots, which now span the plate. The dividing rule moves to
        // the cell: it was `.dh-art + .dh-body`, a `display: contents` box
        // paints no border, and the text block hugs its words (`.dh-text`,
        // for the veil), so a rule on it would end with the meta line. The
        // reason the rule normally lives on the body — a round, padded cell —
        // does not apply here: below 660px the portrait is never a disc.
        .dh-art {
            grid-row: 1;
            z-index: 1;
            border-right: $candy-border;
        }

        .artist-info > .text {
            grid-row: 1;
            grid-column: 2;
            align-self: center;
            margin: $medium;
            // `.dh-text`'s `max-width: 100%` is the whole grid area; the
            // margins have to come off it, or a long one-word name overflows.
            max-width: calc(100% - 2 * #{$medium});
        }

        .artist-info > .header-actions {
            grid-row: 2;
            grid-column: 1 / -1;
            flex-wrap: nowrap;
            padding: $small $medium $medium;
            border-top: $candy-border;

            // The primary action takes the room the strip gives it.
            .playbtnrect {
                flex: 1;
            }
        }
    }
}
</style>
