<template>
    <div class="folder-view v-scroll-page" style="height: 100%" :class="{ isSmall, isMedium, is_alt_layout }">
        <NoItems
            :flag="folder.tracks.length === 0 && folder.dirs.length === 0"
            :title="folder.query === '' ? 'Folder is empty' : 'No results found'"
            :description="
                folder.query === ''
                    ? 'The folder you are trying to access has no indexed tracks. Please add tracks to this folder and try again'
                    : `
      No tracks or folders in this immediate directory matched the query: '${folder.query}'`
            "
            :icon="FolderSvg"
        />
        <DynamicScroller
            id="contentscroller"
            :items="scrollerItems"
            :min-item-size="72"
            class="scroller"
            style="height: 100%"
        >
            <template #before v-if="is_alt_layout || isMedium || isSmall">
                <Folder />
            </template>

            <template #default="{ item, index, active }">
                <DynamicScrollerItem
                    :item="item"
                    :active="active"
                    :size-dependencies="[item.props]"
                    :data-index="index"
                >
                    <component
                        :is="item.component"
                        :key="index"
                        v-bind="item.props"
                        @playThis="playFromPage(item.props.index - 1)"
                    ></component>
                </DynamicScrollerItem>
            </template>
        </DynamicScroller>
    </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute } from 'vue-router'

import { isMedium, isSmall, track_limit } from '@/stores/content-width'
import useFolder from '@/stores/pages/folder'
import useQueue from '@/stores/queue'
import useTracklist from '@/stores/queue/tracklist'
import useSettings from '@/stores/settings'

import { dropSources } from '@/enums'
import { Track, subPath } from '@/interfaces'
import { createTrackProps } from '@/utils'
import updatePageTitle from '@/utils/updatePageTitle'

import FolderSvg from '@/assets/icons/folder.svg'
import FolderList from '@/components/FolderView/FolderList.vue'
import Folder from '@/components/nav/Titles/Folder.vue'
import NoItems from '@/components/shared/NoItems.vue'
import SongItem from '@/components/shared/SongItem.vue'
import AlbumsFetcher from '@/components/ArtistView/AlbumsFetcher.vue'
import { getFiles } from '@/requests/folders'
import { trackBandFade } from '@/utils/songItemMethods'

const queue = useQueue()
const folder = useFolder()
const settings = useSettings()
const tracklist = useTracklist()

// `settings.is_alt_layout` is not a setting, it is `content_width > 900`. The
// `|| !xl` this used to carry could never contribute: `xl` is a ComputedRef, so
// `!xl` is constantly false — and it was never needed either, because
// `isMedium`/`isSmall` cover everything up to 950 and this covers everything
// above 900, so the head always has a home (see the `#before` slot).
const is_alt_layout = computed(() => settings.is_alt_layout)

interface ScrollerItem {
    id: any
    component: typeof FolderList | typeof SongItem | typeof AlbumsFetcher
    props: any
}

class songItem {
    id: string | undefined
    props: any
    component = SongItem

    constructor(track: Track, is_first = false, is_last = false, band_fade = 1) {
        this.id = track.filepath
        this.props = { ...createTrackProps(track), is_first, is_last, source: dropSources.folder, band_fade }
    }
}

const scrollerItems = computed(() => {
    const items: ScrollerItem[] = []

    if (folder.dirs.length) {
        items.push({
            id: 'folder-list',
            component: FolderList,
            props: {
                folders: folder.dirs,
            },
        })
    }

    folder.tracks.forEach((track, i) => {
        // trackTotal is the folder's REAL count; the loaded window grows page
        // by page, and normalising against it would re-shade every row on each
        // fetch.
        items.push(new songItem(track, i === 0, i === folder.tracks.length - 1, trackBandFade(i + 1, folder.trackTotal)))
    })

    if (folder.tracks.length >= track_limit.value) {
        items.push({
            id: Math.random(),
            component: AlbumsFetcher,
            props: {
                fetch_callback: () => folder.fetchAll(folder.path),
            },
        })
    }

    return items
})

