import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

/**
 * How far the clock may run on past the last report.
 *
 * The audio element reports about four times a second (`timeupdate`), so a
 * healthy gap is ~250 ms. If reports stop while the queue still says "playing"
 * — buffering, a stalled stream — the clock must not run away from the music.
 */
export const MAX_EXTRAPOLATION_MS = 400

/**
 * Where playback is now, given the last report and how long ago it came.
 * Pure, so the clamp can be tested without a frame loop.
 */
export function extrapolate(reportedMs: number, reportedAt: number, now: number, playing: boolean): number {
    if (!playing) return reportedMs
    const ran = Math.min(Math.max(now - reportedAt, 0), MAX_EXTRAPOLATION_MS)
    return reportedMs + ran
}

/**
 * The playback position in milliseconds, smooth enough for word timing.
 *
 * The store's clock (`queue.duration.current`) moves in ~250 ms steps; a word
 * often lasts less than that, so a highlight driven by it would land a word late
 * and skip short ones. Between reports this runs a frame loop and carries the
 * clock forward with wall time, and every report puts it back on the audio's
 * own position. The loop runs only while `playing()` says so and mounted — a
 * caller with nothing to time passes false and costs no frames.
 */
export default function usePlaybackClock(seconds: () => number, playing: () => boolean) {
    const millis = ref(seconds() * 1000)

    let reportedMs = millis.value
    let reportedAt = performance.now()
    let frame: number | null = null

    const tick = () => {
        millis.value = extrapolate(reportedMs, reportedAt, performance.now(), playing())
        frame = playing() ? requestAnimationFrame(tick) : null
    }

    const start = () => {
        if (frame === null && playing() && typeof requestAnimationFrame === 'function') {
            frame = requestAnimationFrame(tick)
        }
    }

    const stop = () => {
        if (frame !== null) cancelAnimationFrame(frame)
        frame = null
    }

    watch(seconds, (value) => {
        reportedMs = value * 1000
        reportedAt = performance.now()
        millis.value = reportedMs
        start()
    })

    watch(playing, (value) => {
        // A pause freezes the clock where it had got to. Snapping back to the
        // last report would move the highlight back by up to a report interval;
        // the audio's own next report corrects any difference.
        const now = performance.now()
        reportedMs = extrapolate(reportedMs, reportedAt, now, !value)
        reportedAt = now
        millis.value = reportedMs
        if (value) start()
        else stop()
    })

    onMounted(start)
    onBeforeUnmount(stop)

    return millis
}
