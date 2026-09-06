<template>
    <div class="search-tracks-view">
        <NoItems
            :title="'No track results'"
            :description="desc"
            :icon="SearchSvg"
            :flag="!search.tracks.value.length"
        />
        <!-- `v-scroll-page` + `scroller` is the shared anatomy every other
             virtualised page uses (the sibling tabs in CardGridPage.vue do the
             same). It carries the page insets AND the player-bar reserve; this
             view used to restate half of it by hand and got the reserve wrong. -->
        <div class="v-scroll-page" :class="{ isSmall, isMedium }" style="height: 100%">
            <RecycleScroller
                id="songlist-scroller"
                class="scroller"
                v-slot="{ item, index }"
                style="height: 100%"
                :items="scrollerItems"
                :item-size="SONG_ROW_HEIGHT"
                key-field="id"
            >
                <component :is="item.component" v-bind="item.props" @playThis="playFromSearch(index)" />
            </RecycleScroller>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { isMedium, isSmall } from '@/stores/content-width'

import { dropSources } from '@/enums'
import useQueue from '@/stores/queue'
import useTracklist from '@/stores/queue/tracklist'
import useSearch from '@/stores/search'

import SearchSvg from '@/assets/icons/search.svg'
import AlbumsFetcher from '@/components/ArtistView/AlbumsFetcher.vue'
import NoItems from '@/components/shared/NoItems.vue'
import SongItem from '@/components/shared/SongItem.vue'
import { SONG_ROW_HEIGHT } from '@/utils/songItemMethods'

const queue = useQueue()
const search = useSearch()
const tracklist = useTracklist()

const desc = computed(() =>
    search.query === '' ? 'Start typing to search for tracks' : `Track results for '${search.query}' should appear here`
)

interface scrollerItem {
    id: string | number | undefined
    component: typeof SongItem | typeof AlbumsFetcher
    props: Record<string, any>
}

const scrollerItems = computed(() => {
    const items: scrollerItem[] = search.tracks.value.map((track, index) => ({
        id: index,
        component: SongItem,
        props: {
            track,
            index: index + 1,
            is_first: index === 0,
            // Keep the frame open at the bottom while more paginated results
            // exist — the closing cap only lands on the true last result.
            is_last: !search.tracks.more && index === search.tracks.value.length - 1,
            source: dropSources.search,
        },
    }))

    if (search.tracks.more) {
        items.push({
            // set to random to force re-render
            id: Math.random(),
            component: AlbumsFetcher,
            props: {
                fetch_callback: search.loadTracks,
            },
        })
    }

    return items
})

function playFromSearch(index: number) {
    tracklist.setFromSearch(search.query, search.tracks.value)
    queue.play(index)
}
</script>

<style lang="scss">
.search-tracks-view {
    height: 100%;

    .no-scroll {
        height: 100%;
    }

    // No padding rules here: insets and the player-bar reserve come from
    // `.v-scroll-page .scroller` in app-grid.scss. The hand-written copy that
    // stood here reserved 4rem against a 5.125rem bar — the exact defect #307
    // fixed for every other virtualised page, still sitting in the one view
    // that had opted out of the shared selector.
}
</style>
