<template>
    <div id="p-view" class="content-page" :style="{ background: brandGradient() }">
        <Header>
            <!-- The search field leads the head on the line of the actions;
                 on a phone the head is empty (actions in the top bar) and the
                 field stands above the chips instead. -->
            <template v-if="totalCount && !isMobile" #lead>
                <ListFind v-model="search" field-id="playlists-search" placeholder="Search playlists" />
            </template>
            <template #description>
                You have {{ pStore.playlists.length }} playlists in your library
            </template>
            <template #right>
                <!-- On mobile the in-view header collapses; New Playlist lives as
                     a contextual action in the top bar (see NavBar headerAction). -->
                <button v-if="!isMobile" class="playlist-button" @click="showNewPlaylistModal()">
                    <PlusSvg /> New Playlist
                </button>
                <!-- A set of rules instead of a list of tracks (#642). On a phone the
                     top bar carries both actions (see NavBar headerActions). -->
                <button v-if="!isMobile" class="playlist-button" @click="showSmartPlaylistEditor()">
                    <SparklesSvg /> New smart playlist
                </button>
            </template>
        </Header>

        <div v-if="totalCount && isMobile" class="playlist-search">
            <ListFind v-model="search" field-id="playlists-search" placeholder="Search playlists" />
        </div>
        <PlaylistSortBar v-if="totalCount" />

        <PlaylistCardGroup v-if="shownSmart.length" :title="'Smart playlists'">
            <SmartPlaylistCard v-for="p in shownSmart" :key="p.id" :playlist="p" />
        </PlaylistCardGroup>
        <PlaylistCardGroup v-if="shownPinned.length" :playlists="shownPinned" :title="'Pinned'" />
        <PlaylistCardGroup
            v-if="shownOther.length"
            :playlists="shownOther"
            :title="`${pinnedPlaylists.length ? 'Other' : 'All'} Playlists`"
        />
        <NoItems
            :flag="!totalCount || !shownCount"
            :icon="PlaylistSvg"
            :title="totalCount ? `No playlists match “${search.trim()}”` : 'No playlists found'"
            :description="totalCount ? '' : description"
        />
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

import usePStore from '@/stores/pages/playlists'
import useSmartPlaylistsStore from '@/stores/pages/smartPlaylists'
import { isMobile } from '@/stores/content-width'
import updatePageTitle from '@/utils/updatePageTitle'
import {
  matchesPlaylistSearch,
  readPlaylistSortQuery,
  sortPlaylists,
  sortSmartPlaylists,
} from '@/utils/playlistSort'

import PlaylistSvg from '@/assets/icons/playlist-1.svg'
import PlusSvg from '@/assets/icons/plus.svg'
import SparklesSvg from '@/assets/icons/sparkles.svg'
import PlaylistCardGroup from '@/components/PlaylistsList/PlaylistCardGroup.vue'
import PlaylistSortBar from '@/components/PlaylistsList/PlaylistSortBar.vue'
import ListFind from '@/components/shared/ListFind.vue'
import SmartPlaylistCard from '@/components/PlaylistsList/SmartPlaylistCard.vue'
import Header from '@/components/shared/GenericHeader.vue'
import { brandGradient } from '@/utils/colortools/pageGradient'
import NoItems from '@/components/shared/NoItems.vue'
import useModalStore from '@/stores/modal'

const pStore = usePStore()
const smartStore = useSmartPlaylistsStore()
const { showNewPlaylistModal, showSmartPlaylistEditor } = useModalStore()

const smartPlaylists = computed(() => smartStore.playlists)

const description = `You can create a playlist by right clicking on a track and selecting the
        "Add to Playlist" option`

// TODO: When you add a song to playlist when you are in this page, increase the count on the card.

// The search term is local to the page (not in the URL); the sort state is in
// the URL and read here, so the banner and the lists always agree.
const search = ref('')
const route = useRoute()
const sort = computed(() => readPlaylistSortQuery(route.query))

// The library, unfiltered: the group captions and the "no playlists" state
// depend on it, not on what the search shows.
const pinnedPlaylists = computed(() => {
    return pStore.playlists.filter(p => p.pinned)
})
const playlists = computed(() => pStore.playlists.filter(p => !p.pinned))
const totalCount = computed(
    () => smartPlaylists.value.length + pStore.playlists.length,
)

// What the page shows: filtered by the search, then sorted within each group.
// The sorted copies never touch the store's arrays (the sidebar shares them).
const shownSmart = computed(() =>
    sortSmartPlaylists(
        smartPlaylists.value.filter(p => matchesPlaylistSearch(p.name, search.value)),
        sort.value.sortby,
        sort.value.reverse,
    ),
)
const shownPinned = computed(() =>
    sortPlaylists(
        pinnedPlaylists.value.filter(p => matchesPlaylistSearch(p.name, search.value)),
        sort.value.sortby,
        sort.value.reverse,
    ),
)
const shownOther = computed(() =>
    sortPlaylists(
        playlists.value.filter(p => matchesPlaylistSearch(p.name, search.value)),
        sort.value.sortby,
        sort.value.reverse,
    ),
)
const shownCount = computed(
    () => shownSmart.value.length + shownPinned.value.length + shownOther.value.length,
)

onMounted(() => {
    updatePageTitle('Playlists')
})
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

        // On the phone the shared card gaps, like the Favorites rows one tab
        // over: with 1rem the tiles here were wider and closer together than
        // there, and switching tabs made them jump (user, 2026-10-24).
        @include mediumPhones {
            grid-template-columns: repeat(auto-fill, minmax(var(--tile-min-phone, 8.5rem), 1fr));
            gap: $card-row-gap $card-col-gap;
        }
    }

    .playlist-button {
        padding-right: $medium;
    }

    // Phone only: the field stands above the chips, full width, with the same
    // gap below it as between the chip rows.
    .playlist-search {
        display: flex;
        margin-bottom: 1rem;

        .list-find {
            flex: 1 1 auto;
        }
    }

    .nothing {
        height: 50%;

        svg {
            margin-bottom: 0;
        }
    }
}
</style>
