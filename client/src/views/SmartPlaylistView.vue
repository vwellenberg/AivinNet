<template>
    <div class="folder-view v-scroll-page" style="height: 100%; position: relative;" :class="{ isSmall, isMedium }">
        <!-- Keyed by the playlist: a switch is a NEW scroller, so its rows are
             new nodes and build up again (the same reason as PlaylistView). -->
        <DynamicScroller
            id="contentscroller"
            :key="route.params.smartid"
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
                        v-bind="item.props"
                        @playThis="playThis(item.props.index - 1)"
                    ></component>
                </DynamicScrollerItem>
            </template>
        </DynamicScroller>
    </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { onBeforeRouteLeave, useRoute } from 'vue-router'

import { dropSources } from '@/enums'
import { isMedium, isSmall, isSmallPhone } from '@/stores/content-width'
import useSmartPlaylistPage from '@/stores/pages/smartPlaylist'
import { playFromSmartPlaylist } from '@/helpers/usePlayFrom'
import { Track } from '@/interfaces'
import { trackBandFade } from '@/utils/songItemMethods'
import updatePageTitle from '@/utils/updatePageTitle'

import SparklesSvg from '@/assets/icons/sparkles.svg'
import AfterHeader from '@/components/PlaylistView/AfterHeader.vue'
import AlbumsFetcher from '@/components/ArtistView/AlbumsFetcher.vue'
import Header from '@/components/SmartPlaylistView/Header.vue'
import NoItems from '@/components/shared/NoItems.vue'
import SongItem from '@/components/shared/SongItem.vue'

const page = useSmartPlaylistPage()
const route = useRoute()

// The playlist is read again when the route names another one; the same view
// serves them all.
watch(
    () => route.params.smartid,
    (newId, oldId) => {
        if (newId && newId !== oldId) void page.fetchPage(Number(newId), true)
    }
)

interface ScrollerItem {
    id: string | number
    component: typeof Header | typeof AfterHeader | typeof SongItem | typeof NoItems | typeof AlbumsFetcher
    size: number
    props?: {}
}

const scrollerItems = computed(() => {
    const header: ScrollerItem = {
        id: 'header',
        component: Header,
        size: isSmallPhone.value ? 24 * 16 : 18 * 16,
    }

    // The caption caps the list under it whenever there IS a list (see the
    // playlist view: the cap and the rows' `is_first` are one decision).
    const captionCapsList = page.tracks.length > 0

    const afterHeader: ScrollerItem = {
        id: 'afterHeader',
        component: AfterHeader,
        size: captionCapsList ? 3.15 * 16 : 4.5 * 16,
        props: {
            show_date_added: false,
            caps_list: captionCapsList,
            editable: false,
        },
    }

    const tracks = page.tracks.map((track: Track, i: number) => ({
        // Smart playlists hold each track once, so the hash names the row.
        id: track.trackhash,
        component: SongItem,
        size: 72,
        props: {
            track,
            index: i + 1,
            is_first: !captionCapsList && i === 0,
            is_last: i === page.tracks.length - 1,
            // Nothing here is reordered or dropped: the list is the rules' answer.
            droppable: false,
            source: dropSources.smartPlaylist,
            show_date_added: false,
            band_fade: trackBandFade(i + 1, page.tracks.length),
        },
    }))

    const body: ScrollerItem[] = tracks.length > 0 ? tracks : []

    // An empty playlist says so, but only once the rules have been answered:
    // before that the list is simply not known yet.
    if (tracks.length === 0 && page.allLoaded && page.info.id !== undefined) {
        body.push({
            id: 'Noitems',
            component: NoItems,
            size: 300,
            props: {
                icon: SparklesSvg,
                flag: true,
                title: 'No tracks match these rules',
                description: 'Change the rules to bring tracks into this playlist.',
            },
        })
    }

    // The next page, once the first one has been requested and more remain.
    if (page.tracks.length > 0 && !page.allLoaded) {
        body.push({
            id: 'tracks-fetcher',
            size: 1,
            component: AlbumsFetcher,
            props: {
                fetch_callback: () => page.fetchPage(page.info.id),
            },
        })
    }

    return [header, afterHeader, ...body]
})

/** A row picked from the list plays from that row on, in the order the page shows. */
function playThis(index: number) {
    const track = page.tracks[index]
    if (track) void playFromSmartPlaylist(page.info.id, track)
}

watch(
    () => page.info.name,
    name => updatePageTitle(name || ''),
    { immediate: true }
)

onBeforeRouteLeave(() => {
    page.resetAll()
})
</script>
