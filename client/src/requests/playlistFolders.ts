import useAxios from './useAxios'

const base = '/playlistfolders'

export interface PlaylistFolder {
    id: number
    name: string
    items: number[]
    position: number
}

export async function getPlaylistFolders(): Promise<PlaylistFolder[]> {
    const res = await useAxios({ url: base, method: 'GET' })
    return res.status === 200 ? (res.data as PlaylistFolder[]) : []
}

export async function createPlaylistFolder(name: string) {
    return await useAxios({ url: base, method: 'POST', props: { name } })
}

export async function renamePlaylistFolder(id: number, name: string) {
    return await useAxios({ url: `${base}/${id}`, method: 'PUT', props: { name } })
}

export async function deletePlaylistFolder(id: number) {
    return await useAxios({ url: `${base}/${id}`, method: 'DELETE' })
}

export async function movePlaylistToFolder(playlist_id: number, folder_id: number | null, position = -1) {
    return await useAxios({
        url: `${base}/move`,
        method: 'POST',
        props: { playlist_id, folder_id, position },
    })
}

export async function reorderPlaylistFolders(positions: { id: number; position: number }[]) {
    return await useAxios({ url: `${base}/reorder`, method: 'POST', props: { positions } })
}
