import { defineStore } from 'pinia'
import { ComputedRef } from 'vue'

import { useFuse } from '@/utils'

import { paths } from '@/config'
import { FuseTrackOptions } from '@/enums'
import { Artist, FuseResult, Playlist, Track } from '@/interfaces'
import { getPlaylist, removeBannerImage } from '@/requests/playlists'
import setColorsToStore from '@/utils/colortools/setColorsToStore'
import { Routes, router } from '@/router'
import { track_limit } from '../content-width'

export default defineStore('playlist-tracks', {
    state: () => ({
        info: <Playlist>{},
        query: '',
        allTracks: <Track[]>[],
        // True once every stored trackhash has been requested. Used to stop the
        // play path from re-fetching forever when info.count counts an
        // unresolvable (orphan) trackhash and thus never equals allTracks.length.
        allLoaded: false,
        // How many stored trackhashes have been requested so far. Pagination
        // must advance over the trackhash list (which includes orphans), NOT
        // over the resolved-track count, or orphans drift the offset.
        loadedHashCount: 0,
        colors: {
            bg: '',
            bg2: '',
            btn: '',
        },
        uploadImgUrl: '',
    }),
    actions: {
        /**
         * Fetches a single playlist information, and its tracks from the server
         * @param id The id of the playlist to fetch
         */
        async fetchAll(id: number, no_tracks = false, fetchAll = false) {
            const isFreshLoad = this.allTracks.length === 0
            // track_limit can be 0 before the layout is measured; fall back so
            // we never request an empty page or stall pagination.
            const pageSize = track_limit.value || 50
            const limit = fetchAll ? -1 : pageSize
            // Paginate over the stored trackhash list (start counts trackhashes,
            // incl. orphans), NOT the resolved-track count. Orphan hashes make
            // resolved-count < trackhash-index, so using allTracks.length as the
            // offset drifts and either re-requests or skips windows.
            const start = isFreshLoad || fetchAll ? 0 : this.loadedHashCount
            const playlist = await getPlaylist(id, no_tracks, start, limit)

            if (isFreshLoad) {
                this.info = playlist?.info || ({} as Playlist)
                this.createImageLink()

                this.resetColors()
                this.extractColors()
            }

            if (no_tracks) return

            const fetched = playlist?.tracks || []

            if (isFreshLoad || fetchAll) {
                // Fresh load or "load everything" pass: REPLACE the tracklist.
                // The old code appended from start=allTracks.length, but that
                // offset counts *resolved* tracks while the backend paginates
                // over *trackhashes*. When a playlist holds an orphan trackhash
                // (info.count > resolvable tracks) the offset drifts and an
                // already-loaded track gets re-appended -> duplicate row/gap.
                this.allTracks = fetched
            } else {
                // Incremental append (infinite scroll); dedupe by trackhash so a
                // stray re-fetch can never introduce duplicates.
                const have = new Set(this.allTracks.map(t => t.trackhash))
                this.allTracks.push(...fetched.filter(t => !have.has(t.trackhash)))
            }

            // Advance the trackhash cursor by the window we just requested.
            // info.count is len(trackhashes) (incl. orphans), so a short page
            // caused by orphans no longer fools us into stopping early.
            const total = this.info.count || 0
            this.loadedHashCount = fetchAll ? total : Math.min(start + pageSize, total)
            this.allLoaded = !total || this.loadedHashCount >= total
        },
        createImageLink() {
            this.info.image = paths.images.playlist + this.info.image
        },
        async removeBanner() {
            const { duration } = this.info
            const res = await removeBannerImage(this.info.id)

            if (!res) return

            this.info = { ...res, duration }
            this.extractColors()

            this.createImageLink()
        },

        /**
         * Updates the playlist header info. This is used when the playlist is
         * updated.
         * @param info Playlist info
         */
        updatePInfo(info: Playlist) {
            const { duration, count, images } = this.info

            this.info = info
            this.info = { ...this.info, duration, count, images }
            this.createImageLink()
            this.extractColors()
        },

        extractColors(img_url?: string) {
            if (this.info.has_image) {
                const url = img_url || paths.images.playlist + (this.info.thumb as string)

                setColorsToStore(this, url)
                return
            }

            // Extract from images[0] — the cover the header actually shows
            // (single cover, and the first collage tile). images[1] pulled the
            // colour from a cover the user never sees on this page.
            // medium (256²) thumbnail for a stable gradient-colour extraction
            // (xsmall is too small for a reliable dominant-swatch pick).
            const first = this.info.images[0]
            if (!first?.image) return

            setColorsToStore(this, paths.images.thumb.medium + first.image)
        },
        resetColors() {
            this.colors = {
                bg: '',
                bg2: '',
                btn: '',
            }
        },
        setImage(image: string) {
            this.info.image = image

            this.extractColors(this.info.image)
            this.info.has_image = true
        },
        removeTrackByIndex(index: number) {
            this.allTracks.splice(index, 1)
        },
        moveTrack(from: number, to: number) {
            const [item] = this.allTracks.splice(from, 1)
            this.allTracks.splice(to > from ? to - 1 : to, 0, item)
        },
        addTrack(track: Track) {
            this.allTracks.push(track)
        },
        // Clears the loaded tracklist and its pagination state. Call this when
        // switching to a different playlist so stale tracks/offset don't leak.
        resetTracks() {
            this.allTracks = []
            this.allLoaded = false
            this.loadedHashCount = 0
        },
        resetAll() {
            setTimeout(() => {
                if (router.currentRoute.value.name == Routes.playlist) return
                this.resetTracks()
            }, 1000)
        },
    },
    getters: {
        filteredTracks(): ComputedRef<FuseResult[]> {
            return useFuse(this.query, this.allTracks, FuseTrackOptions)
        },

        tracks(): Track[] {
            const tracks = this.filteredTracks.value.map((result: FuseResult) => {
                const t = {
                    ...result.item,
                    index: result.refIndex,
                }

                return t
            })

            return tracks
        },
    },
})
