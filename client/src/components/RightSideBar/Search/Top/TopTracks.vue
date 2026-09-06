<template>
    <!-- ⚠️ `isSmall`/`isMedium` are not decoration: `app-grid.scss` gates the
         narrow song-row grids on these ANCESTOR classes. Without them a phone
         keeps the 4-column desktop grid, ~224px of it fixed (index, duration,
         gaps), which leaves the title about 74px. `TrackItem` was flex-based
         and shrank on its own; SongItem does not, so every sibling list opts in
         the same way (SearchView/tracks.vue, ArtistTracks, FolderView). -->
    <div class="right-search-top-tracks" :class="{ isSmall, isMedium }">
        <SongItem
            v-for="(track, index) in search.top_results.tracks"
            :key="track.id"
            :track="track"
            :index="index + 1"
            :is_first="index === 0"
            :is_last="index === search.top_results.tracks.length - 1"
            :source="dropSources.search"
            :band_fade="trackBandFade(index + 1, search.top_results.tracks.length)"
            @play-this="handlePlay(track)"
        />
    </div>
</template>

<script setup lang="ts">
/**
 * The Top tab's track rows.
 *
 * These were the last `TrackItem` rows in the app — the pre-Inlay row style,
 * still standing while the Tracks tab right next to them (`SearchView/
 * tracks.vue`) already rendered `SongItem`. Same page, same kind of result,
 * two different rows.
 *
 * `index + 1` rather than `index`: SongItem shows the number, and a list
 * starting at 0 is not one anybody counts. `band_fade` comes from the RENDERED
 * position, never from an array index that a filter could have shifted.
 */
import { Track } from '@/interfaces'
import { dropSources } from '@/enums'

import useQueueStore from '@/stores/queue'
import useTracklist from '@/stores/queue/tracklist'
import useSearchStore from '@/stores/search'
import { isMedium, isSmall } from '@/stores/content-width'

import SongItem from '@/components/shared/SongItem.vue'
import { trackBandFade } from '@/utils/songItemMethods'

const search = useSearchStore()
const queue = useQueueStore()
const tracklist = useTracklist()

function handlePlay(track: Track) {
    // Replacing the queue, not clearing it — see PlayBtn.vue: a clearQueue()
    // here would broadcast an empty group queue against the one play() sends.
    tracklist.setFromSearch(search.query, [track])
    queue.play(0)
}
</script>

<style lang="scss">
.right-search-top-tracks {
    margin-bottom: 2rem;
}
</style>
