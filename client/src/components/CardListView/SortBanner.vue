<template>
    <!-- One sort menu, like the Playlists page (2026-11-26). It replaced a row of
         eleven chips that wrapped into four rows on a phone. -->
    <div class="list-sort">
        <DropDown
            :items="options"
            :current="current"
            component_key="list-sort"
            prefix="Sort: "
            :reverse="store.reverse"
            @item-clicked="setSort"
        />
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { Routes } from '@/router'
import { useAlbumList, useArtistList } from '@/stores/pages/itemlist'
import { nextSortQuery } from '@/utils/sortMenu'

import DropDown from '@/components/shared/DropDown.vue'

const route = useRoute()
const router = useRouter()
const isAlbums = route.name === Routes.AlbumList
const store = isAlbums ? useAlbumList() : useArtistList()

const shared = [
    { key: 'trackcount', title: 'No. of tracks' },
    { key: 'duration', title: 'Duration' },
    { key: 'created_date', title: 'Date added' },
    { key: 'lastplayed', title: 'Last played' },
    { key: 'playcount', title: 'Plays' },
    { key: 'playduration', title: 'Play duration' },
]

const albumItems = [
    { key: 'title', title: 'Title' },
    { key: 'albumartists', title: 'Artist' },
    { key: 'date', title: 'Year released' },
]

const artistItems = [
    { key: 'name', title: 'Name' },
    { key: 'albumcount', title: 'No. of albums' },
]

const options = [...(isAlbums ? albumItems : artistItems), ...shared]

// Text keys start A to Z; everything else starts with the most (or newest).
const TEXT_KEYS = ['title', 'albumartists', 'name']

// A key the menu does not know (a hand-edited URL) still names something.
const current = computed(() => options.find(o => o.key === store.sortby) ?? { key: store.sortby, title: store.sortby })

// The sort lives in the URL; AlbumListView's route guard reads it into the
// store and reloads the list.
function setSort(item: { key: string }) {
    router.replace({
        name: route.name as string,
        query: nextSortQuery({ sortby: store.sortby, reverse: store.reverse }, item.key, TEXT_KEYS),
    })
}
</script>

<style lang="scss">
// The head above (ListHeader) gives the page its start, so the row adds no
// top padding; the gap below separates it from the first row of cards.
.list-sort {
    display: flex;
    padding-bottom: 1.5rem;

    .smdropdown {
        width: 13rem;
    }
}

// The open menu hangs over the card rows below. Every row of the scroller is a
// positioned sibling, and a later one paints over an earlier one, so the row
// holding the menu has to stand above them (as TrackRating's picker does).
.vue-recycle-scroller__item-view:has(.list-sort) {
    z-index: 40;
}
</style>
