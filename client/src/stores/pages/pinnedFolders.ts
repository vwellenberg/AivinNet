import { defineStore } from 'pinia'
import { getPinnedFolders, PinnedFolder, reorderPinnedFolders } from '@/requests/folders'

/**
 * One spelling per folder, for comparing a path the client holds (a folder
 * card: trailing `/`; the breadcrumb: none; Windows: backslashes) with the
 * one the server stores the pin under. The server resolves symlinks too —
 * that part it alone can do, so `toggleFolderPin` keeps the path it answers.
 */
export function folderKey(path: string): string {
    return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

/**
 * Music folders pinned to the library sidebar, next to pinned albums and
 * playlists. Kept in sync by helpers/pinFolder.
 */
export default defineStore('pinnedFolders', {
    state: () => ({
        folders: <PinnedFolder[]>[],
        /** Whether `folders` has been read at least once — an empty list is a valid answer. */
        loaded: false,
    }),
    getters: {
        /** Explicit sidebar position first, alphabetical for never-reordered ones. */
        sortedFolders(): PinnedFolder[] {
            return [...this.folders].sort(
                (a, b) =>
                    (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) ||
                    a.name.localeCompare(b.name)
            )
        },
        isPinned() {
            return (path: string) => {
                const key = folderKey(path)
                return this.folders.some(f => folderKey(f.path) === key)
            }
        },
    },
    actions: {
        async fetchAll() {
            const folders = await getPinnedFolders()
            // A failed read is not "nothing pinned": the folder menu would then
            // offer "Pin" for a pinned folder, and the toggle would unpin it.
            if (folders === null) return
            this.folders = folders
            this.loaded = true
        },
        removeFolder(path: string) {
            const key = folderKey(path)
            this.folders = this.folders.filter(f => folderKey(f.path) !== key)
        },
        /** Optimistically apply explicit positions, then persist them. */
        async reorderTopLevel(positions: { path: string; position: number }[]) {
            for (const { path, position } of positions) {
                const f = this.folders.find(x => x.path === path)
                if (f) f.position = position
            }
            await reorderPinnedFolders(positions)
        },
    },
})
