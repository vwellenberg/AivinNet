import { paths } from '@/config'
import { Artist, Playlist, Track } from '@/interfaces'
import { NotifType, Notification, useToast } from '@/stores/notification'
import useAxios from './useAxios'
import useFolder from '@/stores/pages/folder'
import { recordRecentPlaylist } from '@/utils/recentPlaylists'

const { new: newPlaylistUrl, base: basePlaylistUrl, artists: playlistArtistsUrl } = paths.api.playlist

/**
 * Persist the manual library-sidebar order of playlists by explicit position
 * (shared with folder positions so the two interleave).
 */
export async function reorderSidebarPlaylists(positions: { id: number; position: number }[]) {
    return await useAxios({
        url: `${basePlaylistUrl}/sidebar-order`,
        method: 'POST',
        props: { positions },
    })
}

/**
 * Creates a new playlist on the server.
 * @param playlist_name The name of the playlist to create.
 */
export async function createNewPlaylist(playlist_name: string) {
    const { data, status } = await useAxios({
        url: newPlaylistUrl,
        props: {
            name: playlist_name,
        },
    })

    if (status == 201) {
        new Notification('Playlist created successfullly!', NotifType.Success)
        return data.playlist as Playlist
    }

    let message = 'Something went wrong'

    if (status == 409) {
        message = 'That playlist already exists'
    }

    new Notification(message, NotifType.Error)

    return null
}

/**
 * Fetches all playlists from the server.
 * @returns {Promise<Playlist[]>} A promise that resolves to an array of playlists.
 */
export async function getAllPlaylists(no_images = false): Promise<Playlist[]> {
    const { data, error } = await useAxios({
        url: basePlaylistUrl + (no_images ? '?no_images=true' : ''),
        method: 'GET',
    })

    if (error) console.error(error)

    if (data) {
        return data.data
    }

    return []
}

export async function getPlaylist(pid: number | string, no_tracks = false, start: number = 0, limit: number = 50) {
    const uri = `${basePlaylistUrl}/${pid}?no_tracks=${no_tracks}&start=${start}&limit=${limit}`

    interface PlaylistData {
        info: Playlist
        tracks: Track[]
    }

    const { data, status } = await useAxios({
        url: uri,
        method: 'GET',
    })

    if (status == 404) {
        new Notification('Playlist not found', NotifType.Error)
    }

    if (data) {
        return data as PlaylistData
    }

    return null
}

// ======== ADD ITEM TO PLAYLIST ========
export async function addItemToPlaylist(playlist: Playlist, props: {}) {
    const uri = `${basePlaylistUrl}/${playlist.id}/add`

    const { status } = await useAxios({
        url: uri,
        props: props,
    })

    if (status == 409) {
        new Notification('Track already exists in playlist', NotifType.Error)
        return false
    }

    new Notification('Added to ' + playlist.name)
    recordRecentPlaylist(playlist.id)
    return true
}

export function addTracksToPlaylist(playlist: Playlist, tracks: Track[]) {
    return addItemToPlaylist(playlist, {
        itemtype: 'tracks',
        itemhash: tracks.map(t => t.trackhash).join(','),
    })
}

export function addAlbumToPlaylist(playlist: Playlist, albumhash: string) {
    return addItemToPlaylist(playlist, {
        itemtype: 'album',
        itemhash: albumhash,
    })
}

export function addFolderToPlaylist(playlist: Playlist, path: string) {
    const folder = useFolder()
    return addItemToPlaylist(playlist, {
        itemtype: 'folder',
        itemhash: path,
        sortoptions: {
            tracksortby: folder.trackSortBy,
            tracksortreverse: folder.trackSortReverse,
        },
    })
}

export function addArtistToPlaylist(playlist: Playlist, artisthash: string) {
    return addItemToPlaylist(playlist, {
        itemtype: 'artist',
        itemhash: artisthash,
    })
}

// ===== SAVE ITEM AS =====

export async function saveItemAsPlaylist(itemtype: string, props: {}) {
    const { status, data } = await useAxios({
        url: paths.api.playlist.base + '/save-item',
        props: { itemtype, ...props },
    })

    const store = useToast()

    if (status === 201) {
        store.showNotification('Playlist created successfully!', NotifType.Success)
        return data.playlist as Playlist
    }

    if (status === 409) {
        store.showNotification('Playlist already exists!', NotifType.Error)
        return false
    }

    store.showNotification('Something went wrong!', NotifType.Error)
    return false
}

