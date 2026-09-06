import { router, Routes } from '@/router'
import { defineStore } from 'pinia'
import { ref } from 'vue'

import useColors from './colors'
import useDeviceSync from './devicesync'
import useLyrics from './lyrics'
import { NotifType, useToast } from './notification'
import useQueue from './queue'
import useTracklist from './queue/tracklist'
import useSettings from './settings'
import useTracker from './tracker'

import { getBaseUrl, paths } from '@/config'
import updateMediaNotif from '@/helpers/mediaNotification'
import { crossFade } from '@/utils/audio/crossFade'
import { stopsAtQueueEnd } from '@/utils/playbackAdvance'

class AudioSource {
    private sources: HTMLAudioElement[] = []
    private playingSourceIndex: number = 0
    private handlers: { [key: string]: (err: Event | string) => void } = {}
    private requiredAPBlockBypass: boolean = false
    settings: ReturnType<typeof useSettings> | null = null

    constructor() {
        this.sources = [new Audio(), new Audio()]

        this.sources.forEach((audio, index) => {
            audio.style.display = 'none'
            audio.id = `source-${index}`
            document.body.appendChild(audio)
        })

        this.requiredAPBlockBypass = true
    }

    get standbySource() {
        return this.sources[1 - this.playingSourceIndex]
    }
    get playingSource() {
        return this.sources[this.playingSourceIndex]
    }

    preloadWithUri(uri: string) {
        const audio = this.standbySource
        if (!this.settings) return audio
        audio.src = uri
        audio.muted = this.settings.mute
        audio.volume = this.settings.volume
        audio.load()
        return audio
    }

    switchSources() {
        if (!this.settings) return
        crossFade({
            audio: this.playingSource,
            duration: this.settings.crossfade_duration,
            start_volume: this.settings.volume,
            then_destroy: true,
        })

        this.playingSourceIndex = 1 - this.playingSourceIndex
    }

    assignSettings(settings: ReturnType<typeof useSettings>) {
        this.settings = settings
        this.sources.forEach(audio => {
            audio.muted = settings.mute
            audio.volume = settings.volume
        })
    }

    assignEventHandlers(onPlaybackError: (err: Event | string) => void) {
        this.handlers = {
            onPlaybackError,
        }
    }

    pausePlayingSource() {
        navigator.mediaSession.playbackState = 'paused'
        this.playingSource.pause()
    }

    async playPlayingSource(trackSilence?: { starting_file: number; ending_file: number }) {
        const trackDuration = trackSilence
            ? Math.floor(trackSilence.ending_file / 1000 - trackSilence.starting_file / 1000)
            : null

        if (this.requiredAPBlockBypass) this.applyAPBlockBypass()

        await this.playingSource.play().catch(this.handlers.onPlaybackError)
        navigator.mediaSession.playbackState = 'playing'
        navigator.mediaSession.setPositionState({
            duration: trackDuration || this.playingSource.duration,
            position: this.playingSource.currentTime,
        })
    }

    /**
     * This is a workaround for the autoplay policy on mobile devices. (mainly IOS Safari)
     *
     * for Audio elements to be able to play without being blocked, two main conditions must be met:
     * 1. The first time any Audio plays, it must be triggered by user interaction.
     * 2. The Audio must exist in the DOM.
     *
     * without this workaround, the first time `standbySource` plays, it would be blocked by the browser.
     *
     * this workaround plays the `standbySource` along with the `playingSource` to meet the first condition.
     */
    private applyAPBlockBypass() {
        this.standbySource.src = ''
        this.standbySource
            .play()
            .then(() => {
                this.standbySource.pause()
            })
            .catch(() => {})

        this.requiredAPBlockBypass = false
    }
}

export function getUrl(filepath: string, trackhash: string, use_legacy: boolean) {
    // INFO: Force using legacy streaming endpoint until
    // we change the playback engine to properly support
    // the chunked streaming endpoint.
    use_legacy = true
    const { streaming_container, streaming_quality } = useSettings()

    const url = `${paths.api.files}/${trackhash + (use_legacy ? '/legacy' : '')}?filepath=${encodeURIComponent(
        filepath
    )}&container=${streaming_container}&quality=${streaming_quality}`

    return getBaseUrl() + url
}

const audioSource = new AudioSource()
let audio = audioSource.playingSource
const buffering = ref(true)
const maxSeekPercent = ref(0)

