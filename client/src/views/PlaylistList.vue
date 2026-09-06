<template>
    <div id="p-view" class="content-page" :style="{ background: brandGradient() }">
        <Header>
            <template #name>Playlists</template>
            <template #description>
                You have {{ pStore.playlists.length }} playlists in your library
            </template>
            <template #right>
                <!-- On mobile the in-view header collapses; New Playlist lives as
                     a contextual action in the top bar (see NavBar headerAction). -->
                <button v-if="!isMobile" class="playlist-button" @click="showNewPlaylistModal()">
                    <PlusSvg /> New Playlist
                </button>
            </template>
        </Header>

        <PlaylistCardGroup v-if="pinnedPlaylists.length" :playlists="pinnedPlaylists" :title="'Pinned'" />
        <PlaylistCardGroup
            v-if="playlists.length"
            :playlists="playlists"
            :title="`${pinnedPlaylists.length ? 'Other' : 'All'} Playlists`"
        />
        <NoItems
            :flag="!(playlists.length + pinnedPlaylists.length)"
            :icon="PlaylistSvg"
            :title="'No playlists found'"
            :description="description"
        />
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'

import usePStore from '@/stores/pages/playlists'
import { isMobile } from '@/stores/content-width'
import updatePageTitle from '@/utils/updatePageTitle'

import PlaylistSvg from '@/assets/icons/playlist-1.svg'
import PlusSvg from '@/assets/icons/plus.svg'
import PlaylistCardGroup from '@/components/PlaylistsList/PlaylistCardGroup.vue'
import Header from '@/components/shared/GenericHeader.vue'
import { brandGradient } from '@/utils/colortools/pageGradient'
import NoItems from '@/components/shared/NoItems.vue'
import useModalStore from '@/stores/modal'

const pStore = usePStore()
const { showNewPlaylistModal } = useModalStore()

const description = `You can create a playlist by right clicking on a track and selecting the
        "Add to Playlist" option`

// TODO: When you add a song to playlist when you are in this page, increase the count on the card.

const pinnedPlaylists = computed(() => {
    return pStore.playlists.filter(p => p.pinned)
})

onMounted(() => {
    updatePageTitle('Playlists')
})

const playlists = computed(() => pStore.playlists.filter(p => !p.pinned))
</script>

<style lang="scss">
#p-view {
    padding-bottom: $content-padding-bottom;
    height: 100%;
    overflow: auto;

    .playlist-button {
        @include btn-pill;

        svg {
            height: 1.5rem;
        }
    }

    .grid {
        grid-template-columns: repeat(auto-fill, minmax($cardwidth, 1fr));
        // Column gap from the shared token; the roomier row gap is this
        // page's own decision (Stufe B) — groups of playlist tiles breathe
        // more than the dense library grids.
        gap: 3.5rem $card-col-gap;

        @include mediumPhones {
            grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
            gap: 1rem;
        }
    }

    .playlist-button {
        padding-right: $medium;
    }

    .nothing {
        height: 50%;

        svg {
            margin-bottom: 0;
        }
    }
}
</style>