export function saveTrackAsPlaylist(playlist_name: string, itemhash: string) {
    return saveItemAsPlaylist('tracks', {
        itemhash,
        playlist_name,
    })
}

export function saveAlbumAsPlaylist(playlist_name: string, itemhash: string) {
    return saveItemAsPlaylist('album', {
        itemhash,
        playlist_name,
    })
}

export function saveFolderAsPlaylist(playlist_name: string, itemhash: string) {
    const folder = useFolder()
    return saveItemAsPlaylist('folder', {
        itemhash,
        playlist_name,
        sortoptions: {
            tracksortby: folder.trackSortBy,
            tracksortreverse: folder.trackSortReverse,
        },
    })
}

export function saveArtistAsPlaylist(playlist_name: string, itemhash: string) {
    return saveItemAsPlaylist('artist', {
        itemhash,
        playlist_name,
    })
}

// ========== END =========

export async function updatePlaylist(pid: number, playlist: FormData, pStore: any) {
    const uri = `${basePlaylistUrl}/${pid}/update`

    const { data, status } = await useAxios({
        url: uri,
        method: 'PUT',
        props: playlist,
        headers: {
            'Content-Type': 'multipart/form-data',
        },
    })

    if (status == 400) {
        new Notification('Failed: Unsupported image', NotifType.Error)
        return
    }

    if (status >= 400 || !data) {
        // e.g. 422 validation errors — never fail silently.
        new Notification('Failed to update playlist', NotifType.Error)
        return
    }

    pStore.updatePInfo(data.data)
    new Notification('Playlist updated!')
}

/**
 * Gets the artists in a playlist.
 * @param pid The playlist id to fetch tracks for.
 * @returns {Promise<Artist[]>} A promise that resolves to an array of artists.
 */
export async function getPlaylistArtists(pid: number): Promise<Artist[]> {
    const { data, error } = await useAxios({
        url: playlistArtistsUrl,
        props: {
            pid: pid,
        },
    })

    if (error) {
        new Notification('Something funny happened!', NotifType.Error)
    }

    if (data) {
        return data.data as Artist[]
    }

    return []
}

export async function deletePlaylist(pid: number) {
    const { status } = await useAxios({
        url: paths.api.playlist.base + `/${pid}/delete`,
        method: 'DELETE',
    })

    if (status == 200) {
        new Notification('Playlist deleted', NotifType.Success)
    }
}

export async function removeTracks(pid: number, tracks: { trackhash: string; index: number }[]) {
    const { status } = await useAxios({
        url: paths.api.playlist.base + `/${pid}/remove-tracks`,
        props: {
            tracks,
        },
    })

    if (status === 200) {
        new Notification('Tracks removed')
        return
    }

    new Notification('Unable to remove tracks', NotifType.Error)
}

export async function removeBannerImage(playlistid: number) {
    const { data, status } = await useAxios({
        url: paths.api.playlist.base + `/${playlistid}/remove-img`,
        method: 'DELETE',
    })

    if (status === 200) {
        new Notification('Banner image removed')
        return data.playlist as Playlist
    }

    new Notification('Unable to remove banner image', NotifType.Error)
}

/**
 * Move a single track so it sits immediately before `beforeTrackhash`
 * (null moves it to the end of the playlist).
 *
 * Deliberately NOT a whole-list submit: the old `/reorder` call sent
 * `allTracks.map(trackhash)`, which is only the tracks paginated in so far and
 * never the orphan hashes, and the endpoint replaced the stored list with it —
 * one drag cut a 120-track playlist down to 44. The server now does the surgery
 * on its own list from these two anchors.
 *
 * Returns true when the server accepted the move.
 */
export async function movePlaylistTrack(pid: number, trackhash: string, beforeTrackhash: string | null) {
    const { status } = await useAxios({
        url: paths.api.playlist.base + `/${pid}/move-track`,
        method: 'PUT',
        props: { trackhash, before_trackhash: beforeTrackhash },
    })

    if (status !== 200) {
        new Notification('Unable to move track', NotifType.Error)
        return false
    }

    return true
}

export async function pinUnpinPlaylist(pid: number) {
    const { status } = await useAxios({
        url: paths.api.playlist.base + `/${pid}/pin_unpin`,
    })

    if (status === 200) {
        return true
    }

    return false
}
