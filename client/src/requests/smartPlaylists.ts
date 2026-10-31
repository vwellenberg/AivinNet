import { paths } from '@/config'
import { Playlist, SmartPlaylist, SmartPlaylistBody, SmartPlaylistDetail, Track } from '@/interfaces'
import { NotifType, Notification } from '@/stores/notification'
import useAxios from './useAxios'

const base = paths.api.smartPlaylists.base

/** A create, update or save either succeeds with the row, or says why not in the server's words. */
export type SmartPlaylistResult<T = SmartPlaylist> = { ok: true; value: T } | { ok: false; error: string }

/**
 * The server's refusal text: a 400 names the rule at fault, a 409 the name in
 * use. A request that never got an answer gets the plain reason instead.
 */
function refusal(data: any, error: string | undefined, fallback: string): string {
    if (data && typeof data.error === 'string') return data.error
    if (data && typeof data.msg === 'string') return data.msg
    if (error) return 'Could not reach the server'
    return fallback
}

/** All smart playlists, rules only: no tracks are evaluated for the list. Null when the list could not be loaded. */
export async function getSmartPlaylists(): Promise<SmartPlaylist[] | null> {
    const { data, error } = await useAxios({
        url: base,
        method: 'GET',
    })

    if (error || !Array.isArray(data?.data)) {
        console.error('GET /smartplaylists: unexpected response', error ?? data)
        return null
    }

    return data.data as SmartPlaylist[]
}

/**
 * One smart playlist with the tracks its rules hold right now. `limit` -1 is
 * the rest of them (used to play it). Null when it is not there.
 */
export async function getSmartPlaylist(
    smartid: number | string,
    start = 0,
    limit = 50
): Promise<{ info: SmartPlaylistDetail; tracks: Track[] } | null> {
    const { data, status } = await useAxios({
        url: `${base}/${smartid}?start=${start}&limit=${limit}`,
        method: 'GET',
    })

    if (status === 404) {
        new Notification('Smart playlist not found', NotifType.Error)
        return null
    }

    if (!data?.info) return null

    return data as { info: SmartPlaylistDetail; tracks: Track[] }
}

/** Creates a smart playlist. A refused rule comes back as `error`, and nothing is stored. */
export async function createSmartPlaylist(body: SmartPlaylistBody): Promise<SmartPlaylistResult> {
    const { data, status, error } = await useAxios({
        url: `${base}/new`,
        props: body,
    })

    if (status === 201 && data?.playlist) {
        new Notification('Smart playlist created', NotifType.Success)
        return { ok: true, value: data.playlist as SmartPlaylist }
    }

    return { ok: false, error: refusal(data, error, 'Could not create the smart playlist') }
}

/** Replaces the name and the rules of a smart playlist. A refusal changes nothing on the server. */
export async function updateSmartPlaylist(smartid: number, body: SmartPlaylistBody): Promise<SmartPlaylistResult> {
    const { data, status, error } = await useAxios({
        url: `${base}/${smartid}/update`,
        method: 'PUT',
        props: body,
    })

    if (status === 200 && data?.playlist) {
        return { ok: true, value: data.playlist as SmartPlaylist }
    }

    return { ok: false, error: refusal(data, error, 'Could not save the smart playlist') }
}

/** Deletes the rules. Tracks in a playlist saved from them are a normal playlist's and stay. */
export async function deleteSmartPlaylist(smartid: number): Promise<boolean> {
    const { status } = await useAxios({
        url: `${base}/${smartid}/delete`,
        method: 'DELETE',
    })

    if (status === 200) {
        new Notification('Smart playlist deleted', NotifType.Success)
        return true
    }

    new Notification('Unable to delete the smart playlist', NotifType.Error)
    return false
}

/**
 * Freezes the tracks the rules hold now into a normal playlist called `name`.
 * The smart playlist itself stays as it is.
 */
export async function saveSmartPlaylistAsPlaylist(smartid: number, name: string): Promise<SmartPlaylistResult<Playlist>> {
    const { data, status, error } = await useAxios({
        url: `${base}/${smartid}/save-as-playlist`,
        props: { name },
    })

    if (status === 201 && data?.playlist) {
        return { ok: true, value: data.playlist as Playlist }
    }

    return { ok: false, error: refusal(data, error, 'Could not save the playlist') }
}
