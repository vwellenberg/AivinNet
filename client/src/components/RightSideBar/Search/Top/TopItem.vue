<template>
    <!-- The top result is a cover tile like every other one (#139): type label,
         artwork, name plate — the shared anatomy in Global/cards.scss. It used
         to build its own card (one white panel with the picture inside), so it
         was the one link on the search page without the hatch that says "you
         can press this", its round artist portrait lay flat without the
         crescent, and it never arrived with the rest of the page.

         Like every tile, the whole card is the link and the play disc on the
         artwork is its only control. The `⋮` button the track result carried
         went with the panel: the same menu opens on right-click, on a touch
         long-press, and from the keyboard via the context-menu key — the way
         it does on every tile (v-context-menu). -->
    <RouterLink
        v-context-menu="onContextMenu"
        :to="{
            name: res_type === 'artist' ? Routes.artist : Routes.album,
            params: res_type === 'artist' ? { hash: item.artisthash || ' ' } : { albumhash: item.albumhash || ' ' },
        }"
        class="top-result-item"
        :class="{ 'context-menu-open': context_menu_showing }"
    >
        <CardTypeLabel :type="res_type" />
        <div class="card-art" :class="{ 'is-round': res_type === 'artist' }">
            <img
                :src="
                    res_type === 'artist' ? paths.images.artist.medium + item.image : paths.images.thumb.large + item.image
                "
                alt=""
            />
            <PlayBtn
                :source="
                    res_type == 'album'
                        ? playSources.album
                        : res_type == 'artist'
                        ? playSources.artist
                        : playSources.track
                "
                :album-hash="item.albumhash"
                :album-name="item.title"
                :artisthash="item.artisthash"
                :artistname="item.name"
                :track="item"
            />
        </div>
        <div class="card-plate">
            <div class="name ellip">
                {{ res_type === 'artist' ? item.name : item.title }}
            </div>
            <div v-if="res_type === 'album'" class="meta with-artists">
                <span>{{ formatDate(item.date, true) }} •</span>
                <ArtistName :artists="item.albumartists" :albumartists="''" />
            </div>
            <div v-if="res_type === 'artist'" class="meta ellip">
                {{ item.albumcount }}
                {{ item.albumcount === 1 ? 'album' : 'albums' }} •
                {{ item.trackcount }}
                {{ item.trackcount === 1 ? 'track' : 'tracks' }}
            </div>
            <div v-if="res_type === 'track'" class="meta with-artists">
                <ArtistName :artists="item.artists" :albumartists="item.albumartists" />
                <span>• {{ formatSeconds(item.duration, true) }}</span>
            </div>
        </div>
    </RouterLink>
</template>

<script setup lang="ts">
import { Routes } from '@/router'
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'

import {
    showAlbumContextMenu,
    showArtistContextMenu,
    showTrackContextMenu as showContext,
} from '@/helpers/contextMenuHandler'
import useSearchStore from '@/stores/search'

import ArtistName from '@/components/shared/ArtistName.vue'
import CardTypeLabel from '@/components/shared/CardTypeLabel.vue'
import { paths } from '@/config'
import { Album, Artist, Track } from '@/interfaces'
import { formatSeconds } from '@/utils'

import PlayBtn from '@/components/shared/PlayBtn.vue'
import { playSources } from '@/enums'
import { formatDate } from '@/utils/dates'

const search = useSearchStore()

const { top_results } = storeToRefs(search)

const res_type = computed(() => {
    return top_results.value.top_result.type as 'album' | 'artist' | 'track'
})

type It = Album & Artist & Track

const item = computed(() => {
    return top_results.value.top_result as It
})

const context_menu_showing = ref(false)

// Right-click or long-press anywhere on the card opens the menu for its result type.
function onContextMenu(e: MouseEvent) {
    switch (res_type.value) {
        case 'track':
            showContext(e, item.value as Track, context_menu_showing)
            break
        case 'album':
            showAlbumContextMenu(e, context_menu_showing, item.value as Album)
            break
        case 'artist':
            showArtistContextMenu(e, context_menu_showing, item.value.artisthash, item.value.name)
            break
    }
}
</script>

<style lang="scss">
// Shape, frame, shadow, hatch, hover and arrival live in the shared anatomy
// (Global/cards.scss). Only what makes this tile the TOP one stays here.
.top-result-item {
    // A row tile's width. It stands alone, so nothing else sizes it — without
    // this it would stretch to the header column's max-content.
    width: $cardwidth;

    .name {
        font-size: 1.15rem;
        font-weight: 700;
        color: $candy-text;
    }

    .meta {
        font-size: 0.8rem;
        font-weight: 500;
        color: $candy-text-muted;
    }

    // The album and track lines put ArtistName next to plain text. It renders
    // a block inside, so in normal flow the date or the duration broke onto a
    // line of its own — or, under `.ellip`, was cut off after the "•". One
    // flex line instead: the artists shrink and truncate, the rest stays whole.
    .meta.with-artists {
        display: flex;
        gap: 0.3em;
        white-space: nowrap;

        // ArtistName's own root is a <span> too, hence the :not().
        > span:not(.artistname) {
            flex-shrink: 0;
        }

        .artistname {
            min-width: 0;
        }
    }

    // Phones stack the tile ABOVE the tracks, and upright it is 320px tall —
    // the list started below the fold. Same three parts, laid sideways: the
    // artwork left, label and plate beside it. (The old card had a compact
    // phone layout for the same reason.)
    @include largePhones {
        width: 100%;
        grid-template-columns: 7rem minmax(0, 1fr);
        grid-template-rows: 1fr max-content;
        grid-template-areas:
            'art label'
            'art plate';
        column-gap: 1rem;
        row-gap: $small;

        .card-type-label {
            grid-area: label;
            align-self: end;
        }

        .card-art {
            grid-area: art;

            // The tile's 52px disc covered a quarter of this 112px artwork,
            // and on touch it is always shown. The app's 44px touch floor,
            // tucked into the corner.
            .play-btn {
                width: 2.75rem;
                right: 0.35rem;
                bottom: 0.35rem;
            }
        }

        .card-plate {
            grid-area: plate;
        }
    }
}
</style>
