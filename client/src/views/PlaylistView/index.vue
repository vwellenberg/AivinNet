<template>
    <div class="folder-view v-scroll-page" style="height: 100%; position: relative;" :class="{ isSmall, isMedium }"
        :style="{ '--page-gradient': pageGradient(playlist.colors.bg) }"
        @dragover="onScrollerDragOver"
        @dragleave="onScrollerDragLeave"
        @drop="stopAutoScroll"
        @dragend="stopAutoScroll">
        <DynamicScroller
            id="contentscroller"
            :items="scrollerItems"
            :min-item-size="72"
            class="scroller"
            style="height: 100%"
        >
            <template #default="{ item, index, active }">
                <DynamicScrollerItem
                    :item="item"
                    :active="active"
                    :size-dependencies="[item.id, item.size]"
                    :data-index="index"
                >
                    <component
                        :is="item.component"
                        :key="item.id"
                        v-bind="item.props"
                        @playThis="playFromPlaylistPage(item.props.index - 1)"
                        @trackDropped="onTrackDropped"
                    ></component>
                </DynamicScrollerItem>
            </template>
        </DynamicScroller>
    </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { onBeforeUnmount, onMounted, onUpdated } from 'vue'

import { isMedium, isSmall, isSmallPhone } from '@/stores/content-width'
import { dropSources, FromOptions } from '@/enums'
import useQueue from '@/stores/queue'
import useTracklist from '@/stores/queue/tracklist'
import usePlaylistStore from '@/stores/pages/playlist'

import updatePageTitle from '@/utils/updatePageTitle'

import playlistSvg from '@/assets/icons/playlist.svg'
import Header from '@/components/PlaylistView/Header.vue'
import NoItems from '@/components/shared/NoItems.vue'
import SongItem from '@/components/shared/SongItem.vue'
import AfterHeader from '@/components/PlaylistView/AfterHeader.vue'
import { onBeforeRouteLeave, useRoute } from 'vue-router'
import AlbumsFetcher from '@/components/ArtistView/AlbumsFetcher.vue'
import { movePlaylistTrack } from '@/requests/playlists'
import { Track } from '@/interfaces'
import { pageGradient } from '@/utils/colortools/pageGradient'
import { createDragAutoScroller } from '@/utils/dragAutoScroll'
import { resolveMove } from '@/utils/playlistMove'
import { rangeAligns } from '@/utils/queueMove'
import { trackBandFade } from '@/utils/songItemMethods'

const queue = useQueue()
const tracklist = useTracklist()
const playlist = usePlaylistStore()
const route = useRoute()

watch(() => route.params.pid, async (newPid, oldPid) => {
    if (newPid && newPid !== oldPid) {
        playlist.resetTracks()
        await playlist.fetchAll(parseInt(newPid as string))
    }
})

// Only regular (numeric-id) playlists carry per-track added_at; the custom
// "recentlyadded"/"recentlyplayed" playlists served through this view don't,
// so they keep the plain layout without the "Date added" column.
const supportsDateAdded = computed(() => /^\d+$/.test(route.params.pid as string))

interface ScrollerItem {
    id: string | number
    component: typeof Header | typeof SongItem | typeof NoItems | typeof AlbumsFetcher
    size: number
    props?: {}
}

const getNoItemsComponent = () =>
    <ScrollerItem>{
        id: 'Noitems',
        component: NoItems,
        size: 300, // somehow it doesn't work, patched with CSS
        props: {
            icon: playlistSvg,
            flag: playlist.tracks.length === 0,
            title: 'No tracks in this playlist',
            description: 'Add tracks to this playlist by right clicking on a track and selecting "add to playlist"',
        },
    }

