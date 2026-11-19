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
import { PlaylistFilters, PlaylistSortKey, SORT_DEFAULT_REVERSE, isViewShaped, noFilters, shapeTracks } from '@/utils/playlistView'

// The full load a search, sort or filter started, so the next keystroke or
// click joins it instead of asking the server for the whole playlist again.
// Keyed by playlist: a load still running for the previous one must not stand
// in for this one's.
let searchLoad: { id: number; done: Promise<void> } | null = null

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
        // The edit mode (components/PlaylistView/EditList.vue): the list is
        // reordered by grip and pruned by button instead of played.
        editing: false,
        // The track the edit mode opened on (from its context menu), by hash,
        // so the list can scroll it into view. Empty when opened from the page.
        editFocus: '',
        // The view's sort and filter (components/PlaylistView/AfterHeader.vue).
        // They shape what is DRAWN and what plays from it; the stored order is
        // never touched by them.
        sortBy: <PlaylistSortKey>'',
        sortReverse: false,
        filters: noFilters(),
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

            // The answer can outlive the page: navigated to another playlist
            // meanwhile, this list belongs to the old one and must not replace
            // or extend the new one's tracks.
            if (!isFreshLoad && this.info.id !== id) return

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
        /**
         * Drop a row the server has already removed from the playlist.
         *
         * The server's list is one shorter now, so the header and the
         * pagination cursor follow: `info.count` and `info.duration` are what
         * the header shows, and `loadedHashCount` is the offset of the next
         * page — left as it was, the next page would start one hash too late
         * and silently skip a track. (The re-fetch that used to follow a
         * removal did none of this: with tracks loaded, `fetchAll(id, true)`
         * returns before touching `info`.)
         */
        removeTrackByIndex(index: number) {
            const [gone] = this.allTracks.splice(index, 1)
            if (!gone) return

            if (this.info.count) this.info.count -= 1
            if (this.info.duration && gone.duration) {
                this.info.duration = Math.max(0, this.info.duration - gone.duration)
            }
            if (this.loadedHashCount) this.loadedHashCount -= 1
        },
        /**
         * Enter the edit mode. It works on the WHOLE list, so the rest is
         * loaded first — a grip can only move a row between rows that exist,
         * and a playlist that stops at its first page would offer a
         * reordering of page one. The in-playlist search and the sort and
         * filter are cleared: the edit list shows every track in stored order,
         * never a filtered or re-sorted view.
         */
        async startEditing(focusTrackhash = '') {
            const id = this.info.id
            if (!this.allLoaded) await this.fetchAll(id, false, true)
            // Switched playlists while the full list loaded: opening the edit
            // mode now would show one playlist's tracks under another's header,
            // and "Remove" would post the old hashes to the new playlist's id.
            if (this.info.id !== id) return
            this.query = ''
            this.clearView()
            this.editFocus = focusTrackhash
            this.editing = true
        },
        /**
         * Loads the WHOLE playlist, once per playlist. The in-playlist search,
         * the sort and the filters all answer over every track, not the pages
         * scrolled so far, so the first of them loads the rest; the ones after
         * it join the same load. Never rejects: a failed load leaves the view
         * on the pages it has, and the next try starts it again.
         */
        async ensureAllLoaded(): Promise<void> {
            if (this.allLoaded) return
            const id = this.info.id
            if (searchLoad?.id !== id) {
                // A failed load leaves the view on the pages it has; the next
                // try starts it again. Never a rejection for the caller to drop.
                const done = this.fetchAll(id, false, true)
                    .catch(() => {})
                    .finally(() => {
                        if (searchLoad?.done === done) searchLoad = null
                    })
                searchLoad = { id, done }
            }
            await searchLoad.done
        },
        /**
         * The in-playlist search. It answers over the WHOLE playlist, not the
         * pages scrolled so far: a long list loads page by page, and the browser's
         * own find (Cmd/Ctrl+F) only sees the rows the virtual scroller has in
         * the DOM — a track further down was simply not found. So the first
         * search loads the rest, like the play path and the edit mode do.
         */
        async setQuery(query: string) {
            this.query = query
            if (!query) return
            await this.ensureAllLoaded()
        },
        /**
         * Picks a sort key. Picking the key that is already active flips its
         * direction; picking a new one starts it in its own default direction
         * (newest first for "Date added", most played first for "Plays").
         * Sorting needs the whole list, the same as a search does.
         */
        async setSort(key: PlaylistSortKey) {
            if (key && key === this.sortBy) {
                this.sortReverse = !this.sortReverse
            } else {
                this.sortBy = key
                this.sortReverse = key ? SORT_DEFAULT_REVERSE[key] : false
            }
            if (this.viewShaped) await this.ensureAllLoaded()
        },
        async toggleFilter(name: keyof PlaylistFilters) {
            this.filters[name] = !this.filters[name]
            if (this.viewShaped) await this.ensureAllLoaded()
        },
        // Back to the playlist's own order and no filter. A view belongs to the
        // playlist it was set on, so it is dropped with the playlist.
        clearView() {
            this.sortBy = ''
            this.sortReverse = false
            this.filters = noFilters()
        },
        stopEditing() {
            this.editing = false
            this.editFocus = ''
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
            // A search belongs to the playlist it was typed on.
            this.query = ''
            this.clearView()
            this.stopEditing()
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

        // Whether the view is sorted or filtered at all. The play path and the
        // drag handle read it: what is on screen then is not the whole list.
        viewShaped(): boolean {
            return isViewShaped(this.sortBy, this.filters)
        },

        tracks(): Track[] {
            // `index` stays the position in allTracks, whatever the sort: the
            // play path and the drag reorder both address the stored list by it.
            const list = this.filteredTracks.value.map((result: FuseResult) => {
                const t = {
                    ...result.item,
                    index: result.refIndex,
                }

                return t
            })

            return shapeTracks(list, this.sortBy, this.sortReverse, this.filters)
        },
    },
})
