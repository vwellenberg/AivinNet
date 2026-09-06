import { createRouter, createWebHashHistory, RouterOptions } from 'vue-router'

import state from '@/composables/state'
import useAlbumPageStore from '@/stores/pages/album'
import useFolderPageStore from '@/stores/pages/folder'
import usePlaylistPageStore from '@/stores/pages/playlist'
import usePlaylistListPageStore from '@/stores/pages/playlists'
import useArtistPageStore from '@/stores/pages/artist'
import useSettingsStore from '@/stores/settings'

import HomeView from '@/views/HomeView'
const Lyrics = () => import('@/views/LyricsView')
const ArtistView = () => import('@/views/ArtistView')
const NotFound = () => import('@/views/NotFound.vue')
const NowPlaying = () => import('@/views/NowPlaying')
const SearchView = () => import('@/views/SearchView')
const AlbumList = () => import('@/views/AlbumListView')
const FolderView = () => import('@/views/FolderView.vue')
const FavoritesView = () => import('@/views/Favorites.vue')
const AlbumView = () => import('@/views/AlbumView/index.vue')
const ArtistTracksView = () => import('@/views/ArtistTracks.vue')
const PlaylistListView = () => import('@/views/PlaylistList.vue')
const FavoriteTracks = () => import('@/views/FavoriteTracks.vue')
const PlaylistView = () => import('@/views/PlaylistView/index.vue')
const ArtistDiscographyView = () => import('@/views/ArtistDiscography.vue')
const FavoriteCardScroller = () => import('@/views/FavoriteCardScroller.vue')
const StatsView = () => import('@/views/Stats/main.vue')
const PairView = () => import('@/views/PairView.vue')

const folder = {
    path: '/folder/:path',
    name: 'FolderView',
    component: FolderView,
    beforeEnter: async (to: any) => {
        // Start inside the single configured root dir instead of the virtual
        // "$home" screen, so the folder view opens at e.g. `music` directly.
        const roots = useSettingsStore().root_dirs
        if (to.params.path === '$home' && roots.length === 1 && roots[0] !== '$home') {
            return { name: 'FolderView', params: { path: roots[0] } }
        }
        state.loading.value = true
        await useFolderPageStore()
            .fetchAll(to.params.path, true)
            .then(() => {
                state.loading.value = false
            })
    },
}

const playlists = {
    path: '/playlists',
    name: 'PlaylistList',
    component: PlaylistListView,
    beforeEnter: async () => {
        state.loading.value = true
        await usePlaylistListPageStore()
            .fetchAll()
            .then(() => {
                state.loading.value = false
            })
    },
}

const playlistView = {
    path: '/playlist/:pid',
    name: 'PlaylistView',
    component: PlaylistView,
    beforeEnter: async (to: any) => {
        state.loading.value = true
        await usePlaylistPageStore()
            .fetchAll(to.params.pid)
            .then(() => {
                state.loading.value = false
            })
    },
}

const albumView = {
    path: '/albums/:albumhash',
    name: 'AlbumView',
    component: AlbumView,
    beforeEnter: async (to: any) => {
        state.loading.value = true
        const store = useAlbumPageStore()

        await store.fetchTracksAndArtists(to.params.albumhash).then(() => {
            state.loading.value = false
        })
    },
}

const artistView = {
    path: '/artists/:hash',
    name: 'ArtistView',
    component: ArtistView,
    beforeEnter: async (to: any) => {
        state.loading.value = true

        await useArtistPageStore()
            .getData(to.params.hash)
            .then(() => {
                state.loading.value = false
            })
    },
}

const NowPlayingView = {
    path: '/nowplaying/:tab',
    name: 'NowPlaying',
    component: NowPlaying,
}

const LyricsView = {
    path: '/lyrics',
    name: 'LyricsView',
    component: Lyrics,
}

const ArtistTracks = {
    path: '/artists/:hash/tracks',
    name: 'ArtistTracks',
    component: ArtistTracksView,
}

const artistDiscography = {
    path: '/artists/:hash/discography/:type',
    name: 'ArtistDiscographyView',
    component: ArtistDiscographyView,
}

