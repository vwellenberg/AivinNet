<template>
    <div class="album-virtual-scroller v-scroll-page" :class="{ isSmall }" style="height: 100%; position: relative;"
        :style="{ '--page-tint': pageTint(album.colors.bg) }">
        <DynamicScroller
            id="album-scroller"
            style="height: 100%"
            class="scroller"
            :min-item-size="72"
            :items="scrollerItems"
        >
            <template #default="{ item, index, active }">
                <DynamicScrollerItem
                    :item="item"
                    :active="active"
                    :size-dependencies="[item.props]"
                    :data-index="index"
                >
                    <!-- No `:key`: a key that changes with the item turns every
                         recycle into a new row, replaying its entrance mid-scroll
                         (census: components/__tests__/scrollerRecycling.test.ts). -->
                    <component
                        :is="item.component"
                        v-bind="item.props"
                        @playThis="playFromAlbum(item.props.track.master_index)"
                        @playDisc="playDisc"
                    ></component>
                </DynamicScrollerItem>
            </template>
        </DynamicScroller>
    </div>
</template>

<script setup lang="ts">
import { computed, nextTick } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute } from 'vue-router'

import { Track } from '@/interfaces'

import { pageTint } from '@/utils/colortools/pageGradient'
import { trackBandFade } from '@/utils/songItemMethods'
import useAlbumStore from '@/stores/pages/album'
import useQueueStore from '@/stores/queue'
import useTracklist from '@/stores/queue/tracklist'

import AlbumDiscBar from '@/components/AlbumView/AlbumDiscBar.vue'
import AlbumFind from '@/components/AlbumView/AlbumFind.vue'
import GenreBanner from '@/components/AlbumView/GenreBanner.vue'
import Header from '@/components/AlbumView/main.vue'
import AlbumsFetcher from '@/components/ArtistView/AlbumsFetcher.vue'
import CardScroller from '@/components/shared/CardScroller.vue'
import NoItems from '@/components/shared/NoItems.vue'
import SongItem from '@/components/shared/SongItem.vue'
import Stats from '@/components/Stats/Stats.vue'

import { dropSources } from '@/enums'
import { useListFind } from '@/helpers/useListFind'
import { isSmall } from '@/stores/content-width'

import albumSvg from '@/assets/icons/album.svg'

const album = useAlbumStore()
const queue = useQueueStore()
const tracklist = useTracklist()
const route = useRoute()

interface ScrollerItem {
    id: string | undefined
    component:
        | typeof Header
        | typeof SongItem
        | typeof GenreBanner
        | typeof CardScroller
        | typeof AlbumsFetcher
        | typeof Stats
        | typeof AlbumFind
        | typeof NoItems
    props?: any
}

class songItem {
    id: string | number
    props = {}
    component: typeof SongItem | typeof AlbumDiscBar

    constructor(track: Track, is_first = false, is_last = false, band_fade = 1) {
        this.id = track.filepath || Math.random()
        this.props = track.is_album_disc_number
            ? { album_disc: track }
            : {
                  track,
                  hide_album: true,
                  index: track.track,
                  is_first,
                  is_last,
                  source: dropSources.album,
                  band_fade,
              }
        this.component = track.is_album_disc_number ? AlbumDiscBar : SongItem
    }
}

// const AlbumVersionsFetcher: ScrollerItem = {
//     id: 'otherVersionsFetcherBanner',
//     component: AlbumsFetcher,
//     props: {
//         fetch_callback: album.fetchAlbumVersions,
//         reset_callback: () => {
//             album.resetOtherVersions()
//             return album.fetchAlbumVersions()
//         },
//         name: 'otherVersions',
//     },
// }

const fetched_similar_hash: ScrollerItem = {
    id: 'similarAlbumsFetcherBanner',
    component: AlbumsFetcher,
    props: {
        fetch_callback: () => album.fetchSimilarAlbums(),
        reset_callback: () => {
            album.resetSimilarAlbums()
            return album.fetchSimilarAlbums()
        },
        name: 'similarAlbums',
    },
}

function getSongItems() {
    // Frame each disc section on its own: a row is "first"/"last" when its
    // neighbor is a disc-number pseudo-track (rendered as AlbumDiscBar) or the
    // list edge, so every disc group gets a closed ink frame.
    //
    // The band fade counts the REAL tracks across the whole album (disc bars
    // excluded, discs not restarted) — `track.track` is the per-disc tag number
    // and would snap the gauge back to pale at every disc boundary.
    const totalReal = album.tracks.filter(t => !t.is_album_disc_number).length
    let pos = 0
    return album.tracks.map((track, i) => {
        const prev = album.tracks[i - 1]
        const next = album.tracks[i + 1]
        if (!track.is_album_disc_number) pos++
        return new songItem(
            track,
            !prev || !!prev.is_album_disc_number,
            !next || !!next.is_album_disc_number,
            trackBandFade(pos, totalReal)
        )
    })
}

