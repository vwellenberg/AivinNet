import { defineStore } from 'pinia'
import { Album } from '@/interfaces'
import { getPinnedAlbums, reorderPinnedAlbums } from '@/requests/album'

/**
 * Pinned albums shown in the library sidebar (next to pinned playlists).
 * Kept in sync by helpers/pinAlbum so pinning from a card, the album page
 * or the sidebar reflects everywhere immediately.
 */
export default defineStore('pinnedAlbums', {
    state: () => ({
        albums: <Album[]>[],
    }),
    getters: {
        /** Explicit sidebar position first (shared space with folders and
         *  pinned playlists), alphabetical for never-reordered albums. */
        sortedAlbums(): Album[] {
            return [...this.albums].sort(
                (a, b) =>
                    (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) ||
                    a.title.localeCompare(b.title)
            )
        },
        isPinned() {
            return (albumhash: string) => this.albums.some(a => a.albumhash === albumhash)
        },
    },
    actions: {
        async fetchAll() {
            this.albums = await getPinnedAlbums()
        },
        addAlbum(album: Album) {
            if (!this.albums.some(a => a.albumhash === album.albumhash)) {
                this.albums.unshift(album)
            }
        },
        removeAlbum(albumhash: string) {
            this.albums = this.albums.filter(a => a.albumhash !== albumhash)
        },
        /** Optimistically apply explicit positions, then persist them. */
        async reorderTopLevel(positions: { albumhash: string; position: number }[]) {
            for (const { albumhash, position } of positions) {
                const al = this.albums.find(a => a.albumhash === albumhash)
                if (al) al.position = position
            }
            await reorderPinnedAlbums(positions)
        },
    },
})
