import { paths } from '@/config'
import { NotifType, Notification } from '@/stores/notification'
import useAxios from './useAxios'

export interface CoverSuggestion {
    url: string
    source: string
    album: string
    artist: string
}

export interface CoverSearchResult {
    // The query that actually produced the results — the server retries with
    // shortened variants when the full one has no hits.
    query: string
    results: CoverSuggestion[]
}

/**
 * Searches iTunes + Deezer (proxied by the server) for album covers
 * matching the query. Returns null when the request itself failed
 * (as opposed to a successful search with zero hits).
 */
export async function searchCoversOnline(query: string): Promise<CoverSearchResult | null> {
    const { data, status } = await useAxios({
        url: `${paths.api.coverart}/search?q=${encodeURIComponent(query)}`,
        method: 'GET',
    })

    if (status !== 200 || !data) {
        new Notification('Cover search failed', NotifType.Error)
        return null
    }

    return { query: data.query || query, results: data.results || [] }
}

/**
 * Asks the server to download the confirmed cover and save it as the
 * playlist image, then updates the playlist store (mirrors updatePlaylist).
 * Returns true on success.
 */
export async function saveOnlineCoverForPlaylist(pid: number, url: string, pStore: any): Promise<boolean> {
    const { data, status } = await useAxios({
        url: `${paths.api.coverart}/playlist/${pid}`,
        props: { url },
        method: 'POST',
    })

    if (status !== 200 || !data || !data.data) {
        new Notification('Failed to save cover image', NotifType.Error)
        return false
    }

    pStore.updatePInfo(data.data)
    new Notification('Playlist cover updated!', NotifType.Success)
    return true
}

/**
 * Asks the server to download the confirmed cover and save it as the
 * album cover. Returns the saved image filename, or null on failure.
 */
export async function saveOnlineCoverForAlbum(albumhash: string, url: string): Promise<string | null> {
    const { data, status } = await useAxios({
        url: `${paths.api.coverart}/album`,
        props: { albumhash, url },
        method: 'POST',
    })

    if (status !== 200 || !data || !data.image) {
        new Notification('Failed to save cover image', NotifType.Error)
        return null
    }

    // Success feedback is the caller's job (it shows an undo toast).
    return data.image
}

/**
 * Restores the album cover replaced by the last save (one level).
 */
export async function undoAlbumCover(albumhash: string): Promise<boolean> {
    const { data, status } = await useAxios({
        url: `${paths.api.coverart}/album/undo`,
        props: { albumhash },
        method: 'POST',
    })

    if (status !== 200 || !data || !data.success) {
        new Notification('Nothing to undo', NotifType.Error)
        return false
    }

    return true
}

/**
 * Removes an album's cover so it falls back to the placeholder.
 *
 * The server also records the removal, which is what stops the next library
 * scan from re-deriving the same picture out of the audio files — without
 * that, this would appear to do nothing.
 */
export async function removeAlbumCover(albumhash: string): Promise<boolean> {
    const { data, status } = await useAxios({
        url: `${paths.api.coverart}/album/remove`,
        props: { albumhash },
        method: 'POST',
    })

    if (status !== 200 || !data?.success) {
        new Notification('Failed to remove cover', NotifType.Error)
        return false
    }

    return true
}

/**
 * Uploads a local image file as an album's cover.
 *
 * multipart/form-data, not JSON: this is the only album request that carries
 * a file. The field is named `image` to match the server's form model.
 */
export async function uploadAlbumCover(albumhash: string, file: File): Promise<string | null> {
    const form = new FormData()
    form.append('albumhash', albumhash)
    form.append('image', file)

    const { data, status } = await useAxios({
        url: `${paths.api.coverart}/album/upload`,
        props: form,
        method: 'POST',
        headers: { 'Content-Type': 'multipart/form-data' },
    })

    if (status !== 200 || !data?.image) {
        new Notification(data?.error || 'Failed to upload cover', NotifType.Error)
        return null
    }

    return data.image
}
