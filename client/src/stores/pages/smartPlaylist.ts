import { defineStore } from 'pinia'

import { SmartPlaylistDetail, Track } from '@/interfaces'
import { getSmartPlaylist } from '@/requests/smartPlaylists'
import { track_limit } from '../content-width'

/**
 * One smart playlist's page: its rules and the tracks they hold now, read a
 * page at a time. Unlike a stored playlist there is no trackhash cursor: the
 * server counts the tracks it evaluates, and nothing is orphaned, so the next
 * page starts at `tracks.length`.
 */
export default defineStore('smart-playlist-page', {
    state: () => ({
        info: <SmartPlaylistDetail>{},
        tracks: <Track[]>[],
        allLoaded: false,
        loading: false,
        // Bumped by every reset: an answer that comes back after a reset
        // belongs to the playlist the page had before, and is dropped.
        epoch: 0,
    }),
    getters: {
        count(): number {
            return this.info.count ?? 0
        },
    },
    actions: {
        /**
         * The next page of the playlist with `id`. A reset (opening it, or a
         * save of its rules) starts over at the top.
         */
        async fetchPage(id: number | string, reset = false) {
            if (!reset && this.loading) return

            const epoch = reset ? ++this.epoch : this.epoch
            const start = reset ? 0 : this.tracks.length
            const limit = track_limit.value || 50

            if (!reset) this.loading = true
            try {
                const data = await getSmartPlaylist(id, start, limit)
                if (epoch !== this.epoch) return

                if (!data) {
                    if (reset) {
                        this.info = <SmartPlaylistDetail>{}
                        this.tracks = []
                        this.allLoaded = true
                    }
                    return
                }

                if (reset) {
                    this.info = data.info
                    this.tracks = data.tracks
                } else {
                    // Dedupe by trackhash: a stray second request must not repeat rows.
                    const have = new Set(this.tracks.map(t => t.trackhash))
                    this.tracks.push(...data.tracks.filter(t => !have.has(t.trackhash)))
                }

                this.allLoaded = data.tracks.length === 0 || this.tracks.length >= data.info.count
            } finally {
                if (!reset) this.loading = false
            }
        },

        resetAll() {
            this.epoch++
            this.info = <SmartPlaylistDetail>{}
            this.tracks = []
            this.allLoaded = false
            this.loading = false
        },
    },
})
