import { router, Routes } from '@/router'
import { defineStore } from 'pinia'

import { favType } from '@/enums'
import updateMediaNotif from '@/helpers/mediaNotification'
import { Track } from '@/interfaces'
import { isFavorite } from '@/requests/favorite'
import useFavorites from './favorites'
import useInterface from './interface'

import { audioSource, getUrl, usePlayer } from '@/stores/player'
import useDeviceSync from './devicesync'
import useLyrics from './lyrics'
import { NotifType, useToast } from './notification'
import useTracklist from './queue/tracklist'
import useSettings from './settings'
import { remapAfterMove, shiftAfterInsert, shiftAfterRemove } from '@/utils/shuffleIndexes'
import { pickShuffleIndex, pushRecent } from '@/utils/shufflePicker'

/**
 * How many recently played indices permanent shuffle avoids. Small enough that a
 * short queue still has candidates, big enough that a long queue stops feeling
 * like it keeps returning to the same handful of tracks.
 */
const SHUFFLE_HISTORY_LIMIT = 10

export default defineStore('Queue', {
    state: () => ({
        duration: {
            current: 0,
            full: 0,
        },
        currentindex: 0,
        playing: false,
        /** Whether track has been triggered manually */
        manual: true,
        /**
         * The index permanent shuffle will jump to next, rolled ahead of time.
         *
         * `nextindex` is a getter that also feeds the next-track audio preload and
         * the group-session `track_change` broadcast, so it must return the same
         * value every time it is read — rolling a random number inside it would
         * hand out a different track on each read. The roll therefore happens in
         * an action (`rollShuffleNext`) and lands here.
         */
        shuffleNextIndex: <number | null>null,
        /** Recently played indices, so shuffle doesn't circle a handful of tracks. */
        shuffleRecent: <number[]>[],
    }),
    actions: {
        setPlaying(val: boolean) {
            this.playing = val
        },
        setDurationFromFile(duration: number) {
            this.duration.full = duration
        },
        setManual(val: boolean) {
            this.manual = val
        },
        setCurrentDuration(duration: number) {
            this.duration.current = duration
        },
        setCurrentIndex(val: number) {
            this.currentindex = val
        },
        play(index: number = 0, manual = true) {
            const ds = useDeviceSync()
            if (ds.joined && !ds.applying) {
                ds.intercept('play', index)
                return
            }

            const { tracklist } = useTracklist()
            if (tracklist.length === 0) return

            this.playing = true
            this.currentindex = index
            this.manual = manual

            // The current track changed, so the pre-rolled shuffle target is stale.
            this.rollShuffleNext()

            const { playCurrent } = usePlayer()
            const { focusCurrentInSidebar } = useInterface()

            playCurrent()
            focusCurrentInSidebar()
        },
        /**
         * Start a source that was just put into the queue — the header "Play",
         * a card's play disc, "Play" in a context menu.
         *
         * With permanent shuffle on this enters at a RANDOM track instead of the
         * first row: pressing Play on a playlist should not open with the same
         * song every time (Spotify's behaviour, and what "Zufallswiedergabe"
         * promises). Clicking a specific row is a different intent and keeps its
         * index — that path calls `play(index)` and is untouched.
         *
         * The track playing right now is excluded, so hitting Play again on the
         * source you are already listening to moves on instead of restarting the
         * same song at 0:00.
         */
        playSource() {
            const settings = useSettings()
            const { tracklist } = useTracklist()

            if (!settings.shuffle || tracklist.length <= 1) {
                this.play(0)
                return
            }

            this.play(pickShuffleIndex(tracklist.length, this.currentindex))
        },
        /**
         * Roll the next shuffle target (no-op unless permanent shuffle is on).
         * Call this whenever the current track or the tracklist changes.
         */
        rollShuffleNext() {
            const settings = useSettings()

            if (!settings.shuffle) {
                this.shuffleNextIndex = null
                return
            }

            const { tracklist } = useTracklist()

            this.shuffleRecent = pushRecent(this.shuffleRecent, this.currentindex, SHUFFLE_HISTORY_LIMIT)
            this.shuffleNextIndex = pickShuffleIndex(tracklist.length, this.currentindex, this.shuffleRecent)
        },
        /**
         * Rows were INSERTED at `from`: re-point the shuffle bookkeeping so it
         * keeps naming the same tracks. Arithmetic and the reasoning behind
         * re-pointing instead of re-rolling: `utils/shuffleIndexes.ts`.
         */
        shiftShuffleIndexes(from: number, count: number) {
            if (count <= 0) return

            if (this.shuffleNextIndex !== null) {
                this.shuffleNextIndex = shiftAfterInsert(this.shuffleNextIndex, from, count)
            }

            this.shuffleRecent = this.shuffleRecent.map(i => shiftAfterInsert(i, from, count))
        },
        /**
         * "Play next" means next — in every play order.
         *
         * Sequential order gets this for free (`nextindex` is `currentindex + 1`,
         * which is where the insert landed). Under shuffle it does not: the
         * pre-rolled target points somewhere else entirely and, now that it
         * travels with the splice, it stays there. Without this the whole
         * "Play next" family would be a silent no-op while shuffle is on.
         */
        aimShuffleNext(index: number) {
            const { shuffle } = useSettings()
            if (!shuffle) return

            this.shuffleNextIndex = index
        },
        /**
         * The row at `index` was REMOVED. A tracked index pointing at it no
         * longer names anything: the target is re-rolled, history entries are
         * dropped. Everything behind it moves up by one.
         */
        dropShuffleIndex(index: number) {
            this.shuffleRecent = this.shuffleRecent
                .map(i => shiftAfterRemove(i, index))
                .filter((i): i is number => i !== null)

            if (this.shuffleNextIndex === null) return

            const shifted = shiftAfterRemove(this.shuffleNextIndex, index)
            if (shifted === null) {
                this.rollShuffleNext()
                return
            }

            this.shuffleNextIndex = shifted
        },
        /**
         * A row was MOVED (queue drag). `finalIndex` is the post-splice index
         * from `resolveQueueMove`, not the drop gap.
         */
        remapShuffleIndexes(from: number, finalIndex: number) {
            if (this.shuffleNextIndex !== null) {
                this.shuffleNextIndex = remapAfterMove(this.shuffleNextIndex, from, finalIndex)
            }

            this.shuffleRecent = this.shuffleRecent.map(i => remapAfterMove(i, from, finalIndex))
        },
        /**
         * Flip permanent shuffle ("random track") mode. Separate from
         * `shuffleQueue()`, which reorders the visible queue once.
         */
        toggleShuffle() {
            const settings = useSettings()
            settings.shuffle = !settings.shuffle

            if (!settings.shuffle) this.shuffleRecent = []

            // Re-roll straight away so `next` (and the audio preload behind it)
            // reflects the new mode without waiting for a track change.
            this.rollShuffleNext()
        },
        playPause() {
            const ds = useDeviceSync()
            if (ds.joined && !ds.applying) {
                ds.intercept('playPause')
                return
            }

            if (audioSource.playingSource.src === '') {
                this.play(this.currentindex)
                return
            }

            if (audioSource.playingSource.paused && !this.playing) {
                audioSource.playingSource.currentTime === 0 ? this.play(this.currentindex) : null
                audioSource.playPlayingSource()
                this.playing = true
                return
            }

            audioSource.pausePlayingSource()
            this.playing = false

            // The lyrics advance is a wall-clock timer against a boundary on the
            // media clock. Pausing stops the media clock but not the timer, so a
            // pending one has to go — resuming arms a new one from the position
            // that is then current.
            useLyrics().clearNextLineTimer()
        },
        autoPlayNext() {
            // Group mode: the scrobble leader plans a server-scheduled
            // track_change; every device advances via that command, not locally.
            if (useDeviceSync().joined) return

            const settings = useSettings()
            const { focusCurrentInSidebar } = useInterface()
            const { tracklist } = useTracklist()
            const is_last = this.currentindex === tracklist.length - 1

            if (settings.repeat == 'one') {
                this.play(this.currentindex, false)
                return
            }

            // Permanent shuffle: follow the pre-rolled random target instead of
            // walking the queue in order. repeat 'one' above still wins.
            if (settings.shuffle && tracklist.length > 1) {
                this.play(this.nextindex, false)
                return
            }

            if (settings.repeat == 'all') {
                this.play(is_last ? 0 : this.currentindex + 1, false)
                return
            }

            const resetQueue = () => {
                this.currentindex = 0
                audioSource.playingSource.src = getUrl(this.next.filepath, this.next.trackhash, settings.use_legacy_streaming_endpoint)
                audioSource.pausePlayingSource()
                this.playing = false

                updateMediaNotif()
                focusCurrentInSidebar()
            }

            !is_last ? this.play(this.currentindex + 1, false) : resetQueue()
        },
        playNext() {
            const ds = useDeviceSync()
            if (ds.joined && !ds.applying) {
                ds.intercept('playNext')
                return
            }

            this.play(this.nextindex)
        },
        playPrev() {
            const ds = useDeviceSync()
            if (ds.joined && !ds.applying) {
                ds.intercept('playPrev')
                return
            }

            const lyrics = useLyrics()

            if (audioSource.playingSource.currentTime > 3) {
                this.seek(0)
                lyrics.setCurrentLine(-1)
                return
            }

            this.play(this.previndex)
            usePlayer().clearNextAudio()
        },
        /**
         * Advance to the pre-loaded next track. The gapless player switches audio
         * sources itself and only tells the queue where it landed — so this is a
         * track change like `play`, and it owes the same re-roll: without it the
         * shuffle target still points at the track that just STARTED, `nextindex`
         * hands out the current index, and shuffle plays the same song forever.
         */
        moveForward() {
            this.currentindex = this.nextindex
            this.rollShuffleNext()
        },
        seek(pos: number) {
            const ds = useDeviceSync()
            if (ds.joined && !ds.applying) {
                ds.intercept('seek', pos)
                return
            }

            const lyrics = useLyrics()

            try {
                audioSource.playingSource.currentTime = pos
                this.duration.current = pos
            } catch (error) {
                if (error instanceof TypeError) {
                    console.error('Seek error: no audio')
                }
            }

            if (router.currentRoute.value.name == Routes.Lyrics) {
                const line = lyrics.calculateCurrentLine()
                lyrics.setCurrentLine(line)
            }

            const player = usePlayer()
            player.clearMovingNextTimeout()
        },

        playTrackNext(track: Track) {
            const Toast = useToast()
            const { insertAt } = useTracklist()

            const nextindex = this.currentindex + 1
            // `aimNext` as in insertAfterCurrent: "next" means next under
            // shuffle too, and it has to happen inside insertAt.
            insertAt([track], nextindex, true)
            Toast.showNotification(`Added 1 track to queue`, NotifType.Success)
        },
        clearQueue() {
            // Group mode: "Clear queue" empties the SHARED queue — broadcast it
            // and let the mirror do the clearing here too, or this device would
            // sit on an empty list while the group plays on.
            const ds = useDeviceSync()
            if (ds.joined && !ds.applying) {
                ds.intercept('clearQueue')
                return
            }

            const store = useTracklist()
            store.clearList()
            this.currentindex = 0
        },
        shuffleQueue() {
            const ds = useDeviceSync()
            if (ds.joined && !ds.applying) {
                ds.intercept('shuffleQueue')
                return
            }

            const { shuffleList } = useTracklist()
            const { focusCurrentInSidebar } = useInterface()

            // Keep the track playing right now out of the front row: playback
            // restarts at index 0 below, and restarting the same song is not a
            // shuffle.
            shuffleList(this.currentindex)
            this.currentindex = 0
            this.play(this.currentindex)
            focusCurrentInSidebar()
        },
    },
    getters: {
        next(): Track {
            const { tracklist } = useTracklist()
            return tracklist[this.nextindex]
        },
        prev(): Track {
            const { tracklist } = useTracklist()
            return tracklist[this.previndex]
        },
        currenttrack(): Track {
            const { tracklist } = useTracklist()
            const current = tracklist[this.currentindex]
            if (!current) {
                return {} as Track
            }

            isFavorite(current?.trackhash || 'mehmehmeh', favType.track).then(is_fav => {
                if (!current) return

                // Never over the session's own answer. This request is fired on
                // READ and lands whenever it lands, so one that left before a
                // favourite was flipped here would write the pre-flip value back
                // — and `isFavorite` returns `false` on any error, so a single
                // failed check would undo a flip even without a race. The
                // tracklist is persisted, which is what makes that stick: the
                // wrong value would come back on the next load.
                if (useFavorites().flag(favType.track, current.trackhash) !== undefined) return

                current.is_favorite = is_fav
            })

            return current
        },
        currenttrackhash(): string {
            return this.currenttrack?.trackhash || ''
        },
        /**
         * Whether the playing track is a favourite — the reading every heart
         * that shows it takes, so the bar, the Now Playing header and the right
         * panel cannot disagree about one track.
         *
         * The session's own answer comes FIRST and the queue copy's field is
         * only the fallback, because that field is also written from the server
         * by `currenttrack` above: that refetch is fired on read and lands
         * whenever it lands, so a reply that left before a local flip would
         * otherwise undo the flip on screen a moment after the click.
         */
        currenttrackIsFav(): boolean {
            const hash = this.currenttrackhash
            if (!hash) return false

            return useFavorites().flag(favType.track, hash) ?? this.currenttrack?.is_favorite ?? false
        },
        previndex(): number {
            const { tracklist } = useTracklist()
            const { repeat, shuffle } = useSettings()

            if (repeat == 'one') {
                return this.currentindex
            }

            // While shuffling, "previous" means the track that actually played
            // before this one, not the one sitting above it in the queue. The
            // newest history entry is the current track, so step back past it.
            if (shuffle) {
                const previous = this.shuffleRecent[this.shuffleRecent.length - 2]
                if (previous !== undefined && previous < tracklist.length) return previous
            }

            return this.currentindex === 0 ? tracklist.length - 1 : this.currentindex - 1
        },
        nextindex(): number {
            const { tracklist } = useTracklist()
            const { repeat, shuffle } = useSettings()

            if (repeat == 'one') {
                return this.currentindex
            }

            // Pre-rolled in an action, never rolled here — see shuffleNextIndex.
            // A target equal to the current index would hand the playing track
            // back as "next", which is the same song on repeat. It can only be
            // stale state — something moved currentindex without a re-roll, and
            // not every such write can roll: the group-session mirror writes it
            // directly on purpose, and removeByIndex corrects it after the fact.
            // Falling back to the row below is deterministic, so the value stays
            // stable across reads for the preload and the group broadcast.
            if (
                shuffle &&
                this.shuffleNextIndex !== null &&
                this.shuffleNextIndex < tracklist.length &&
                this.shuffleNextIndex !== this.currentindex
            ) {
                return this.shuffleNextIndex
            }

            return this.currentindex === tracklist.length - 1 ? 0 : this.currentindex + 1
        },
    },
    persist: {
        afterRestore: context => {
            let store = context.store
            store.duration.current = 0
            store.playing = false
        },
    },
})
