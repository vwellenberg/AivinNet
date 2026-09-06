import modal from '@/stores/modal'
import useArtist from '@/stores/pages/artist'

import { SearchIcon } from '@/icons'
import { Album, Option, Playlist } from '@/interfaces'
import { getAllPlaylists } from '@/requests/playlists'
import { getRecentPlaylistIds } from '@/utils/recentPlaylists'

export const separator: Option = {
    type: 'separator',
}

export function get_new_playlist_option(new_playlist_modal_props: any = {}): Option {
    return {
        label: 'New playlist',
        action: () => {
            modal().showNewPlaylistModal(new_playlist_modal_props)
        },
    }
}

type action = (playlist: Playlist) => void

/**
 *
 * @param addToPlaylist Function to be called when a playlist is selected
 * @param new_playlist_modal_props Props to be passed to the modal when creating a new playlist
 * @returns A list of options to be used in a context menu
 */
export async function getAddToPlaylistOptions(addToPlaylist: action, new_playlist_modal_props: any = {}) {
    const new_playlist = get_new_playlist_option(new_playlist_modal_props)
    const p = await getAllPlaylists(true)

    let items = [new_playlist]

    if (p.length === 0) {
        return items
    }

    const toOption = (playlist: Playlist): Option => ({
        label: playlist.name,
        action: () => {
            addToPlaylist(playlist)
        },
    })

    const playlists = p.map(toOption)

    // Pin the up-to-3 most-recently-used playlists above the full list, set off
    // by their own separator. They stay in the full list below too, so nothing
    // silently disappears from the alphabetical listing.
    const recents = getRecentPlaylistIds()
        .map(id => p.find(playlist => playlist.id === id))
        .filter((playlist): playlist is Playlist => playlist !== undefined)
        .slice(0, 3)
        .map(toOption)

    if (recents.length > 0) {
        return [...items, separator, ...recents, separator, ...playlists]
    }

    return [...items, separator, ...playlists]
}

/**
 *
 * @param addToPlaylist Function to be called when a playlist is selected
 * @param new_playlist_modal_props Props to be passed to the modal when creating a new playlist
 * @returns A list of options to be used in a context menu
 */
export const get_find_on_social = (page = 'album', query = '', album?: Album) => {
    const is_album = page === 'album'
    const getAlbumSearchTerm = () => {
        return `${album?.title} - ${album?.albumartists.map(a => a.name).join(', ')}`
    }
    const search_term = query ? query : is_album ? getAlbumSearchTerm() : useArtist().info.name

    return <Option>{
        label: 'Search on',
        icon: SearchIcon,
        children: async () => [
            {
                label: 'Google',
                action: () => window.open(`https://www.google.com/search?q=${search_term}`, '_blank'),
            },
            {
                label: 'YouTube',
                action: () => window.open(`https://www.youtube.com/results?search_query=${search_term}`, '_blank'),
            },
            {
                label: 'Spotify',
                action: () => window.open(`https://open.spotify.com/search/${search_term}/${page}s`, '_blank'),
            },
            {
                label: 'Tidal',
                action: () => window.open(`https://listen.tidal.com/search/${page}s?q=${search_term}`, '_blank'),
            },
            {
                label: 'Apple Music',
                action: () => window.open(`https://music.apple.com/search?term=${search_term}`, '_blank'),
            },
            {
                label: 'Deezer',
                action: () => window.open(`https://www.deezer.com/search/${search_term}/${page}`, '_blank'),
            },
            {
                label: 'Wikipedia',
                action: () =>
                    window.open(`https://en.wikipedia.org/wiki/Special:Search?search=${search_term}`, '_blank'),
            },
        ],
    }
}
