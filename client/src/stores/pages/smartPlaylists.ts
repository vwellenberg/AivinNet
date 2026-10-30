import { defineStore } from 'pinia'

import { SmartPlaylist } from '@/interfaces'
import { getSmartPlaylists } from '@/requests/smartPlaylists'

/**
 * The smart playlists of the user, rules only. The playlists page and the
 * editor read it; a save or a delete keeps it in step without a refetch.
 */
export default defineStore('smartPlaylists', {
    state: () => ({
        playlists: <SmartPlaylist[]>[],
    }),
    actions: {
        /** A failed fetch keeps the list as it is. @returns whether the list is fresh */
        async fetchAll() {
            const playlists = await getSmartPlaylists()
            if (!playlists) return false
            this.playlists = playlists
            return true
        },
        /** Puts a saved playlist in the list: replaces it, or adds it at the top. */
        upsert(playlist: SmartPlaylist) {
            const i = this.playlists.findIndex(p => p.id === playlist.id)
            if (i >= 0) this.playlists.splice(i, 1, playlist)
            else this.playlists.unshift(playlist)
        },
        remove(id: number) {
            this.playlists = this.playlists.filter(p => p.id !== id)
        },
    },
})
