import { defineStore } from 'pinia'
import { ComputedRef } from 'vue'

import { useFuse } from '@/utils'

import { FuseTrackOptions } from '@/enums'
import { Folder, FuseResult, Track } from '@/interfaces'
import { getFiles } from '@/requests/folders'
import { Routes, router } from '@/router'
import { track_limit } from '../content-width'

// The rest-of-folder load a search started, so the next keystroke joins it
// instead of asking the server once per letter. Keyed by the list it belongs
// to: `gen` moves whenever the list is rebuilt (folder or sort change), so a
// load for the old list is neither shared nor allowed to append into the new.
let searchLoad: { gen: number; path: string; done: Promise<void> } | null = null
let listGen = 0

function sortOptions(state: { trackSortBy: string; trackSortReverse: boolean; folderSortBy: string; folderSortReverse: boolean }) {
    return {
        sorttracksby: state.trackSortBy,
        tracksort_reverse: state.trackSortReverse,
        sortfoldersby: state.folderSortBy,
        foldersort_reverse: state.folderSortReverse,
    }
}

export default defineStore('FolderDirs&Tracks', {
    state: () => ({
        query: '',
        path: <string>{},
        allDirs: <Folder[]>[],
        allTracks: <Track[]>[],
        trackTotal: 0,
        trackSortBy: 'default',
        folderSortBy: 'name',
        trackSortReverse: false,
        folderSortReverse: false,
    }),
    actions: {
        async fetchAll(fpath: string, restart?: boolean) {
            // A search belongs to the folder it was typed in.
            if (this.path !== fpath) this.query = ''
            // Any rebuild of the list orphans a search load that is still running.
            const rebuild = restart || this.path !== fpath
            if (rebuild) listGen += 1

            const { tracks, folders, path, total } = await getFiles(
                fpath,
                restart ? 0 : this.allTracks.length,
                track_limit.value,
                !restart && this.allTracks.length > 0,
                sortOptions(this)
            )

            if (rebuild) {
                this.allTracks = []
                this.allDirs = []
                this.trackTotal = 0
            }

            this.path = fpath

            // If the requested path was redirected, update store path
            if (path !== fpath) {
                fpath = path
            }

            this.trackTotal = total
            ;[this.path, this.allDirs] = [fpath, folders]
            this.allTracks = this.allTracks.concat(tracks)

            // A search typed while this rebuilt the list found it gone: finish
            // it on the new list.
            if (rebuild && this.query) void this.setQuery(this.query)
        },
        /**
         * The folder's search. It answers over the WHOLE folder, not the pages
         * scrolled so far: the browser's find only sees the rows the virtual
         * scroller has rendered. So the first letter loads the rest, once.
         */
        async setQuery(query: string) {
            this.query = query
            if (!query || this.allTracks.length >= this.trackTotal) return
            const path = this.path
            const running = searchLoad
            if (running && running.gen === listGen && running.path === path) {
                await running.done
                return
            }
            const gen = listGen
            // A failed load leaves the search on the pages it has; the next
            // keystroke tries again. Never a rejection for the field to drop.
            const done: Promise<void> = this.loadRest(path, gen)
                .catch(() => {})
                .finally(() => {
                    if (searchLoad?.done === done) searchLoad = null
                })
            searchLoad = { gen, path, done }
            await done
        },
        async loadRest(path: string, gen: number) {
            const start = this.allTracks.length
            // limit -1: everything from `start` on (folderslib slices by it).
            const { tracks } = await getFiles(path, start, -1, true, sortOptions(this))

            // The answer can outlive the list: navigated away or re-sorted meanwhile.
            if (gen !== listGen || this.path !== path) return

            // Dedupe by file: a page the scroller requested at the same offset
            // may have landed first.
            const have = new Set(this.allTracks.map(t => t.filepath))
            this.allTracks.push(...tracks.filter(t => !have.has(t.filepath)))
        },
        // The folders half of the sort. `folderSortBy` and `folderSortReverse`
        // were already in the state and already sent to the server on every
        // fetch — there was simply no way to change them, so every library
        // sorted its folders by name for ever. The backend has accepted
        // "default" | "name" | "lastmod" | "trackcount" the whole time.
        setFolderSortKey(key: string) {
            // Same gesture as the tracks sort below: picking the current key
            // again flips the direction rather than doing nothing.
            if (key === this.folderSortBy) {
                this.folderSortReverse = !this.folderSortReverse
            } else {
                this.folderSortBy = key
                this.folderSortReverse = true
            }

            this.fetchAll(this.path, true)
        },
        setFolderTrackSortKey(key: string) {
            // INFO: If the key is the same as the current key, reverse the sort order
            if (key === this.trackSortBy) {
                this.trackSortReverse = !this.trackSortReverse
            } else {
                this.trackSortBy = key
                this.trackSortReverse = true
            }

            this.fetchAll(this.path, true)
        },
        resetQuery() {
            this.query = ''
        },
        resetAll() {
            setTimeout(() => {
                if (router.currentRoute.value.name == Routes.folder) return
                ;[this.allDirs, this.allTracks] = [[], []]
                this.resetQuery()
            }, 5000)
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
        dirs(): Folder[] {
            const dirs = useFuse(this.query, this.allDirs, {
                keys: ['name'],
            })

            return dirs.value.map(result => {
                return result.item
            })
        },
    },
    persist: {
        pick: ['trackSortBy', 'trackSortReverse', 'folderSortBy', 'folderSortReverse'],
        storage: localStorage,
    }
})
