<template>
    <GenericTrackPagination
        :tracks="visible"
        :desc="query ? 'No matching tracks' : `You have ${trackCount} favorited track${trackCount == 1 ? '' : 's'}`"
        :noitemsicon="BookmarkSvg"
        :more-items-loader="loadMore"
        :total="trackCount"
        @playThis="handlePlay"
    >
        <template #header>
            <GenericHeader entity="track">
                <template #name>Favorite Tracks</template>
                <template #description
                    >You have {{ trackCount }} favorited track{{ trackCount == 1 ? '' : 's' }}</template
                >
            </GenericHeader>
            <div v-if="trackCount" class="fav-find">
                <ListFind
                    :model-value="query"
                    field-id="favorites-find"
                    placeholder="Find in favorites"
                    @update:model-value="setQuery"
                />
            </div>
        </template>
    </GenericTrackPagination>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'

import useQueueStore from '@/stores/queue'
import useTracklist from '@/stores/queue/tracklist'

import { useFavoriteTracks } from '@/helpers/useFavoriteTracks'
import { useListFind } from '@/helpers/useListFind'

import GenericHeader from '@/components/shared/GenericHeader.vue'
import GenericTrackPagination from '@/components/shared/GenericTrackPagination.vue'
import ListFind from '@/components/shared/ListFind.vue'
import BookmarkSvg from '@/assets/icons/bookmark.svg'
import { track_limit } from '@/stores/content-width'
import updatePageTitle from '@/utils/updatePageTitle'

const queue = useQueueStore()
const tracklist = useTracklist()

const { trackCount, query, visible, loadMore, loadAll, setQuery, tracks } = useFavoriteTracks(
    () => track_limit.value
)

useListFind('favorites-find', 'album-scroller', () => trackCount.value > 0, {
    query: () => query.value,
    rows: () => visible.value,
    at: 'field',
})

onMounted(async () => {
    updatePageTitle('Favorites')
    await loadMore()
})

// `index` is the track's position in the full list (master_index), so this
// plays the right track even while the list is filtered.
async function handlePlay(index: number) {
    await loadAll()
    tracklist.setFromFav(tracks.value)
    queue.play(index)
}
</script>

<style lang="scss">
// The find sits under the header, on the right, with padding so the header's
// own spacing is not disturbed.
.fav-find {
    display: flex;
    justify-content: flex-end;
    padding: 0 $small $small;
}
</style>