const search = {
    path: '/search/:page',
    name: 'SearchView',
    component: SearchView,
}

const favorites = {
    path: '/favorites',
    name: 'FavoritesView',
    component: FavoritesView,
}

const favoriteAlbums = {
    path: '/favorites/albums',
    name: 'FavoriteAlbums',
    component: FavoriteCardScroller,
}

const favoriteArtists = {
    path: '/favorites/artists',
    name: 'FavoriteArtists',
    component: FavoriteCardScroller,
}

const favoriteTracks = {
    path: '/favorites/tracks',
    name: 'FavoriteTracks',
    component: FavoriteTracks,
}

const notFound = {
    name: 'NotFound',
    path: '/:pathMatch(.*)',
    component: NotFound,
}

const Home = {
    path: '/',
    name: 'Home',
    component: HomeView,
}

const AlbumListView = {
    path: '/albums',
    name: 'AlbumListView',
    component: AlbumList,
}

const Stats = {
    path: '/stats',
    name: 'StatsView',
    component: StatsView,
}

const ArtistListView = {
    ...AlbumListView,
    path: '/artists',
    name: 'ArtistListView',
}

// QR deep-link pairing target. Reachable without login (there is no router
// auth guard; auth is cookie-based) — the view redeems the code itself.
const Pair = {
    path: '/pair',
    name: 'PairView',
    component: PairView,
}

const routes = [
    folder,
    playlists,
    playlistView,
    albumView,
    artistView,
    artistDiscography,
    search,
    notFound,
    ArtistTracks,
    favorites,
    favoriteAlbums,
    favoriteTracks,
    favoriteArtists,
    NowPlayingView,
    Home,
    AlbumListView,
    ArtistListView,
    LyricsView,
    Stats,
    Pair,
]

const Routes = {
    folder: folder.name,
    playlists: playlists.name,
    playlist: playlistView.name,
    album: albumView.name,
    artist: artistView.name,
    artistDiscography: artistDiscography.name,
    search: search.name,
    notFound: notFound.name,
    artistTracks: ArtistTracks.name,
    favorites: favorites.name,
    favoriteAlbums: favoriteAlbums.name,
    favoriteTracks: favoriteTracks.name,
    favoriteArtists: favoriteArtists.name,
    nowPlaying: NowPlayingView.name,
    Home: Home.name,
    AlbumList: AlbumListView.name,
    ArtistList: ArtistListView.name,
    Lyrics: LyricsView.name,
    Stats: Stats.name,
    Pair: Pair.name,
}

const router = createRouter({
    mode: 'hash',
    history: createWebHashHistory(import.meta.env.BASE_URL),
    routes,
} as RouterOptions)

/**
 * Ground-Parallax (#143): der Doodle-Ground driftet beim Seitenwechsel kurz
 * gegen die Laufrichtung des Inhalts.
 *
 * Warum das hier steht und nicht im Stylesheet: der Ground liegt auf
 * `#acontent`, und das Element ÜBERLEBT den Routenwechsel. Eine CSS-Animation
 * startet, wenn ein Knoten entsteht oder ein Selektor zu greifen beginnt —
 * beides passiert hier nie wieder nach dem ersten Laden. Ein Versuch mit
 * `#acontent:has(.content-page)` lief deshalb genau einmal, beim App-Start.
 *
 * Die Seite selbst braucht das nicht: sie ist bei jeder Route eine neue
 * Komponenteninstanz und animiert sich über `.content-page` von allein.
 *
 * ⚠️ Die Klasse wird VOR dem nächsten Frame wieder entfernt und dann neu
 * gesetzt, sonst startet die Animation beim zweiten Wechsel in dieselbe
 * Richtung nicht erneut — ein laufender Name auf demselben Element wird von
 * der Engine nicht neu angestoßen.
 */
router.afterEach(() => {
    const content = document.getElementById('acontent')
    if (!content) return

    content.classList.remove('ground-drift')
    // Reflow erzwingen: ohne das fasst der Browser Entfernen und Setzen in
    // einem Frame zusammen, und es passiert gar nichts.
    void content.offsetWidth
    content.classList.add('ground-drift')
})

export { router, Routes }
