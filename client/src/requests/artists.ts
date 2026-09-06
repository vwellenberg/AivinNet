import { paths } from '@/config'
import { Album, Artist, Genre, StatItem, Track } from '@/interfaces'
import { NotifType, useToast } from '@/stores/notification'
import useAxios from './useAxios'

export const getArtistData = async (hash: string, limit: number = 15, albumlimit: number = 7) => {
    interface ArtistData {
        artist: Artist
        tracks: Track[]
        albums: {
            albums: Album[]
            singles_and_eps: Album[]
            appearances: Album[]
            compilations: Album[]
        }
        genres: Genre[]
        stats: StatItem[]
    }

    const { data, error, status } = await useAxios({
        method: 'GET',
        url: paths.api.artist + `/${hash}?tracklimit=${limit}&albumlimit=${albumlimit}`,
    })

    if (status == 404) {
        useToast().showNotification('Artist not found', NotifType.Error)
    }

    if (error) {
        console.error(error)
    }

    return data as ArtistData
}

/**
 * The counts and genres for an artist, without its tracks or albums.
 *
 * ⚠️ Deliberately NOT `getArtistData`. That route loads every track of the
 * artist, sorts them by playcount and fetches the albums — work the server does
 * on its only thread, so asking it on every track change would stall playback
 * for everyone. The backend added this route for exactly this caller
 * (AivinNet#100).
 *
 * `trackcount` counts the hashes the store INDEXED, while the artist page
 * counts the ones it could resolve. After a tag edit the two can differ until
 * the next index, so this number may run slightly high — resolving them here
 * would mean loading every track, which is the thing the route exists to avoid.
 */
export const getArtistSummary = async (hash: string) => {
    interface ArtistSummary {
        artist: Artist & {
            playcount: number
            lastplayed: number
            trackcount: number
            albumcount: number
            genres: Genre[]
        }
    }

    const { data, error } = await useAxios({
        method: 'GET',
        url: paths.api.artist + `/${hash}/summary`,
    })

    // A missing artist is a normal outcome here — a track whose artist the
    // store has not indexed. The panel just leaves the card out, so this stays
    // quiet rather than raising the toast the full artist route raises.
    if (error) {
        return null
    }

    return (data as ArtistSummary)?.artist ?? null
}

export const getArtistAlbums = async (hash: string, limit = 6, all = false) => {
    interface ArtistAlbums {
        artistname: string
        albums: Album[]
        singles_and_eps: Album[]
        appearances: Album[]
        compilations: Album[]
    }

    const { data, error } = await useAxios({
        method: 'GET',
        url: paths.api.artist + `/${hash}/albums?limit=${limit}&all=${all}`,
    })

    if (error) {
        console.error(error)
    }

    return data as ArtistAlbums
}

export const getArtistTracks = async (hash: string) => {
    const { data, error } = await useAxios({
        method: 'GET',
        url: paths.api.artist + `/${hash}/tracks`,
    })

    if (error) {
        console.error(error)
    }

    return data as Track[]
}

export const getSimilarArtists = async (hash: string, limit = 6) => {
    const { data, error } = await useAxios({
        method: 'GET',
        url: paths.api.artist + `/${hash}/similar?artistlimit=${limit}`,
    })

    if (error) {
        console.error(error)
    }

    return data as Artist[]
}

export async function saveArtistAsPlaylist(name: string, hash: string) {
    const { data, error } = await useAxios({
        url: paths.api.artist + `/${hash}/playlist`,
        props: {
            name,
        },
    })

    if (error) {
        console.error(error)
    }

    return data
}