function getStatsComponent(): ScrollerItem {
    return {
        id: 'album-stats',
        component: Stats,
        props: {
            items: album.stats,
        },
    }
}
function getArtistAlbumComponents(): ScrollerItem[] {
    // remove keys that have no albums
    const keys = Object.keys(album.artistAlbums).filter(key => album.artistAlbums[key].length > 0)

    const items = keys.map(artisthash => {
        const artist = album.info.albumartists.find(a => a.artisthash === artisthash)
        const artistname = artist?.name

        return {
            id: artisthash,
            component: CardScroller,
            props: {
                items: album.artistAlbums[artisthash].map(album => ({
                    type: 'album',
                    item: album,
                })),
                title: `More from ${artistname}`,
                route: `/artists/${artisthash}/discography/all?artist=${encodeURIComponent(artistname ?? '')}`,
            },
        }
    })

    // INFO: sort items by album.info.albumartists order
    return album.info.albumartists
        .map(artist => items.find(item => item.id === artist.artisthash))
        .filter(item => item !== undefined) as ScrollerItem[]
}

function getAlbumVersionsComponent(): ScrollerItem | null {
    if (album.otherVersions.length == 0) return null

    return {
        id: 'otherVersions',
        component: CardScroller,
        props: {
            items: album.otherVersions.map(album => ({
                type: 'album',
                item: album,
            })),
            title: 'Other versions',
            child_props: {
                hide_artists: true,
            },
            route: `/artists/${album.info.albumartists[0].artisthash}/discography/albums?artist=${encodeURIComponent(album.info.albumartists[0].name)}`,
        },
    }
}
const header: ScrollerItem = {
    id: 'album-header',
    component: Header,
}

// The album's own find, directly above the first track (see AlbumFind.vue).
// Only with tracks: an album without any has nothing to find in.
const findField: ScrollerItem = {
    id: 'album-find',
    component: AlbumFind,
}

function getNoItemsComponent(): ScrollerItem | null {
    // A find that matches nothing: say so, where the tracks would be.
    if (!album.query || album.tracks.length) return null

    return {
        id: 'album-no-items',
        component: NoItems,
        props: {
            icon: albumSvg,
            flag: true,
            title: 'No matching tracks',
            description: `Nothing in this album matches "${album.query}"`,
        },
    }
}

const genreBanner: ScrollerItem = {
    id: 'genre-banner',
    component: GenreBanner,
    props: {
        source: 'album',
    },
}

const scrollerItems = computed(() => {
    let moreFrom = getArtistAlbumComponents()
    moreFrom = moreFrom.filter(item => item.id !== undefined)
    const otherVersionsComponent = getAlbumVersionsComponent()

    let components: Array<ScrollerItem | songItem> = [header]
    if (album.srcTracks.length) components.push(findField)
    const noItems = getNoItemsComponent()
    if (noItems) components.push(noItems)
    components.push(...getSongItems(), genreBanner)

    // if (album.tracks.length) {
    //     components.push(AlbumVersionsFetcher)
    // }
    if (otherVersionsComponent !== null) {
        components.push(otherVersionsComponent)
    }
    components.push(...moreFrom)

    if (album.tracks.length) {
        components.push(fetched_similar_hash)
    }

    if (album.stats.length) {
        components.push(getStatsComponent())
    }

    if (album.fetched_similar_hash === route.params.albumhash && album.similarAlbums.length) {
        components.push({
            id: 'similarAlbums',
            component: CardScroller,
            props: {
                title: 'Related Albums',
                items: album.similarAlbums.map(i => ({
                    type: 'album',
                    item: i,
                })),
            },
        })
    }

    return components
})

// Cmd/Ctrl+F opens the album's own find (helpers/useListFind.ts): the browser's
// find only sees the rows the virtual scroller has rendered.
useListFind('album-find', 'album-scroller', () => album.srcTracks.length > 0, () => album.query)

function playFromAlbum(index: number, tracks = album.srcTracks) {
    const { title, albumhash } = album.info
    tracklist.setFromAlbum(title, albumhash, tracks)
    queue.play(index)
}

function playDisc(disc_number: number) {
    const tracks = album.srcTracks.filter(t => t.disc == disc_number)
    playFromAlbum(0, tracks)
}

onBeforeRouteUpdate(async to => {
    await album.fetchTracksAndArtists(to.params.albumhash.toString()).then(async () => {
        album.resetAlbumArtists()
        // album.fetchArtistAlbums()

        await nextTick()

        document.getElementById('album-scroller')?.scrollTo({
            top: 0,
        })
    })
    // A find belongs to the album it was typed in.
    album.resetQuery()
})

onBeforeRouteLeave(() => {
    album.resetQuery()
    album.resetAll()
})
</script>

<style lang="scss">
.album-virtual-scroller {
    height: 100%;
    overflow: visible;

    .songlist-item {
        grid-template-columns: 1.75rem 1fr $songlist-duration-col;
    }

    .statshead {
        // Left stays 0 (the component's own rule says why): the tiles line up
        // with the genre chips above and the track rows below them.
        padding: 2rem $medium $medium 0;
    }
}
</style>
