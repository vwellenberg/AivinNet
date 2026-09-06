import { reactive, ref } from 'vue'
import { computed, watch } from 'vue'
import { defineStore } from 'pinia'

import { Routes, router } from '@/router'
import { useDebounce } from '@vueuse/core'

import { searchAlbums, searchArtists, searchFolders, searchTopResults, searchTracks } from '@/requests/searchMusic'

import useTabs from './tabs'
import useLoader from './loader'
import useSettings from './settings'
import usePlaylists from './pages/playlists'
import { maxAbumCards } from './content-width'
import { recordRecentSearch } from '@/utils/recentSearches'

import { Album, Artist, Folder, Playlist, Track } from '../interfaces'

/** Lowercase + strip accents so "Tropico" matches "trópico" and vice-versa. */
function normalize(text: string) {
    return text
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
}

export default defineStore('search', () => {
    const query = ref('')
    const settings = useSettings()
    const route = computed(() => router.currentRoute.value)
    const debouncedQuery = useDebounce(query, 500)
    const { startLoading, stopLoading } = useLoader()

    const currentTab = ref('top')
    const top_results = reactive({
        query: '',
        top_result: <Track | Album | Artist>{},
        tracks: <Track[]>[],
        albums: <Album[]>[],
        artists: <Artist[]>[],
        playlists: <Playlist[]>[],
    })

    const tracks = reactive({
        query: '',
        value: <Track[]>[],
        more: false,
    })

    const albums = reactive({
        query: '',
        value: <Album[]>[],
        more: false,
    })

    const artists = reactive({
        query: '',
        value: <Artist[]>[],
        more: false,
    })

    const playlists = reactive({
        query: '',
        value: <Playlist[]>[],
        more: false,
    })

    const folders = reactive({
        query: '',
        value: <Folder[]>[],
        more: false,
    })

    /**
     * The backend search does not include playlists, so we match them on the
     * client against the already-loaded library. Matches are shown first in the
     * top results, ordered prefix-matches-first then alphabetically.
     */
    async function filterPlaylists(searchQuery: string) {
        const pStore = usePlaylists()

        if (!pStore.playlists.length) {
            await pStore.fetchAll()
        }

        // A newer keystroke may have superseded us while the library loaded —
        // don't overwrite fresh results with this stale query's matches.
        if (searchQuery !== query.value) return

        const q = normalize(searchQuery.trim())

        if (!q) {
            top_results.playlists = []
            return
        }

        top_results.playlists = pStore.playlists
            .filter(pl => normalize(pl.name).includes(q))
            .sort((a, b) => {
                const aStarts = normalize(a.name).startsWith(q)
                const bStarts = normalize(b.name).startsWith(q)
                if (aStarts !== bStarts) return aStarts ? -1 : 1
                return a.name.localeCompare(b.name)
            })
    }

    // Same matches as `top_results.playlists`, but tagged with a type so the
    // shared CardRow grid (Playlists tab) dispatches them to PlaylistCard —
    // mirroring how the search API tags albums/artists.
    const playlistCards = computed(() =>
        top_results.playlists.map(pl => ({ ...pl, type: 'playlist' }))
    )

    function fetchTopResults(query: string) {
        if (!query) return
        let limit = 3

        if (route.value.name == Routes.search) {
            limit = maxAbumCards.value
        }

        // Matching playlists come from the local library, not the search API.
        filterPlaylists(query)

        searchTopResults(query, limit).then(res => {
            top_results.top_result = res.top_result
            top_results.tracks = res.tracks
            top_results.albums = res.albums
            top_results.artists = res.artists
        })
    }

    // NOTE: The fetch methods are called twice from a page reload
    // This is because of the watchers down there
    // WONTFIX!

    /**
     * Searches for tracks, albums and artists
     * @param query query to search for
     */
    function fetchTracks(query: string) {
        if (!query) return

        searchTracks(query).then(data => {
            tracks.value = data.results
            tracks.more = data.more
            tracks.query = query
        })
    }

    function fetchAlbums(query: string) {
        if (!query) return

        searchAlbums(query).then(res => {
            albums.value = res.results
            albums.more = res.more
            albums.query = query
        })
    }

    function fetchArtists(query: string) {
        if (!query) return

        searchArtists(query).then(res => {
            artists.value = res.results
            artists.more = res.more
            artists.query = query
        })
    }

    function fetchFolders(query: string) {
        if (!query) return

        searchFolders(query).then(res => {
            folders.value = res.results
            folders.more = res.more
            folders.query = query
        })
    }

    async function loadTracks() {
        startLoading()
        const { results: moretracks, more } = await searchTracks(query.value, tracks.value.length)
        tracks.value = [...tracks.value, ...moretracks]
        tracks.more = more
        return stopLoading()
    }

    async function loadAlbums() {
        startLoading()
        const { results: morealbums, more } = await searchAlbums(query.value, albums.value.length)
        albums.value = [...albums.value, ...morealbums]
        albums.more = more
        return stopLoading()
    }

    async function loadArtists() {
        startLoading()
        const { results: moreartists, more } = await searchArtists(query.value, artists.value.length)
        artists.value = [...artists.value, ...moreartists]
        artists.more = more
        return stopLoading()
    }

    async function loadFolders() {
        startLoading()
        const { results: morefolders, more } = await searchFolders(query.value, folders.value.length)
        folders.value = [...folders.value, ...morefolders]
        folders.more = more
        return stopLoading()
    }

    watch(
        () => debouncedQuery.value,
        newQuery => {
            // Clearing the query resets results so the page falls back to its
            // idle / recent-searches state instead of showing stale matches.
            //
            // `!newQuery` is not paranoia: a missing `?q=` used to arrive here
            // as undefined, and the .trim() threw during render — which took
            // the whole search page (including its input) down with it. An
            // absent query IS an empty one; treat it that way.
            if (!newQuery || newQuery.trim() == '') {
                top_results.top_result = <Track>{}
                top_results.tracks = []
                top_results.albums = []
                top_results.artists = []
                top_results.playlists = []
                tracks.value = []
                albums.value = []
                artists.value = []
                folders.value = []
                return
            }

            recordRecentSearch(newQuery)

            // No longer gated on `use_sidebar`: the sidebar used to host a
            // search tab, so with it open the query had somewhere to render and
            // navigating away would have been wrong. Since #424 the sidebar is
            // the Now Playing panel — leaving the gate in place made typing in
            // the top bar fetch results that nothing displayed.
            if (route.value.name !== Routes.search) {
                router.push({
                    name: Routes.search,
                    params: {
                        page: 'top',
                    },
                    query: { q: newQuery },
                })
            }

            if (route.value.name === Routes.search) {
                router.replace({
                    name: Routes.search,
                    params: {
                        page: route.value.params.page,
                    },
                    query: { q: newQuery },
                })
            }

            const tabs = useTabs()

            if (route.value.name !== Routes.search && tabs.current !== 'search') {
                tabs.switchToSearch()
            }

            switch (currentTab.value) {
                case 'top':
                    fetchTopResults(newQuery)
                    break
                case 'tracks':
                    fetchTracks(newQuery)
                    break
                case 'albums':
                    fetchAlbums(newQuery)
                    break
                case 'artists':
                    fetchArtists(newQuery)
                    break
                case 'playlists':
                    filterPlaylists(newQuery)
                    break
                case 'folders':
                    fetchFolders(newQuery)
                    break
                default:
                    fetchTracks(newQuery)
                    break
            }
        }
    )

    watch(
        () => currentTab.value,
        newTab => {
            const current_query: string = query.value

            switch (newTab) {
                case 'top':
                    if (top_results.query == current_query) break
                    fetchTopResults(current_query)
                    break
                case 'tracks':
                    if (tracks.query == current_query) break
                    fetchTracks(current_query)
                    break

                case 'albums':
                    if (albums.query == current_query) break
                    fetchAlbums(current_query)
                    break

                case 'artists':
                    if (artists.query == current_query) break
                    fetchArtists(current_query)
                    break
                case 'playlists':
                    filterPlaylists(current_query)
                    break
                case 'folders':
                    if (folders.query == current_query) break
                    fetchFolders(current_query)
                    break
                default:
                    fetchTracks(current_query)
                    break
            }
        }
    )

    function switchTab(tab: string) {
        currentTab.value = tab
    }

    return {
        top_results,
        tracks,
        albums,
        artists,
        playlists,
        playlistCards,
        folders,
        query,
        currentTab,
        loadTracks,
        loadAlbums,
        loadArtists,
        loadFolders,
        switchTab,
    }
})
