import { defineStore } from 'pinia'
import { computed, ref, watch, type WatchStopHandle } from 'vue'

import type { Track } from '@/interfaces'
import { FADE_MS, fadeGain, formatRemaining, stopsBeforeTrack, type SleepChoice } from '@/utils/sleepTimer'
import { usePlayer } from './player'
import useQueue from './queue'

/** How often the indicator's remaining time is refreshed. */
const CLOCK_MS = 1000
/** How often the fade lowers the volume. */
const FADE_STEP_MS = 100
/**
 * Group mode only: the pause is a command that lands about LEAD_MS later, and
 * until then this device keeps sounding. If its `playing` flag never flips
 * (a lost command), the music comes back to full level anyway after this.
 */
const RESTORE_FALLBACK_MS = 5000

/**
 * The sleep timer. Purely local: it lives on the device that set it.
 *
 * - Minute choices: when the time runs out the music fades out over FADE_MS
 *   (through `setDuck`, the player's own volume path), then playback is paused
 *   through `queue.playPause()` — the pause button's action, so in a group the
 *   whole group pauses — and the volume goes back to full.
 * - End of song / end of album: `takeStopAt` is called by the player (and the
 *   group leader) right before the next track starts. It answers yes once, and
 *   the caller then starts nothing and pauses.
 *
 * The timers stay inside the store closure, so each Pinia instance (and each
 * test) owns its own.
 */
export default defineStore('sleep-timer', () => {
    const choice = ref<SleepChoice | null>(null)
    const endsAt = ref(0)
    const now = ref(0)
    const fadeStartedAt = ref<number | null>(null)

    let endTimer: ReturnType<typeof setTimeout> | null = null
    let fadeTimer: ReturnType<typeof setInterval> | null = null
    let clockTimer: ReturnType<typeof setInterval> | null = null
    let restoreWatch: WatchStopHandle | null = null
    let restoreFallback: ReturnType<typeof setTimeout> | null = null

    const active = computed(() => choice.value !== null)
    const fading = computed(() => fadeStartedAt.value !== null)

    /** What the indicator shows next to the moon. */
    const label = computed(() => {
        const c = choice.value
        if (!c) return ''
        if (c.kind === 'song') return 'Song'
        if (c.kind === 'album') return 'Album'
        if (fading.value) return 'Fade'
        return formatRemaining(Math.max(0, endsAt.value - now.value))
    })

    function clearTimers() {
        if (endTimer !== null) clearTimeout(endTimer)
        if (fadeTimer !== null) clearInterval(fadeTimer)
        if (clockTimer !== null) clearInterval(clockTimer)
        endTimer = null
        fadeTimer = null
        clockTimer = null
    }

    function stopRestoreWait() {
        restoreWatch?.()
        restoreWatch = null
        if (restoreFallback !== null) clearTimeout(restoreFallback)
        restoreFallback = null
    }

    /** Drop the timer. If the music is mid-fade, it comes back to full level. */
    function drop() {
        clearTimers()
        stopRestoreWait()
        if (fadeStartedAt.value !== null) usePlayer().setDuck(1)
        fadeStartedAt.value = null
        choice.value = null
        endsAt.value = 0
    }

    /** Start a timer, replacing any running one. */
    function arm(next: SleepChoice) {
        drop()
        choice.value = next
        if (next.kind !== 'minutes') return

        const ms = next.minutes * 60_000
        now.value = Date.now()
        endsAt.value = now.value + ms
        endTimer = setTimeout(startFade, ms)
        clockTimer = setInterval(() => {
            now.value = Date.now()
        }, CLOCK_MS)
    }

    /** The "Off" choice, and a tap on the indicator. Nothing is paused. */
    function cancel() {
        drop()
    }

    function startFade() {
        endTimer = null
        if (clockTimer !== null) clearInterval(clockTimer)
        clockTimer = null
        fadeStartedAt.value = Date.now()
        fadeTimer = setInterval(fadeStep, FADE_STEP_MS)
        fadeStep()
    }

    function fadeStep() {
        const elapsed = Date.now() - (fadeStartedAt.value ?? Date.now())
        usePlayer().setDuck(fadeGain(elapsed))
        if (elapsed >= FADE_MS) finish()
    }

    function finish() {
        if (fadeTimer !== null) clearInterval(fadeTimer)
        fadeTimer = null

        const queue = useQueue()
        // The pause button's own action. Only while playing: `playPause()`
        // resumes a paused queue, and a timer must never start the music.
        if (queue.playing) queue.playPause()

        fadeStartedAt.value = null
        choice.value = null
        endsAt.value = 0

        if (!queue.playing) {
            usePlayer().setDuck(1)
            return
        }

        // Group mode: `playPause()` only sends the pause, and this element keeps
        // sounding until it lands. Bring the level back once it has.
        restoreWatch = watch(
            () => queue.playing,
            playing => {
                if (!playing) {
                    stopRestoreWait()
                    usePlayer().setDuck(1)
                }
            }
        )
        restoreFallback = setTimeout(() => {
            stopRestoreWait()
            usePlayer().setDuck(1)
        }, RESTORE_FALLBACK_MS)
    }

    /**
     * Asked by the player right before it moves on to `next` (`current` is the
     * track that just finished). True means: playback ends here. The timer is
     * spent, and the caller must start nothing and pause.
     */
    function takeStopAt(current: Track | undefined, next: Track | undefined): boolean {
        if (!stopsBeforeTrack(choice.value, current, next)) return false
        drop()
        return true
    }

    return { choice, active, fading, label, arm, cancel, takeStopAt }
})
