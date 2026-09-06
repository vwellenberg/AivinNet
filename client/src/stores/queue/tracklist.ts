import { defineStore } from 'pinia'

import useDeviceSync from '@/stores/devicesync'
import useInterface from '@/stores/interface'
import { NotifType, useToast } from '@/stores/notification'
import usePlaylists from '@/stores/pages/playlists'
import { usePlayer } from '@/stores/player'
import useQueue from '@/stores/queue'
import useSettings from '@/stores/settings'

import { FromOptions } from '@/enums'
import {
    fromAlbum,
    fromArtist,
    fromFav,
    fromFolder,
    fromPlaylist,
    fromPlaylistFolder,
    fromSearch,
    Track,
} from '@/interfaces'
import { resolveQueueMove } from '@/utils/queueMove'
import { shiftAfterRemove } from '@/utils/shuffleIndexes'

export type From =
    | fromFolder
    | fromAlbum
    | fromPlaylist
    | fromPlaylistFolder
    | fromSearch
    | fromArtist
    | fromFav

export function shuffleArray<T>(items: T[]): T[] {
    const shuffled = items.slice()
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    return shuffled
}
export default defineStore('tracklist', {
    state: () => ({
        from: {} as From,
        tracklist: <Track[]>[],
    }),
    actions: {
        loadFromLocalStorage() {
            const queue = localStorage.getItem('queue')

            if (queue) {
                const parsed = JSON.parse(queue)
                this.from = parsed.from
                this.tracklist = parsed.tracks
            }
        },
        setNewList(tracklist: Track[]) {
            if (this.tracklist !== tracklist) {
                this.tracklist = []
                this.tracklist.push(...tracklist)
            }

            const { focusCurrentInSidebar } = useInterface()
            focusCurrentInSidebar(1000)
            usePlayer().clearNextAudio()

            // Shuffle history and the pre-rolled target are indices into the OLD
            // list — meaningless now. Reset before the next roll.
            const queue = useQueue()
            queue.shuffleRecent = []
            queue.rollShuffleNext()
        },
        setFromFolder(path: string, tracks: Track[]) {
            // remove trailing slash
            path = path.replace(/\/$/, '')
            const name = path.split('/').pop()
            this.from = <fromFolder>{
                type: FromOptions.folder,
                path: tracks[0].folder,
                name: name?.trim() === '' ? path : name,
            }
            this.setNewList(tracks)
        },
        setFromAlbum(name: string, albumhash: string, tracks: Track[]) {
            this.from = <fromAlbum>{
                type: FromOptions.album,
                name: name,
                albumhash: albumhash,
            }

            this.setNewList(tracks)
        },
        setFromPlaylist(name: string, pid: number, tracks: Track[]) {
            this.from = <fromPlaylist>{
                type: FromOptions.playlist,
                name: name,
                id: pid,
            }

            this.setNewList(tracks)

            // Library sidebar recency: bubble the played playlist to the top
            // of its group (pinned/un-pinned). Fire-and-forget so playback
            // never waits on the reorder request.
            if (useSettings().move_played_playlist_to_top) {
                void usePlaylists().movePlayedToTop(pid)
            }
        },
        setFromPlaylistFolder(name: string, id: number, tracks: Track[]) {
            this.from = <fromPlaylistFolder>{
                type: FromOptions.playlistFolder,
                name: name,
                id: id,
            }

            this.setNewList(tracks)
        },
        setFromSearch(query: string, tracks: Track[]) {
            this.from = <fromSearch>{
                type: FromOptions.search,
                query: query,
            }

            this.setNewList(tracks)
        },
        setFromArtist(artisthash: string, name: string, tracks: Track[]) {
            this.from = <fromArtist>{
                type: FromOptions.artist,
                artisthash: artisthash,
                artistname: name,
            }

            this.setNewList(tracks)
        },
        setFromFav(tracks: Track[]) {
            this.from = <fromFav>{
                type: FromOptions.favorite,
            }

            this.setNewList(tracks)
        },
        addTrack(track: Track) {
            return this.addTracks([track])
        },
        addTracks(tracks: Track[]) {
            this.insertAt(tracks, this.tracklist.length)

            const Toast = useToast()
            Toast.showNotification(`Added ${tracks.length} tracks to queue`, NotifType.Success)
        },
        /**
         * `aimNext` marks this insert as a "play next": under shuffle the
         * pre-rolled target is moved ONTO the inserted rows instead of being
         * carried past them.
         *
         * It is a parameter rather than a call the caller makes afterwards, and
         * both reasons are bugs that were caught in review:
         *
         * - It has to happen BEFORE the preload check below. Aiming afterwards
         *   left `tracklist[nextindex]` looking unchanged, so the audio already
         *   preloaded for the old target survived and played instead of the row
         *   the user had just queued.
         * - It has to sit behind the group seam. Aiming from the outside also
         *   fired on the intercepted path, where nothing was spliced locally —
         *   moving this device's idea of "next" out of step with the group.
         */
        insertAt(tracks: Track[], index: number, aimNext = false) {
            // Group mode: local queue edits ("play next" / "add to queue" funnel
            // through here) must go through the server, or this device's list
            // silently diverges from the authoritative group queue.
            const ds = useDeviceSync()
            if (ds.joined && !ds.applying) {
                ds.intercept('insertTracks', tracks, index)
                return
            }

            const player = usePlayer()
            const queue = useQueue()

            // Which track was queued up as "next" BEFORE the splice? Comparing
            // the TRACK is the only check that holds in both play orders. The
            // old test compared the insert POSITION against `nextindex`, which
            // is only ever true in sequential order — there `nextindex` is
            // `currentindex + 1`, exactly where "play next" inserts. Under
            // shuffle `nextindex` is a pre-rolled random index somewhere else
            // in the list, so the same insert displaced the preloaded row
            // without the condition ever firing.
            const nextBefore = this.tracklist[queue.nextindex]

            this.tracklist.splice(index, 0, ...tracks)

            // The shuffle bookkeeping is ABSOLUTE indexes: everything from
            // `index` on just moved back by `tracks.length`, so the pre-rolled
            // target and the history have to travel with them or they silently
            // start naming different tracks.
            //
            // ⚠️ `currentindex` is deliberately NOT shifted here, and that only
            // holds because no caller inserts at or below the playing row:
            // `addTracks` appends, `insertAfterCurrent` and `playTrackNext` use
            // `currentindex + 1`. A future caller passing a lower index has to
            // move it too — otherwise the playing track slides down while the
            // index stays put, and the UI names a different song than the audio.
            queue.shiftShuffleIndexes(index, tracks.length)

            if (aimNext) queue.aimShuffleNext(index)

            if (this.tracklist[queue.nextindex] !== nextBefore) {
                player.clearNextAudio()
            }
        },
        /**
         * Reorder the queue itself: drag a row in the queue panel, or mirror a
         * playlist reorder into the queue that is playing that playlist.
         *
         * `to` is the drop GAP, the same convention SongItem emits and
         * `playlistMove.ts` uses. The index arithmetic — including where the
         * playing track ends up — lives in `utils/queueMove.ts` and is tested
         * against a model of this splice.
         */
        moveTrack(from: number, to: number) {
            const queue = useQueue()
            const move = resolveQueueMove(this.tracklist.length, from, to, queue.currentindex)
            if (!move) return

            // Group mode: the same seam as insertAt/removeByIndex. Splicing the
            // local list leaves the server's queue_id untouched, so nothing
            // re-mirrors and every other device keeps playing the old order.
            const ds = useDeviceSync()
            if (ds.joined && !ds.applying) {
                ds.intercept('moveTrack', from, to)
                return
            }

            const [track] = this.tracklist.splice(from, 1)
            this.tracklist.splice(move.finalIndex, 0, track)

            // A reorder is not a track change: whatever is playing keeps playing,
            // it just sits at a different index now.
            queue.setCurrentIndex(move.currentindex)

            // The shuffle bookkeeping needs the same treatment as currentindex,
            // and for the same reason — the dragged row may have passed over it.
            queue.remapShuffleIndexes(from, move.finalIndex)

            // Whatever was preloaded as "next" may be a different track now.
            usePlayer().clearNextAudio()
        },
        clearList() {
            this.tracklist = []
            this.from = {} as From
        },
        /**
         * Reorder the queue once (the panel's "Shuffle" action).
         *
         * `avoidFront` is the index of the track playing right now: it must not
         * land first, because the caller restarts playback at index 0 — and a
         * shuffle that restarts the same song at 0:00 is the one outcome nobody
         * presses that button for.
         */
        shuffleList(avoidFront?: number) {
            const playing = avoidFront === undefined ? undefined : this.tracklist[avoidFront]
            const shuffled = shuffleArray(this.tracklist)

            if (playing && shuffled.length > 1 && shuffled[0] === playing) {
                const swap = 1 + Math.floor(Math.random() * (shuffled.length - 1))
                ;[shuffled[0], shuffled[swap]] = [shuffled[swap], shuffled[0]]
            }

            this.tracklist = shuffled

            // Every row has a new number now, so both shuffle indexes name
            // arbitrary tracks — the same situation setNewList resets for, and
            // the reason it does. Without this, Previous jumped to a track that
            // never played and the next roll avoided the wrong ones.
            //
            // ⚠️ Clear, do NOT roll. `rollShuffleNext` starts by pushing
            // `currentindex` into the history, and at this point that is still
            // the PRE-shuffle index — it would put a stale number straight back
            // into the array just emptied. The caller (`queue.shuffleQueue`)
            // sets `currentindex = 0` and calls `play()` right after, and
            // `play` rolls with the corrected index.
            const queue = useQueue()
            queue.shuffleRecent = []
            queue.shuffleNextIndex = null
            usePlayer().clearNextAudio()
        },
        removeByIndex(index: number) {
            // Group mode: same seam as insertAt. A local splice would leave the
            // server queue untouched, so its queue_id never changes, nothing
            // re-mirrors — and the mirrored currentindex then points at the
            // wrong track on every device.
            const ds = useDeviceSync()
            if (ds.joined && !ds.applying) {
                ds.intercept('removeTracks', index)
                return
            }

            const queue = useQueue()
            const { currentindex, playing, setCurrentIndex } = queue
            const player = usePlayer()

            if (this.tracklist.length == 1) {
                return this.clearList()
            }

            // Same reasoning as insertAt: read the track, not the index. Taken
            // before anything below can move the queue on.
            const nextBefore = this.tracklist[queue.nextindex]

            if (index == currentindex) {
                // Who takes over? `nextindex` answers that everywhere except
                // `repeat: 'one'`, where it hands back the row that is about to
                // disappear — there the honest answer is the row below it
                // (wrapping), which is what sequential order gives anyway.
                // Repeating a track that was just deleted is not a state the
                // queue can be in.
                const successor =
                    queue.nextindex === index
                        ? index === this.tracklist.length - 1
                            ? 0
                            : index + 1
                        : queue.nextindex

                // Written out rather than `playNext()` / `moveForward()`: those
                // read `nextindex` themselves, so the corrected successor could
                // not reach them. The device-sync seam they carry is already
                // spent — this action returned above if a group is joined.
                if (playing) {
                    queue.play(successor)
                } else {
                    setCurrentIndex(successor)
                    // `moveForward` rolls, and for the same reason: the current
                    // track changed, so the pre-rolled target is stale.
                    queue.rollShuffleNext()

                    // ...and the loaded audio is still the row being deleted.
                    // `moveForward` moved the pointer only, so resuming after a
                    // pause played the DELETED track: `playPause` reloads solely
                    // when `currentTime === 0`, and a pause mid-track is exactly
                    // when it is not. `playCurrent` swaps the source and leaves
                    // it paused — `onAudioCanPlay` pauses again unless
                    // `queue.playing`, which is false in this branch.
                    player.playCurrent()

                    // The clock belongs to the source, and swapping it while
                    // paused does not touch it: `onAudioCanPlay` bails before
                    // `setDurationFromFile` whenever `playing` is false. The bar
                    // would read the DELETED track's length over a source at
                    // 0:00 — and the ±10s hotkeys seek relative to that number,
                    // so a stale position lands the new track minutes off.
                    queue.setCurrentDuration(0)
                    queue.setDurationFromFile(this.tracklist[successor].duration || 0)
                }

                // The successor's index is a PRE-splice number, and the splice
                // below renumbers everything after the removed row. Writing
                // `index` back instead — which is what stood here — is only
                // right in sequential order, where the successor happens to be
                // `index + 1` and therefore lands exactly on `index`. Under
                // shuffle it named whatever row slid into the gap while a
                // different one was playing (#506).
                //
                // Never null: `successor` is not `index` by construction.
                setCurrentIndex(shiftAfterRemove(successor, index) as number)
            }

            if (index < currentindex) {
                setCurrentIndex(currentindex - 1)
            }

            this.tracklist.splice(index, 1)

            // The removed row renumbers everything behind it, and it may BE the
            // pre-rolled shuffle target — in which case there is nothing to
            // re-point to and the store rolls again.
            queue.dropShuffleIndex(index)

            if (this.tracklist[queue.nextindex] !== nextBefore) {
                player.clearNextAudio()
            }
        },
        // Apply a favourite flip to every copy of the track in the queue. By
        // hash and idempotent by value — see helpers/favoriteHandler.ts, the
        // only caller, for why it is neither by index nor a toggle any more.
        setFav(trackhash: string, is_favorite: boolean) {
            this.tracklist.forEach(track => {
                if (track.trackhash === trackhash) {
                    track.is_favorite = is_favorite
                }
            })
        },
        // Apply an edited track's new tags to any copies already in the queue
        // (matched by the pre-edit trackhash). currentindex is left untouched, so
        // `currenttrack`/`currenttrackhash` simply re-derive — the now-playing bar
        // and current-row highlight follow the new tags without reloading audio.
        retagTrack(oldHash: string, updated: Track) {
            this.tracklist.forEach(track => {
                if (track.trackhash === oldHash) {
                    Object.assign(track, updated)
                }
            })
        },
        /**
         * "Play next": drop tracks into the slot right behind the playing one.
         *
         * Goes through `insertAt` rather than splicing itself — that is the only
         * place the queue is allowed to grow. Splicing here directly skipped BOTH
         * of its jobs: the group-session seam (the local list grew while the
         * server's queue_id stayed put, so nothing re-mirrored and every other
         * device kept the old queue with a currentindex pointing at the wrong
         * track) and the `clearNextAudio()` right after it — in sequential order
         * the insert lands exactly on `nextindex`, so the already-preloaded
         * audio was the track this insert just displaced.
         */
        insertAfterCurrent(tracks: Track[]) {
            const { currentindex } = useQueue()

            // `aimNext`: under shuffle the pre-rolled target points elsewhere
            // and travels with the splice, so it would sail right past these
            // rows. "Play next" has to mean next in both play orders.
            this.insertAt(tracks, currentindex + 1, true)

            // Shown in the group case too (same as addTracks): the insert was
            // accepted, it just travels via the server.
            const Toast = useToast()
            Toast.showNotification(`Added ${tracks.length} tracks to queue`, NotifType.Success)
        },
    },
    getters: {
        length(): number {
            return this.tracklist.length
        },
    },
    persist: true,
})
