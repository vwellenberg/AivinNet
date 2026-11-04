import { paths } from '@/config'
import { Folder, Track } from '@/interfaces'
import useAxios from './useAxios'

export async function getFiles(
    path: string,
    start: number,
    limit: number,
    tracks_only = false,
    options: {
        sorttracksby: string
        tracksort_reverse: boolean
        sortfoldersby: string
        foldersort_reverse: boolean
    } = {
        sorttracksby: 'default',
        tracksort_reverse: false,
        sortfoldersby: 'default',
        foldersort_reverse: false,
    }
) {
    interface FolderData {
        tracks: Track[]
        folders: Folder[]
        path: string
        total: number
    }

    const { data, error } = await useAxios({
        url: paths.api.folder.base,
        props: {
            folder: path,
            start,
            limit,
            tracks_only,
            ...options,
        },
    })

    if (error) {
        console.error(error)
    }

    if (data) {
        return data as FolderData
    }

    return <FolderData>{
        path: '',
        tracks: [],
        folders: [],
        total: 0,
    }
}

export async function openInFiles(path: string) {
    const { error } = await useAxios({
        url: paths.api.folder.showInFiles + `?path=${encodeURIComponent(path)}`,
        method: 'GET',
    })

    if (error) {
        console.error(error)
    }
}

export async function getTracksInPath(path: string) {
    const { data, error } = await useAxios({
        url: paths.api.folder.base + '/tracks/all' + `?path=${encodeURIComponent(path)}`,
        method: 'GET',
    })

    if (error) {
        console.error(error)
    }

    if (data) {
        return data.tracks as Track[]
    }

    return <Track[]>[]
}

/** A folder pinned to the library sidebar (GET /folder/pinned). */
export interface PinnedFolder {
    name: string
    /** The spelling the pin is stored under: resolved, POSIX, one trailing `/`. */
    path: string
    trackcount: number
    is_sym: boolean
    /** Explicit sidebar position, shared with albums, folders and playlists. */
    position?: number | null
}

/**
 * Toggle pin/unpin for a folder on the server.
 * @returns the new pinned state and the path the server stores it under, or
 *   null if the request failed (403 outside the root dirs, 400 not a folder).
 */
export async function pinUnpinFolder(path: string): Promise<{ pinned: boolean; path: string } | null> {
    const { data, status } = await useAxios({
        url: paths.api.folder.base + '/pin_unpin',
        props: { path },
    })

    if (status === 200) {
        return { pinned: data.pinned as boolean, path: data.path as string }
    }

    return null
}

/**
 * The current user's pinned folders, for the library sidebar — or null if the
 * request failed, so a failure is not mistaken for "nothing pinned".
 */
export async function getPinnedFolders(): Promise<PinnedFolder[] | null> {
    const { data, status } = await useAxios({
        url: paths.api.folder.base + '/pinned',
        method: 'GET',
    })

    return status === 200 ? data?.folders ?? [] : null
}

/**
 * Set explicit sidebar positions for pinned folders (shared position space
 * with pinned albums, playlist folders and pinned playlists). Unlisted folders
 * keep their position.
 */
export async function reorderPinnedFolders(positions: { path: string; position: number }[]) {
    await useAxios({
        url: paths.api.folder.base + '/pinned/order',
        props: { positions },
    })
}