const scrollerItems = computed(() => {
    const header: ScrollerItem = {
        id: 'header',
        component: Header,
        size: isSmallPhone.value ? 24 * 16 : 18 * 16,
    }

    // The caption row caps the track list's ink frame whenever there IS a list
    // under it (AfterHeader `.caps-list`). Computed once and read twice — the
    // cap and the rows' `is_first` are two halves of one decision, and letting
    // them drift apart is what puts a rounded corner under a straight bar.
    const captionCapsList = playlist.tracks.length > 0

    const afterHeader: ScrollerItem = {
        id: 'afterHeader',
        component: AfterHeader,
        // This is a DynamicScroller: it MEASURES each item, so `size` is only
        // the estimate used before the first measurement (and a
        // `size-dependencies` trigger). It does not have to be exact — but it
        // does have to include the gap above the caption, which is why that gap
        // is PADDING inside AfterHeader rather than a margin. A margin sits
        // outside `getBoundingClientRect().height`, so the scroller would stack
        // the first track row 12px too high and the bar would cover its top
        // edge. Measured before the fix; see the note in AfterHeader.vue.
        //
        //   cap   2.4rem bar + $medium (0.75rem) padding
        //   plain 4rem   bar + $small  (0.5rem)  padding
        size: captionCapsList ? 3.15 * 16 : 4.5 * 16,
        props: {
            show_date_added: supportsDateAdded.value,
            caps_list: captionCapsList,
        },
    }

    const tracks = playlist.tracks.map((track, i) => {
        return {
            // Key by position (track.index = Fuse refIndex), like every other
            // track list in the app (the queue panel, the search tracks tab,
            // ...). filepath is NOT guaranteed unique, so a duplicate entry
            // collided on the scroller key and one row collapsed into a blank gap.
            id: track.index,
            component: SongItem,
            props: {
                track: track,
                index: track.index + 1,
                // Frame caps follow the RENDERED position (i), not track.index:
                // under an in-playlist search track.index is the refIndex into
                // the unfiltered list, so the first/last filtered row would
                // never get its cap.
                //
                // The TOP cap is the caption bar's job whenever it renders as
                // one (see captionCapsList above) — leaving it on as well would
                // round the first row's corners underneath a straight ink bar.
                // Expressed against the same flag rather than hard-coded false,
                // so the two halves cannot drift apart.
                is_first: !captionCapsList && i === 0,
                is_last: i === playlist.tracks.length - 1,
                droppable: !playlist.query,
                source: dropSources.playlist,
                show_date_added: supportsDateAdded.value,
                // Fade follows the RENDERED position (i) for the same reason
                // the frame caps do: under an in-playlist search track.index
                // points into the unfiltered list.
                band_fade: trackBandFade(i + 1, playlist.tracks.length),
            },
            size: 72,
        }
    })

    // Only show the "No tracks in this playlist" empty state once the playlist
    // has actually finished loading. On an in-place switch the route watch empties
    // the list (resetTracks) before fetchAll(newPid) resolves; rendering NoItems
    // in that transient window made the empty message flash on every switch.
    // allLoaded is false while loading and true once it completes (a genuinely
    // empty playlist has count===0 => allLoaded===true, so it still shows).
    const body =
        playlist.tracks.length > 0
            ? tracks
            : playlist.allLoaded
              ? [getNoItemsComponent()]
              : []

    // Show the infinite-scroll sentinel only after the first trackhash window
    // has been requested and more remain. Gating purely on !allLoaded rendered
    // the sentinel during the transient EMPTY window of a playlist switch: the
    // route watch runs resetTracks() (allTracks=[], allLoaded=false,
    // loadedHashCount=0) and only THEN awaits fetchAll(newPid). In that gap the
    // sentinel mounts and its onMounted fires fetch_callback ->
    // fetchAll(playlist.info.id) while info.id is STILL the previous playlist,
    // racing the watch's fetchAll(newPid). Whichever resolves last wins, so the
    // new playlist intermittently flashed "No tracks" / showed stale rows until
    // a hard reload. Gating on loadedHashCount > 0 hides the sentinel until the
    // switch's fetchAll has actually requested page 1 (cursor advanced, info.id
    // now correct), which kills the race while still paginating an
    // orphan-shortened OR all-orphan first page. Don't auto-load during a search.
    if (playlist.loadedHashCount > 0 && !playlist.allLoaded && !playlist.query) {
        body.push({
            id: 'tracks-fetcher',
            size: 1,
            component: AlbumsFetcher,
            props: {
                fetch_callback: () => playlist.fetchAll(playlist.info.id),
            },
        })
    }

    return [header, afterHeader, ...body]
})

