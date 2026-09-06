import { defineStore } from 'pinia'
import { ComputedRef } from 'vue'

import { useFuse } from '@/utils'

import { FuseTrackOptions } from '@/enums'
import { Folder, FuseResult, Track } from '@/interfaces'
import { getFiles } from '@/requests/folders'
import { Routes, router } from '@/router'
import { track_limit } from '../content-width'

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
            const { tracks, folders, path, total } = await getFiles(
                fpath,
                restart ? 0 : this.allTracks.length,
                track_limit.value,
                !restart && this.allTracks.length > 0,
                {
                    sorttracksby: this.trackSortBy,
                    tracksort_reverse: this.trackSortReverse,
                    sortfoldersby: this.folderSortBy,
                    foldersort_reverse: this.folderSortReverse,
                }
            )

            if (restart || this.path !== fpath) {
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
        paths: ['trackSortBy', 'trackSortReverse', 'folderSortBy', 'folderSortReverse'],
        storage: localStorage,
    }
})
