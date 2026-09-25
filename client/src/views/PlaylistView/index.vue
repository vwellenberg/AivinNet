<template>
    <div class="folder-view v-scroll-page" style="height: 100%; position: relative;" :class="{ isSmall, isMedium }"
        :style="{ '--page-gradient': pageGradient(playlist.colors.bg) }"
        @dragover="onScrollerDragOver"
        @dragleave="onScrollerDragLeave"
        @drop="stopAutoScroll"
        @dragend="stopAutoScroll">
        <!-- The edit mode (grips to reorder, buttons to remove) is a plain,
             non-virtual list: a row in the hand must not be recycled while the
             list scrolls under it. Same id, so the one auto-scroll helper and
             the veil's scroll handler find it. -->
        <div v-if="playlist.editing" id="contentscroller" class="scroller p-edit-scroller">
            <Header />
            <AfterHeader editing caps_list :count="playlist.allTracks.length" @done="playlist.stopEditing()" />
            <EditList />
        </div>
        <DynamicScroller
            v-else
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
                        @edit="playlist.startEditing()"
                    ></component>
                </DynamicScrollerItem>
            </template>
        </DynamicScroller>
    </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { onBeforeUnmount } from 'vue'

import { isMedium, isSmall, isSmallPhone } from '@/stores/content-width'
import { dropSources } from '@/enums'
import useQueue from '@/stores/queue'
import useTracklist from '@/stores/queue/tracklist'
import usePlaylistStore from '@/stores/pages/playlist'

import updatePageTitle from '@/utils/updatePageTitle'

import playlistSvg from '@/assets/icons/playlist.svg'
import Header from '@/components/PlaylistView/Header.vue'
import NoItems from '@/components/shared/NoItems.vue'
import SongItem from '@/components/shared/SongItem.vue'
import AfterHeader from '@/components/PlaylistView/AfterHeader.vue'
import EditList from '@/components/PlaylistView/EditList.vue'
import { onBeforeRouteLeave, useRoute } from 'vue-router'
import AlbumsFetcher from '@/components/ArtistView/AlbumsFetcher.vue'
import { movePlaylistTrackTo } from '@/helpers/playlistTrackEdits'
import { Track } from '@/interfaces'
import { pageGradient } from '@/utils/colortools/pageGradient'
import { createDragAutoScroller } from '@/utils/dragAutoScroll'
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

// Only regular (numeric-id) playlists are STORED: they carry per-track
// added_at, and their order is the user's to change. The custom
// "recentlyadded"/"recentlyplayed" playlists served through this view are
// computed by the server — no "Date added" column, no edit mode.
const isStoredPlaylist = computed(() => /^\d+$/.test(route.params.pid as string))

interface ScrollerItem {
    id: string | number
    component: typeof Header | typeof AfterHeader | typeof SongItem | typeof NoItems | typeof AlbumsFetcher
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
            show_date_added: isStoredPlaylist.value,
            caps_list: captionCapsList,
            editable: isStoredPlaylist.value && playlist.allTracks.length > 0,
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
                show_date_added: isStoredPlaylist.value,
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

    // The move itself — anchors, optimistic reorder, rollback, queue mirror —
    // is shared with the edit mode (helpers/playlistTrackEdits.ts).
    await movePlaylistTrackTo(oldIndex, newIndex)
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

// The name arrives with the fetch, not with the mount: this component is
// reused across playlists (the route param changes, setup does not re-run), so
// reading the store once would name the PREVIOUS playlist forever. Watch the
// name itself — that also covers a rename while the page is open.
watch(
    () => playlist.info.name,
    name => updatePageTitle(name || ''),
    { immediate: true }
)

onBeforeUnmount(() => stopAutoScroll())

onBeforeRouteLeave(() => {
    stopAutoScroll()
    // At once, not with resetAll's delayed reset: the edit mode also hides the
    // player bar on a phone (App.vue), and the next page must not open without
    // it. Unmounting EditList settles any removal still waiting for its undo.
    playlist.stopEditing()
    playlist.resetAll()
})
</script>

<style lang="scss">
// The edit mode's plain scroller (see the template). It stands in for the
// virtual scroller, which gets its left inset and gutter from
// `.vue-recycle-scroller` (app-grid.scss) — the same box, so the header does
// not jump sideways when the mode switches.
.p-edit-scroller {
    overflow-y: auto;
    scrollbar-gutter: stable both-edges;
    padding-left: $padleft;

    // The caption bar stays in reach while the list scrolls under it: "Done"
    // must be one tap away anywhere in a long list. Its top padding is the gap
    // to the header, so it sticks that much above the edge and the bar itself
    // lands on it.
    > .p-after-header {
        position: sticky;
        top: calc(-1 * #{$medium});
        z-index: 6;
    }
}

.playlist-virtual-scroller {
    .nothing {
        height: 25rem;
    }
}
</style>
