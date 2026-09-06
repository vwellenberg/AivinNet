import { Routes } from '@/router'
import { RouteLocationRaw } from 'vue-router'

import useQueue from '@/stores/queue'
import { FromOptions } from '@/enums'
import { paths } from '@/config'
import { From } from '@/stores/queue/tracklist'

import AlbumSvg from '@/assets/icons/album.svg'
import ArtistSvg from '@/assets/icons/artist.svg'
import FolderSvg from '@/assets/icons/folder.svg'
import BookmarkSvg from '@/assets/icons/bookmark.fill.svg'
import PlaylistSvg from '@/assets/icons/playlist.svg'
import SearchSvg from '@/assets/icons/search.svg'
import RadioSvg from '@/assets/icons/radio.svg'

interface PlayingFrom {
    /**
     * The caption above the name — what KIND of place this is.
     *
     * It used to be `tracklist.from.type` read straight out of the enum, and
     * that made the plate lie twice: `playlistFolder` rendered as
     * "PLAYLISTFOLDER", and the two sources whose name is not an entity name
     * repeated their own caption ("SEARCH" over `Search for: "…"`, "FAVORITE"
     * over "Favorite tracks"). A caption that echoes the line below it carries
     * nothing, and on the search source it cost more than that: caption plus a
     * `Search for:` phrase plus the magnifier glyph is the anatomy of the app's
     * search FIELD (`RightSideBar/SearchInput.vue`) — on the phone Now-Playing
     * screen this plate is the topmost element, with no top bar in sight to
     * compare it against, and it was read as one.
     */
    type: string
    name: string
    icon: string
    location: RouteLocationRaw
    image?: string
}

export default (source: From): PlayingFrom => {
    switch (source.type) {
        case FromOptions.album:
            return {
                type: 'Album',
                name: source.name,
                icon: AlbumSvg,
                location: {
                    name: Routes.album,
                    params: {
                        albumhash: source.albumhash,
                    },
                },
                image: paths.images.thumb.small + source.albumhash + '.webp',
            }

        case FromOptions.folder:
            return {
                type: 'Folder',
                name: source.name,
                icon: FolderSvg,
                location: {
                    name: Routes.folder,
                    params: {
                        path: useQueue().currenttrack.folder,
                    },
                },
                image: '',
            }

        case FromOptions.playlist:
            return {
                type: 'Playlist',
                name: source.name,
                icon: PlaylistSvg,
                location: {
                    name: Routes.playlist,
                    params: {
                        pid: source.id,
                    },
                },
                image: paths.images.playlist + source.id,
            }

        case FromOptions.playlistFolder:
            // Playlist folders live in the sidebar; the playlists page is the
            // closest navigable surface.
            return {
                type: 'Playlist folder',
                name: source.name,
                icon: FolderSvg,
                location: {
                    name: Routes.playlists,
                },
                image: '',
            }

        case FromOptions.search:
            return {
                // The caption already says where this leads, so the name is the
                // words the user typed — quoted, so they read as a quotation
                // rather than as a value sitting in a field.
                type: 'Search results',
                name: `"${source.query}"`,
                icon: SearchSvg,
                location: {
                    name: Routes.search,
                    params: {
                        page: 'top',
                    },
                    query: {
                        q: source.query,
                    },
                },
                image: '',
            }

        case FromOptions.artist:
            return {
                type: 'Artist',
                name: source.artistname,
                icon: ArtistSvg,
                location: {
                    name: Routes.artist,
                    params: {
                        hash: source.artisthash,
                    },
                },
                image: paths.images.artist.small + source.artisthash + '.webp',
            }

        case FromOptions.favorite:
            return {
                type: 'Library',
                name: 'Favorite tracks',
                icon: BookmarkSvg,
                location: {
                    name: Routes.favoriteTracks,
                },
                image: '',
            }

        default:
            return { type: '', name: '👻 No source', location: {}, icon: '' }
    }
}
