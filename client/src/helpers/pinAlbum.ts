import { pinUnpinAlbum } from '@/requests/album'
import usePinnedAlbums from '@/stores/pages/pinnedAlbums'
import useAlbumPage from '@/stores/pages/album'
import { Album } from '@/interfaces'

/**
 * Pin/unpin an album on the server and keep BOTH the sidebar list
 * (pages/pinnedAlbums) and the currently-open album page (pages/album) in
 * sync. Use this everywhere instead of toggling a single store.
 *
 * @returns true if the server call succeeded.
 */
export async function toggleAlbumPin(album: Album): Promise<boolean> {
    const pinned = await pinUnpinAlbum(album.albumhash)
    if (pinned === null) return false

    const store = usePinnedAlbums()
    if (pinned) {
        store.addAlbum(album)
    } else {
        store.removeAlbum(album.albumhash)
    }

    const page = useAlbumPage()
    if (page.info && page.info.albumhash === album.albumhash) {
        page.info.is_pinned = pinned
    }

    return true
}