export const usePlayer = defineStore('player', () => {
    const queue = useQueue()
    const colors = useColors()
    const lyrics = useLyrics()
    const tracker = useTracker()
    const toast = useToast()
    const settings = useSettings()
    const tracklist = useTracklist()

    audioSource.assignSettings(settings)

    let currentAudioData = {
        filepath: '',
        silence: {
            starting_file: 0,
            ending_file: 0,
        },
    }

    let nextAudioData = {
        filepath: '',
        audio: audioSource.standbySource,
        loaded: false,
        ticking: false,
        silence: {
            starting_file: 0,
            ending_file: 0,
        },
    }

    let movingNextTimer: any = null
    function clearMovingNextTimeout() {
        if (movingNextTimer) {
            clearTimeout(movingNextTimer)
            movingNextTimer = null
            nextAudioData.ticking = false
        }
    }

    function clearNextAudioData() {
        nextAudioData.filepath = ''
        nextAudioData.loaded = false
        nextAudioData.ticking = false
        nextAudioData.silence = {
            starting_file: 0,
            ending_file: 0,
        }

        clearMovingNextTimeout()
    }

    // let sourceTime = 0
    // let lastTime = 0

    function setVolume(new_value: number) {
        audio.volume = new_value
    }

    function setMute(new_value: boolean) {
        audio.muted = new_value
    }

    // --- imperative helpers for the device-sync store -----------------------
    // These operate on the ACTIVE audio element (audioSource.playingSource),
    // which may differ from the captured `audio` after a source switch.

    /** Set a pitch-preserving playbackRate on the active element (drift steering). */
    function setPlaybackRate(rate: number) {
        const el = audioSource.playingSource
        ;(el as any).preservesPitch = true
        el.playbackRate = rate
    }

    /**
     * Current playback position of the active element, in WHOLE milliseconds.
     *
     * Rounded on purpose: this value is sent to the sync API, whose position
     * fields are integers. Passing the raw fractional `currentTime * 1000` had
     * every queue-set rejected with 422 while a track was playing.
     */
    function getCurrentTimeMs(): number {
        return Math.round(audioSource.playingSource.currentTime * 1000)
    }

    /** Hard-seek the active element (and mirror queue.duration.current), like `seek`. */
    function hardSeekMs(ms: number) {
        const seconds = ms / 1000
        try {
            audioSource.playingSource.currentTime = seconds
            queue.setCurrentDuration(seconds)
        } catch (error) {
            if (error instanceof TypeError) {
                console.error('Seek error: no audio')
            }
        }
    }

    const audio_onerror = (err: Event | string) => {
        if (typeof err != 'string') {
            err.stopImmediatePropagation()
        }

        handlePlayErrors(err)

        // if (queue.currentindex !== tracklist.tracklist.length - 1) {
        //     if (!queue.playing) return

        //     let onErrorPrevTrackHash: string = queue.currenttrackhash

        //     setTimeout(() => {
        //         // if another track has been played, don't play next track
        //         if (queue.currenttrackhash !== onErrorPrevTrackHash) {
        //             return
        //         }

        //         queue.playNext()
        //     }, 3000)
        //     return
        // }

        // TODO: move this to a queue action
        // queue.setPlaying(false)
    }

    const handlePlayErrors = (e: Event | string) => {
        if (e instanceof DOMException) {
            if (e.name === 'NotAllowedError') {
                const ds = useDeviceSync()
                if (ds.joined) {
                    // Group mode: the join prompt (GestureOverlay) IS the message
                    // here — no error toast on top of it. Autoplay rejects can
                    // fire repeatedly (two audio elements, retries), which stacked
                    // duplicate red toasts over the prompt.
                    // Also: never playPause() — that would broadcast a pause to
                    // the whole group off one device's local block.
                    ds.needsGesture = true
                    return
                }
                queue.playPause()
                return toast.showNotification(
                    'Tap anywhere in the page and try again (autoplay blocked)',
                    NotifType.Error
                )
            }

            return toast.showNotification('Player Error: ' + e.message, NotifType.Error)
        }

        queue.playNext() // skip unplayable track
        toast.showNotification("Can't load: " + queue.currenttrack.title, NotifType.Error)
    }

    const runActionsOnPlay = () => {
        if (
            !queue.manual &&
            !audio.src.includes('sm.radio.jingles') &&
            audio.currentTime - currentAudioData.silence.starting_file / 1000 <= 4
        ) {
            crossFade({
                audio,
                duration: settings.crossfade_duration,
                start_volume: 0,
            })
        }

        updateMediaNotif()
        // medium (256²) thumbnail for a stable gradient-colour extraction; the
        // xsmall (64²) cover is too small for a reliable dominant-swatch pick.
        colors.setTheme1Color(paths.images.thumb.medium + queue.currenttrack.image)

        if (router.currentRoute.value.name == Routes.Lyrics) {
            return lyrics.getLyrics()
        }

        // if (!settings.use_lyrics_plugin) {
        //     lyrics.checkExists(queue.currenttrack.filepath, queue.currenttrack.trackhash)
        // }
    }

    const onAudioCanPlay = () => {
        if (!queue.playing) {
            audioSource.pausePlayingSource()
            return
        }
        queue.setDurationFromFile(queue.currenttrack.duration || 0)
        audioSource.playPlayingSource(currentAudioData.silence)
    }

    const onAudioEnded = () => {
        // Group mode: the leader plans the next track via a scheduled command;
        // NEVER run the solo advance below — not even while a mirror
        // application is in flight (`applying`), or the local moveForward
        // would silently desync this device from the group.
        const ds = useDeviceSync()
        if (ds.joined) {
            // The scrobble leader logs the finished track now (submitData is
            // leader-gated and resets after submitting), so the last track of
            // a repeat-none queue is scrobbled even though no next track ever
            // triggers the key-change submit.
            tracker.submitData()
            if (!ds.applying) ds.onTrackEnded()
            return
        }

        const { submitData } = tracker
        submitData()

        if (stopsAtQueueEnd(settings.repeat, settings.shuffle, tracklist.length)) {
            queue.playPause()
            queue.moveForward()
            return
        }

        // INFO: if next audio is not loaded, manually move forward
        if (nextAudioData.loaded === false) {
            clearNextAudioData()
            queue.playNext()
        }
    }

    const onAudioPlay = () => {
        // reset sourceTime to prevent false positives
        // const date = new Date()
        // sourceTime = date.getTime()

        runActionsOnPlay()
    }

    const updateLyricsPosition = () => {
        if (!lyrics.exists || router.currentRoute.value.name !== Routes.Lyrics) return

        const millis = Math.round(audio.currentTime * 1000)
        const diff = lyrics.nextLineTime - millis

        if (diff < 0) {
            // No `+ 1`: calculateCurrentLine returns the line being sung now,
            // not the one before it (stores/lyrics.ts). The correction here and
            // the missing one in `sync()` were two halves of the same bug.
            //
            // It gets THIS clock, not the store's: `queue.setCurrentDuration`
            // runs after this function (see onAudioTimeUpdateHandler), so the
            // store is a tick behind — and correcting to a stale clock right at
            // a boundary would put the mark back on the line just left.
            lyrics.setCurrentLine(lyrics.calculateCurrentLine(millis), false)
            return
        }

        if (diff < 1200) {
            // set timer to next line
            if (lyrics.lyrics && !(lyrics.lyrics.length <= lyrics.currentLine + 1) && !lyrics.ticking) {
                lyrics.setNextLineTimer(diff)
            }
        }
    }

    const handleNextAudioCanPlay = async () => {
        // INFO: Keep a key for this query to ignore the result if the track has changed
        const key = queue.currenttrack.trackhash + queue.next.trackhash

        if (!settings.use_silence_skip) {
            nextAudioData.silence.starting_file = 0
            currentAudioData.silence.ending_file = Math.floor(audio.duration * 1000)
            nextAudioData.loaded = true
            return
        }

        const worker = new Worker('/workers/silence.js')

        worker.postMessage({
            ending_file: queue.currenttrack.filepath,
            starting_file: queue.next.filepath,
        })

        worker.onmessage = e => {
            // INFO: if the track has changed, abort.
            if (queue.currenttrack.trackhash + queue.next.trackhash !== key) {
                return
            }

            const silence = e.data

            if (!silence.ending_file){
                return
            }

            nextAudioData.silence.starting_file = silence.starting_file
            currentAudioData.silence.ending_file = silence.ending_file
            nextAudioData.loaded = silence !== null

            // NOTE: This will lead to a merge conflict on this file: discard this and copy into master branch.
            // INFO: This fixes the next track not playing after the current track has ended issue
            // caused by silence data being late, causing the logic to break.

            // INFO: If the ending track has already entered silence, move forward immediately
            if (silence.ending_file <= audio.currentTime * 1000) {
                moveLoadedForward()
            }
        }
    }

    function loadNextTrack() {
        if (nextAudioData.filepath === queue.next.filepath) return

        const uri = getUrl(queue.next.filepath, queue.next.trackhash, settings.use_legacy_streaming_endpoint)
        nextAudioData.audio = audioSource.preloadWithUri(uri)
        nextAudioData.filepath = queue.next.filepath
        nextAudioData.audio.oncanplay = handleNextAudioCanPlay
    }

    function moveLoadedForward() {
        clearEventHandlers(audio)

        audioSource.switchSources()

        // INFO: Set stuff
        audio = audioSource.playingSource
        audio.currentTime = nextAudioData.silence.starting_file / 1000
        currentAudioData.silence = nextAudioData.silence
        currentAudioData.filepath = nextAudioData.filepath
        maxSeekPercent.value = 0
        audioSource.playPlayingSource(nextAudioData.silence)

        clearNextAudioData()
        queue.moveForward()
        assignEventHandlers(audio)
        tracker.changeKey()
    }

    const initLoadingNextTrackAudio = () => {
        // Group mode disables gapless preload + silence-skip (they would desync).
        if (useDeviceSync().joined) return

        const { currentindex } = queue
        const { length } = tracklist
        const { repeat, shuffle } = settings

        // Last track and nothing follows it: no next audio to pre-load. Under
        // shuffle the last ROW is not the last track — the next one is rolled,
        // so the preload has to run there too or playback dies at that row.
        if (currentindex === length - 1 && stopsAtQueueEnd(repeat, shuffle, length)) {
            return
        }

        const currentTime = audio.currentTime

        // if track has less than 30 seconds left, load next track
        if (Number.isNaN(audio.duration) || audio.duration - currentTime > 30) {
            return
        }

        if (!nextAudioData.loaded) {
            loadNextTrack()
        }

        if (nextAudioData.loaded && !nextAudioData.ticking && currentAudioData.silence.ending_file) {
            const { crossfade_duration, use_crossfade } = settings
            const diff = currentAudioData.silence.ending_file - Math.floor(audio.currentTime * 1000)

            const is_jingle = queue.currenttrack.filepath.includes('sm.radio.jingles')
            const newdiff = crossfade_duration > diff || is_jingle || !use_crossfade ? diff : diff - crossfade_duration

            if (diff > 0) {
                nextAudioData.ticking = true
                movingNextTimer = setTimeout(() => {
                    nextAudioData.ticking = false
                    if (!queue.playing && nextAudioData.filepath == queue.next.filepath) return
                    moveLoadedForward()
                }, newdiff)
            }
        }
    }

    const onAudioTimeUpdateHandler = () => {
        updateLyricsPosition()
        initLoadingNextTrackAudio()
        queue.setCurrentDuration(audio.currentTime)
    }

    const handleBufferingStatus = () => {
        try {
            const latestBufferedTime = audio.buffered.end(audio.buffered.length - 1)
            const buffer = latestBufferedTime - audio.currentTime
            buffering.value = buffer < 1
            maxSeekPercent.value = Math.max(maxSeekPercent.value, (latestBufferedTime / audio.duration) * 100)
        } catch (error) {
            buffering.value = true
        }
    }

    const updateBufferWatcherTime = () => {
        if (!queue.playing) return
        handleBufferingStatus()
    }

    // Loader will misbehave on HMR because of multiple setInterval calls
    setInterval(() => {
        if (!queue.playing) {
            buffering.value = false
            return
        }

        updateBufferWatcherTime()
    }, 1000)

    function playCurrentTrack() {
        tracker.changeKey()
        clearEventHandlers(audio)
        maxSeekPercent.value = 0

        // Group mode always hard-loads the current source (no crossfade switch).
        if (
            !queue.manual &&
            queue.playing &&
            audio.src !== '' &&
            !audio.src.includes('sm.radio.jingles') &&
            !useDeviceSync().joined
        ) {
            audioSource.switchSources()
            audio = audioSource.playingSource
        }

        const { currenttrack: track } = queue
        // const uri = `${paths.api.files}/${track.trackhash}?filepath=${encodeURIComponent(track.filepath as string)}`
        const uri = getUrl(track.filepath, track.trackhash, settings.use_legacy_streaming_endpoint)

        audio.src = uri
        audio.load() // on safari, audio won't play without load()

        clearNextAudioData()
        assignEventHandlers(audio)
    }

    const assignEventHandlers = (audioElem: HTMLAudioElement) => {
        audioElem.onerror = audio_onerror
        audioElem.oncanplay = onAudioCanPlay
        audioElem.onended = onAudioEnded
        audioElem.onplay = onAudioPlay
        audioElem.ontimeupdate = onAudioTimeUpdateHandler
        tracker.reassignEventListener()
    }

    const clearEventHandlers = (audioElem: HTMLAudioElement) => {
        audioElem.onerror = null
        audioElem.oncanplay = null
        audioElem.onended = null
        audioElem.onplay = null
        audioElem.ontimeupdate = null

        // removes listener added in stores/tracker.ts
        audioElem.removeEventListener('timeupdate', () => {})
    }

    assignEventHandlers(audio)
    audioSource.assignEventHandlers(handlePlayErrors)

    return {
        audio,
        setMute,
        setVolume,
        playCurrent: playCurrentTrack,
        clearNextAudio: clearNextAudioData,
        clearMovingNextTimeout,
        setPlaybackRate,
        getCurrentTimeMs,
        hardSeekMs,
    }
})

export { audioSource, buffering, maxSeekPercent }
