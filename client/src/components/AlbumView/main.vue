<template>
    <!-- One plate: media cell, dividing rule, text side. Shape, frame, shadow
         and the small-screen sizes live in Global/detail-head.scss — the four
         detail headers share them. -->
    <div ref="albumheaderthing" class="a-header">
        <div class="dh-art no-scroll">
            <img
                :src="imguri.thumb.large + album.image + (store.coverVersion ? '?v=' + store.coverVersion : '')"
                :class="{ 'is-placeholder': store.colors.placeholder }"
            />
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

// The cell paints a soft letterbox behind wide scans (object-fit: contain),
// which outranks the scheme-tinted tile the placeholder cover needs
// (Global/cover-placeholders.scss, #395). Whether this cover IS the
// placeholder is known from the colour extraction (`colors.placeholder`, the
// server's own marker), so the cell does not ask a second time.

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

        &.is-placeholder {
            background-color: mem-pastel(map-get($mem-entities, "album"));
        }
    }

    // Phones: the cover stays a square in the plate's corner instead of
    // stretching with the text column. Its text (type, title, "Album by …" and
    // the year/tracks/length line, two lines each on a phone) is taller than
    // the 120px cell, and the stretched cell showed the square cover with pink
    // bars above and below (120×159–176). Now the plate's pastel continues
    // under the cover. User's pick (A+C) from a four-way preview, 2026-11-26 —
    // C is the tighter text in Header/Info.vue.
    //
    // ⚠️ No rule UNDER the cover. Whenever the text side is only a few pixels
    // taller than the cell (short titles, singles), such a rule lands just
    // above the strip's top rule: two 3px lines with a hairline of pastel
    // between them (measured: 2.7px). So the dividing rule leaves the cell and
    // becomes a grid item of its own — the plate's `::after`, as tall as the
    // row — and the cover simply sits at its top.
    @include largePhones {
        > .dh-art {
            align-self: start;
            border-right: 0;
        }

        &::after {
            content: "";
            grid-row: 1;
            grid-column: 1;
            justify-self: end;
            align-self: stretch;
            border-right: $candy-border;
            // Above the dots, like the cell.
            z-index: 1;
        }
    }

    // The cover recedes as the header scrolls away. Scroll-driven: no script
    // runs on scroll. The timeline belongs to the HEAD, not to the cover: the
    // cover's own nearest scroll container is the `overflow: hidden` cell, which
    // never scrolls, so a view() on the cover stays inactive. The head's
    // ancestors up to the album scroller do not clip, so its exit is the
    // scroll the page actually does. Without the support the cover stays put.
    @supports (animation-timeline: view()) {
        view-timeline: --album-head block;

        .dh-art img {
            animation: album-cover-recede linear both;
            animation-timeline: --album-head;
            animation-range: exit 0% exit 100%;
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .dh-art img {
            animation: none;
        }
    }
}

@keyframes album-cover-recede {
    from {
        transform: none;
    }

    to {
        transform: scale(0.8) translateY(-0.75rem);
    }
}
</style>
