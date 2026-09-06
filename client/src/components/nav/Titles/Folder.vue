<template>
    <div id="folder-nav-title">
        <div class="fname">
            <div
                class="icon"
                @click="
                    $router.push({
                        name: Routes.folder,
                        params: { path: '$home' },
                    })
                "
            >
                <FolderSvg />
            </div>
            <BreadCrumbNav @navigate="navigate" />
        </div>
        <!-- Two controls, not one grouped control: folders and tracks have
             INDEPENDENT sort keys, and a single dropdown can only display one
             current value. Folders first, because they render above the
             tracks on the page. -->
        <DropDown
            :items="folderItems"
            :current="currentFolderSort"
            component_key="sortbar"
            :reverse="folder.folderSortReverse"
            @item-clicked="handleFolderSortKeySet"
        />
        <DropDown
            :items="items"
            :current="current"
            component_key="sortbar"
            :reverse="folder.trackSortReverse"
            @item-clicked="handleSortKeySet"
        />
    </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'

import { Routes } from '@/router'

import FolderSvg from '@/assets/icons/folder.svg'
import BreadCrumbNav from '@/components/FolderView/BreadCrumbNav.vue'
import DropDown from '@/components/shared/DropDown.vue'
import useFolder from '@/stores/pages/folder'
import { computed } from 'vue'

const router = useRouter()
const folder = useFolder()

function navigate(path: string) {
    router.push({ name: Routes.folder, params: { path } })
}

interface SortItem {
    key: string
    title: string
}

const items: SortItem[] = [
    { key: 'default', title: 'Default' },
    { key: 'title', title: 'Title' },
    { key: 'album', title: 'Album' },
    // { key: 'albumartists', title: 'Album Artist' },
    { key: 'artists', title: 'Artist' },
    // { key: 'bitrate', title: 'Bitrate' },
    { key: 'date', title: 'Release Date' },
    // { key: 'disc', title: 'Disc' },
    // { key: 'duration', title: 'Duration' },
    { key: 'last_mod', title: 'Date Added' },
    { key: 'lastplayed', title: 'Last Played' },
    { key: 'playcount', title: 'Play Count' },
    { key: 'playduration', title: 'Play Duration' },
]

// Exactly the keys the backend accepts for `sortfoldersby` — anything else is
// silently ignored there, which would look like a broken control.
const folderItems: SortItem[] = [
    { key: 'name', title: 'Folder name' },
    { key: 'lastmod', title: 'Folder date' },
    { key: 'trackcount', title: 'Folder tracks' },
]

const handleSortKeySet = (item: SortItem) => {
    folder.setFolderTrackSortKey(item.key)
}

const handleFolderSortKeySet = (item: SortItem) => {
    folder.setFolderSortKey(item.key)
}

const current = computed(() => {
    return items.find(item => item.key === folder.trackSortBy) || items[0]
})

const currentFolderSort = computed(() => {
    return folderItems.find(item => item.key === folder.folderSortBy) || folderItems[0]
})
</script>

<style lang="scss">
// One row, laid out in the flow: breadcrumb on the left, the two sort
// dropdowns on the right.
//
// They used to be `position: absolute; top: 1rem; right: 0` — a placement that
// only ever worked while there was ONE of them. #296 added the folder sort next
// to the track sort and both landed on the identical rect (measured 227,109
// 144x32 twice), so the two labels printed on top of each other ("FOEDAUENAME")
// and the folder sort was unreachable. Being out of the flow also meant the row
// had no margin of its own: the box overlapped the content card's top border
// and ran flush into its right edge.
//
// A grid instead, so the dropdowns have a track to sit in and the breadcrumb
// gets what is left. `margin-right: 10rem // sortbar width` and the two
// `!important` overrides (here and in NavBar.vue `.left`) existed purely to
// compensate for the absolute positioning and are gone with it.
#folder-nav-title {
    width: 100%;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 9rem 9rem;
    align-items: center;
    gap: $small;
    padding: $medium 0;

    @include allPhones {
        // Two dropdowns of 9rem plus the path do not fit a 390px phone, so the
        // path takes the first row and the dropdowns share the second.
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);

        .fname {
            grid-column: 1 / -1;
        }
    }

    .fname {
        // Hug the path instead of stretching the pill across its whole track.
        justify-self: start;
        background-color: $gray5;
        border-radius: $small;
        height: 2.188rem;
        display: flex;
        align-items: center;
        max-width: 100%;
        overflow: auto;
        overflow-y: hidden;
        -webkit-overflow-scrolling: touch;

        .icon {
            aspect-ratio: 1;
            margin: 0 $small;
            display: flex;

            svg {
                height: 1.5rem;
            }
        }
    }
}

.fname {
    scrollbar-width: none;

    &::-webkit-scrollbar {
        display: none;
    }
}
</style>
