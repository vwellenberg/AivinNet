import { paths } from '@/config'
import { Album, StatItem, Track } from '@/interfaces'
import { NotifType, useToast } from '@/stores/notification'
import useAxios from './useAxios'

const {
    album: albumUrl,
    albumartists: albumArtistsUrl,
    albumbio: albumBioUrl,
    albumsByArtistUrl,
    albumVersions,
} = paths.api

const getAlbumData = async (albumhash: string, albumlimit: number) => {
    interface AlbumData {
        info: Album
        tracks: Track[]
        copyright: string
        extra: {
            track_total: number
            avg_bitrate: number
        }
        stats: StatItem[]
        more_from: {
            [key: string]: Album[]
        }
        other_versions: Album[]
    }

    const { data, status } = await useAxios({
        url: albumUrl,
        props: {
            albumhash,
            albumlimit,
        },
    })

    if (status == 204) {
        useToast().showNotification('Album not created yet!', NotifType.Error)
    }

    return data as AlbumData
}

const getAlbumArtists = async (hash: string) => {
    const { data, error } = await useAxios({
        url: albumArtistsUrl,
        props: {
            hash: hash,
        },
    })

    if (error) {
        console.error(error)
    }

    return data.artists
}

const getAlbumBio = async (hash: string) => {
    const { data, status } = await useAxios({
        url: albumBioUrl,
        props: {
            hash: hash,
        },
    })

    if (data) {
        return data.bio
    }

    if (status == 404) {
        return null
    }
}

export const getAlbumsFromArtist = async (albumartists: {}, limit: number = 2, base_title: string) => {
    const { data } = await useAxios({
        url: albumsByArtistUrl,
        props: {
            albumartists: albumartists,
            limit: limit,
            base_title,
        },
    })

    if (data) {
        return data
    }

    return []
}

export const getAlbumVersions = async (og_album_title: string, albumhash: string) => {
    const { data } = await useAxios({
        url: albumVersions,
        props: {
            og_album_title,
            albumhash,
        },
    })

    if (data) {
        return data
    }

    return []
}

export async function getAlbumTracks(albumhash: string): Promise<Track[]> {
    const { data } = await useAxios({
        url: albumUrl + `/${albumhash}/` + 'tracks',
        method: 'GET',
    })

    return data
}

export async function getSimilarAlbums(artisthash: string, limit: number = 5): Promise<Album[]> {
    const { data } = await useAxios({
        url: albumUrl + '/similar?' + 'artisthash=' + artisthash + '&albumlimit=' + limit,
        method: 'GET',
    })

    return data
}

/**
 * Toggle pin/unpin for an album on the server.
 * @returns the new pinned state, or null if the request failed.
 */
export async function pinUnpinAlbum(albumhash: string): Promise<boolean | null> {
    const { data, status } = await useAxios({
        url: albumUrl + `/${albumhash}/pin_unpin`,
    })

    if (status === 200) {
        return data.pinned as boolean
    }

    return null
}

/**
 * Fetch the current user's pinned albums (cards for the library sidebar).
 */
export async function getPinnedAlbums(): Promise<Album[]> {
    const { data } = await useAxios({
        url: albumUrl + '/pinned',
        method: 'GET',
    })

    return data?.albums ?? []
}

/**
 * Set explicit sidebar positions for pinned albums (shared position space
 * with folders and pinned playlists). Unlisted albums keep their position.
 */
export async function reorderPinnedAlbums(positions: { albumhash: string; position: number }[]) {
    await useAxios({
        url: albumUrl + '/pinned/order',
        props: { positions },
    })
}

export { getAlbumData as getAlbum, getAlbumArtists, getAlbumBio }