async function onTrackDropped(source: dropSources, _track: Track, newIndex: number, oldIndex: number) {
    stopAutoScroll()

    // A row dragged in from somewhere else carries an index into THAT list —
    // a search result's position, an album's track number — and acting on it
    // would reorder this playlist by a number that means nothing here. The
    // queue view has always checked this (`views/NowPlaying/main.vue`); this
    // one took the source and ignored it.
    if (source !== dropSources.playlist) return

    // Resolve the move to trackhash anchors BEFORE mutating the list. Sending
    // the whole tracklist (the old behaviour) truncated the playlist to whatever
    // had been paginated in and dropped every orphan hash with it.
    const move = resolveMove(playlist.allTracks, oldIndex, newIndex)
    if (!move) return

    // Is the queue playing this playlist, and do its indices still line up with
    // the ones this drag is expressed in? Then the same move has to happen
    // there, or the running queue keeps playing the order the user just dragged
    // away from.
    //
    // Alignment is proven over the SLICE the move touches, by trackhash, not by
    // comparing lengths: the two lists are legitimately different lengths. The
    // page paginates (a fresh visit holds ~13 of 43 rows) while the queue was
    // built from the fully fetched list — a length test rejected every mirror in
    // the normal case and only ever passed on a playlist small enough to load in
    // one page. What actually matters is that the queue agrees with the page
    // about every row between the drag's two ends; if it does not (tracks added
    // to the queue, queue reordered on its own), mirroring by index would move
    // the wrong track, and we skip.
    const queueFrom = tracklist.from
    const mirrorToQueue =
        queueFrom?.type === FromOptions.playlist &&
        queueFrom.id === playlist.info.id &&
        rangeAligns(
            playlist.allTracks,
            tracklist.tracklist,
            Math.min(oldIndex, move.finalIndex),
            Math.max(oldIndex, move.finalIndex)
        )

    playlist.moveTrack(oldIndex, newIndex)

    const ok = await movePlaylistTrack(playlist.info.id, move.trackhash, move.beforeTrackhash)

    if (!ok) {
        // Put the row back so the list stops claiming an order the server never
        // accepted. The queue was deliberately left alone until now, so there is
        // nothing to roll back there.
        playlist.moveTrack(move.undo.from, move.undo.to)
        return
    }

    // Mirrored only after the server agreed: rolling a queue move back is not
    // free in a group session (the mutation goes out as a broadcast and comes
    // back asynchronously), and there is no reason to risk it for an order the
    // server may reject.
    if (mirrorToQueue) tracklist.moveTrack(oldIndex, newIndex)
}

// Edge auto-scroll while reordering: dragging a row near the top/bottom edge of
// the scroller scrolls the list automatically, so moving a track from the
// bottom to the top no longer means holding the drag AND touchpad-scrolling at
// once. The rAF loop lives in the utility; here we just feed it the pointer.
const autoScroller = createDragAutoScroller(() => document.getElementById('contentscroller'))

function onScrollerDragOver(e: DragEvent) {
    autoScroller.update(e.clientY)
}

function onScrollerDragLeave(e: DragEvent) {
    // dragleave bubbles up from every row the pointer crosses; keep scrolling
    // while the pointer stays inside the scroller and only stop once it truly
    // leaves it (relatedTarget outside, or null when leaving the window).
    const container = e.currentTarget as HTMLElement
    const related = e.relatedTarget as Node | null
    if (related && container.contains(related)) return
    stopAutoScroll()
}

function stopAutoScroll() {
    autoScroller.stop()
}

async function playFromPlaylistPage(index: number) {
    const { name, id } = playlist.info

    if (!playlist.allLoaded) {
        // Load the complete tracklist before building the queue. Gate on
        // allLoaded (not tracks.length !== count): an orphan trackhash keeps
        // count > resolvable tracks forever, so the old gate re-fetched on
        // every play. Await so the queue is built from the complete list.
        await playlist.fetchAll(id, false, true)
    }

    tracklist.setFromPlaylist(name, id, playlist.allTracks)
    queue.play(index)
}

;[onMounted, onUpdated].forEach(() => {
    updatePageTitle(playlist.info.name)
})

onBeforeUnmount(() => stopAutoScroll())

onBeforeRouteLeave(() => {
    stopAutoScroll()
    playlist.resetAll()
})
</script>

<style lang="scss">
.playlist-virtual-scroller {
    .nothing {
        height: 25rem;
    }
}
</style>
