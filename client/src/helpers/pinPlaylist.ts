import { pinUnpinPlaylist } from '@/requests/playlists'
import usePlaylistsStore from '@/stores/pages/playlists'
import usePlaylistPage from '@/stores/pages/playlist'

/**
 * Pin/unpin a playlist on the server and keep BOTH stores in sync:
 * the library sidebar list (pages/playlists) and the currently-open
 * playlist page (pages/playlist). Use this everywhere instead of toggling
 * a single store, so pinning from the sidebar reflects on the page and
 * vice-versa.
 *
 * @returns true if the server call succeeded.
 */
export async function togglePlaylistPin(id: number): Promise<boolean> {
    const ok = await pinUnpinPlaylist(id)
    if (!ok) return false

    usePlaylistsStore().togglePin(id)

    const page = usePlaylistPage()
    if (page.info && page.info.id === id) {
        page.info.pinned = !page.info.pinned
    }

    return ok
}