async function playFromPage(index: number) {
    let tracks = folder.allTracks

    if (folder.trackTotal !== folder.allTracks.length) {
        const { tracks: newTracks } = await getFiles(folder.path, 0, -1, true, {
            sorttracksby: folder.trackSortBy,
            tracksort_reverse: folder.trackSortReverse,
            sortfoldersby: folder.folderSortBy,
            foldersort_reverse: folder.folderSortReverse,
        })
        tracks = newTracks
    }

    tracklist.setFromFolder(folder.path, tracks)
    queue.play(index)
}

onBeforeRouteUpdate((to, from) => {
    folder
        .fetchAll(to.params.path as string, true)

        .then(() => {
            folder.resetQuery()
        })
        .then(async () => {
            await nextTick()

            document.getElementById('contentscroller')?.scrollTo({
                top: 0,
            })
        })
})

onBeforeRouteLeave(() => {
    folder.resetAll()
})

onMounted(() => {
    updatePageTitle('Folders')
})
</script>

<style lang="scss">
// Every layout that renders the head INSIDE the scroller, i.e. the same
// condition as the `#before` slot in the template. Scoping this to
// `.is_alt_layout` alone (as it was) left the medium and phone layouts with a
// head that had no surface at all — breadcrumb text straight on the doodled
// ground, against the veil rule, and not sticky either.
.folder-view.is_alt_layout,
.folder-view.isMedium,
.folder-view.isSmall {
    .scroller {
        // The head used to bleed into the card's top edge. It is a plate now and
        // owns the air on both of its sides itself (`margin` below) — putting
        // that air here instead would make the resting gap depend on how the
        // engine clamps a sticky element: Blink contracts the constraint rect by
        // the scroller's padding, the spec says the scrollport, and the plate
        // would sit tight against the card's frame in one of the two.
        padding-top: 0 !important;
    }

    // This wrapper only carries the sticky behaviour — the plate itself is the
    // head inside it (see below).
    //
    // The plate's own margins have to live inside this wrapper's CONTENT box.
    // vue-virtual-scroller sizes the slot through a ResizeObserver, whose box is
    // the content box, and places the rows right after it: `padding` here is
    // invisible to it (measured: the rows started 8px INSIDE that padding), and
    // a plain margin on the plate would collapse straight through this wrapper.
    // `flow-root` opens a block formatting context, so both margins stay inside
    // and count — and they travel WITH the plate when it sticks, which is what
    // keeps the gaps identical at rest and while stuck in any engine.
    .scroller > div.vue-recycle-scroller__slot:first-child {
        display: flow-root;
        position: sticky;
        // Zero, deliberately: a `top` offset shifts this wrapper DOWN off its
        // flow position while the rows stay where the flow put them, so it eats
        // exactly the gap the plate's bottom margin sets up.
        top: 0;
        z-index: 1;
    }

    // The breadcrumb head is CHROME over a scrolling list, so it wears the plate
    // anatomy every other sticky head wears (see LyricsView/Head.vue): opaque
    // panel surface, an ink frame on ALL FOUR sides, the shared radius and the
    // offset shadow. Opaque matters twice over — rows pass behind it, and the
    // veil would show them through its own text.
    //
    // It used to be a bare $mem-ground fill on the wrapper with nothing but a
    // `border-bottom`. A single line only reads as an edge when it runs into the
    // card's frame at both ends, and this one never could: the scroller carries
    // $alt_layout_pad of side padding, so the line stopped 44px short of the ink
    // frame on each side and floated there. Three pixels below it the folder
    // plate opened its OWN frame, so the two printed as one 6px double rule.
    // Hence a closed plate instead of half an edge.
    #folder-nav-title {
        // Air on both sides belongs to the plate, not to the scroller around it:
        // the plate keeps it when it sticks.
        margin: $small 0;
        padding: $small $medium;
        @include candy-box;
        @include candy-shadow(3px, 3px);
    }
}
</style>
