<template>
    <RouterLink
        :to="{
            name: res_type === 'artist' ? Routes.artist : Routes.album,
            params: res_type === 'artist' ? { hash: item.artisthash || ' ' } : { albumhash: item.albumhash || ' ' },
        }"
        class="top-result-item rounded"
        @contextmenu.prevent="onContextMenu"
    >
        <img
            :src="
                res_type === 'artist' ? paths.images.artist.medium + item.image : paths.images.thumb.medium + item.image
            "
            alt=""
            class="rounded-sm"
            :class="{ circular: res_type === 'artist' }"
        />
        <div class="info" :class="{ 'is-artist': res_type === 'artist' }">
            <div class="type pad-sm rounded">{{ res_type }}</div>
            <div>
                <h3>
                    {{ res_type === 'artist' ? item.name : item.title }}
                </h3>
                <div v-if="res_type === 'album'" class="artists flex">
                    <span> {{ formatDate(item.date, true) }}</span> &nbsp; • &nbsp;
                    <ArtistName :artists="item.albumartists" :albumartists="''" />
                </div>
                <div v-if="res_type === 'artist'" class="artists flex">
                    {{ item.albumcount }}
                    {{ item.albumcount === 1 ? 'album' : 'albums' }} •
                    {{ item.trackcount }}
                    {{ item.trackcount === 1 ? 'track' : 'tracks' }}
                </div>
                <div v-if="res_type === 'track'" class="artists flex">
                    <ArtistName :artists="item.artists" :albumartists="item.albumartists" />
                    &nbsp; • &nbsp;
                    {{ formatSeconds(item.duration, true) }}
                </div>
            </div>
        </div>
        <div class="buttons">
            <span v-if="res_type !== 'track'"></span>
            <button
                v-if="res_type === 'track'"
                :class="{ context_menu_showing }"
                class="context-menu-button"
                @click.prevent="showMenu"
            >
                <Moresvg />
            </button>
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

import Moresvg from '@/assets/icons/more.svg'
import ArtistName from '@/components/shared/ArtistName.vue'
import { paths } from '@/config'
import { Album, Artist, Track } from '@/interfaces'
import { formatSeconds } from '@/utils'

import PlayBtn from '@/components/shared/PlayBtn.vue'
import { playSources } from '@/enums'
import { formatDate } from '@/utils/dates'

const search = useSearchStore()

const { top_results } = storeToRefs(search)

const res_type = computed(() => {
    return top_results.value.top_result.type
})

type It = Album & Artist & Track

const item = computed(() => {
    return top_results.value.top_result as It
})

const context_menu_showing = ref(false)

function showMenu(e: MouseEvent) {
    showContext(e, item.value as Track, context_menu_showing)
}

// Right-click anywhere on the card opens the same menu the ⋮ button shows
// (tracks), or the album/artist menu for those result types.
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
.top-result-item {
    @include candy-box($mem-panel, $candy-radius);
    // Hard offset shadow: the tile sits above the grid ground (memphis).
    @include candy-raised(3px, 3px, $press: false);
    padding: 1rem;
    display: grid;
    gap: 1rem;
    align-items: flex-end;
    margin: 1rem;
    margin-bottom: 2rem;
    position: relative;
    min-width: 22rem;
    max-width: 27rem;

    .buttons {
        position: absolute;
        right: 0;
        height: 100%;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        padding: 1rem $medium;

        .play-btn {
            width: 2.5rem;
            height: 2.5rem;
            opacity: 0;
            transition: opacity 0.2s ease-in-out, background-color 0.2s ease-out;
        }
    }

    &:hover {
        .play-btn {
            opacity: 1;
        }
    }

    // Touch devices can't hover — keep the play button reachable. Match the
    // base `.buttons .play-btn` specificity so this actually overrides it.
    @media (hover: none) {
        .buttons .play-btn {
            opacity: 1;
        }
    }

    // Overflow menu on the top search result. Rotation on the GLYPH: the
    // button's own transform belongs to the role (scale on hover / press).
    .context-menu-button {
        @include btn-quiet($size: 2.75rem);

        svg {
            transform: rotate(90deg) scale(1.2);
        }
    }

    // Open menu = yellow, the app-wide "active" signal (blush is the pointer).
    .context_menu_showing {
        background-color: $mem-yellow;
        color: $mem-ink;
    }

    img {
        width: 7.5rem;
        height: 7.5rem;
        object-fit: cover;
        border: $candy-border;
    }

    .type {
        font-size: 0.8rem;
        font-weight: 500;
        color: $candy-black;
        background-color: $candy-lavender;
        border: 1px solid $mem-line;
        border-radius: $candy-radius-pill;
        width: max-content;
        padding: 2px $small;
        text-transform: capitalize;
    }

    .info {
        display: flex;
        flex-direction: column;
        gap: 0;

        .is-artist {
            text-transform: capitalize;
        }

        .artists {
            font-size: 14px;
            font-weight: 500;
            color: $candy-text-muted;
        }

        h3 {
            margin-bottom: $small;
            margin-top: 1rem;
            font-size: 1.5rem;
        }
    }
    .is-artist {
        .artists {
            text-transform: capitalize;
            margin-bottom: 1rem;
        }

        h3 {
            margin-top: 0;
        }

        flex-direction: column-reverse;
    }

    // Mobile: compact horizontal layout — cover on the left, badge/title/meta
    // vertically centred beside it. Avoids the tall desktop card collapsing to
    // a small cover with a large empty gap below it on phones.
    @include largePhones {
        grid-template-columns: max-content 1fr;
        align-items: center;
        min-width: unset;
        max-width: 100%;
        margin: 1rem 0;
        padding: 0.85rem;

        img {
            width: 4.5rem;
            height: 4.5rem;
        }

        .info {
            // reserve room for the absolute play button on the right edge so a
            // longer title wraps before it instead of running underneath.
            padding-right: 4rem;

            h3 {
                margin-top: 0.3rem;
                margin-bottom: 0.15rem;
                font-size: 1.2rem;
            }
        }

        .buttons {
            padding: 0.85rem;
        }
    }
}
</style>
