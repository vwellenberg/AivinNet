import { defineStore } from 'pinia'

import {
    PlaylistFolder,
    createPlaylistFolder,
    deletePlaylistFolder,
    getPlaylistFolders,
    movePlaylistToFolder,
    renamePlaylistFolder,
    reorderPlaylistFolders,
} from '@/requests/playlistFolders'

const COLLAPSE_KEY = 'aivinnet.collapsedPlaylistFolders'

function loadCollapsed(): number[] {
    try {
        return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]')
    } catch {
        return []
    }
}

export default defineStore('playlistFolders', {
    state: () => ({
        folders: [] as PlaylistFolder[],
        // ids of collapsed folders (persisted to localStorage)
        collapsedIds: loadCollapsed() as number[],
    }),
    getters: {
        // playlist id -> folder id (so the sidebar knows which playlists are grouped)
        folderOf(state): Map<number, number> {
            const m = new Map<number, number>()
            for (const f of state.folders) for (const pid of f.items) m.set(pid, f.id)
            return m
        },
        sortedFolders(state): PlaylistFolder[] {
            return [...state.folders].sort((a, b) => a.position - b.position)
        },
    },
    actions: {
        async fetch() {
            this.folders = await getPlaylistFolders()
        },
        isCollapsed(id: number) {
            return this.collapsedIds.includes(id)
        },
        toggleCollapse(id: number) {
            if (this.collapsedIds.includes(id)) {
                this.collapsedIds = this.collapsedIds.filter(i => i !== id)
            } else {
                this.collapsedIds.push(id)
            }
            localStorage.setItem(COLLAPSE_KEY, JSON.stringify(this.collapsedIds))
        },
        async create(name: string) {
            const res = await createPlaylistFolder(name)
            if (res.status === 201 || res.status === 200) {
                this.folders.push(res.data as PlaylistFolder)
                return res.data as PlaylistFolder
            }
        },
        async rename(id: number, name: string) {
            const res = await renamePlaylistFolder(id, name)
            if (res.status === 200) {
                const f = this.folders.find(f => f.id === id)
                if (f) f.name = (res.data as PlaylistFolder).name
            }
        },
        async remove(id: number) {
            const res = await deletePlaylistFolder(id)
            if (res.status === 200) {
                this.folders = this.folders.filter(f => f.id !== id)
            }
        },
        /**
         * Move a playlist into a folder (folderId) or out to the top level
         * (folderId null), at `position` (-1 = append). Optimistically updates
         * local state first so the sidebar reacts instantly.
         */
        async move(playlistId: number, folderId: number | null, position = -1) {
            for (const f of this.folders) {
                f.items = f.items.filter(i => i !== playlistId)
            }

            if (folderId !== null) {
                const f = this.folders.find(f => f.id === folderId)
                if (f) {
                    const pos = position >= 0 && position <= f.items.length ? position : f.items.length
                    f.items.splice(pos, 0, playlistId)
                }
            }

            await movePlaylistToFolder(playlistId, folderId, position)
        },
        async reorder(positions: { id: number; position: number }[]) {
            for (const { id, position } of positions) {
                const f = this.folders.find(f => f.id === id)
                if (f) f.position = position
            }
            await reorderPlaylistFolders(positions)
        },
    },
})
