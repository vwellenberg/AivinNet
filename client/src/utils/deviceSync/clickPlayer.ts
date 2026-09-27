// Device side of a sync calibration: clicks and ticks through an <audio> element.
//
// An <audio> element, not Web Audio: the music plays through media elements,
// and a click has to take exactly that path, or the measurement would miss
// what the music suffers. A fresh element per run — the two music elements
// stay untouched.
//
// - `playMeasurement` plays a plan of clicks and reports when each one sounded
//   by this device's media clock — `currentTime`, which already includes the
//   output latency the OS reports. It does not have to click exactly on time:
//   the report says where each click really was, and the listener looks there.
// - `TickPlayer` ticks once per period in step with the group, trim included,
//   so the user can line the devices up by ear. That one does have to be on
//   time, so it steers its element the way the music is steered — faster,
//   since the ticks are 20 ms in a second of silence: resampling by a few
//   percent is inaudible there, and a seek between two ticks costs nothing.
//
// Both start playing the moment they are asked, with silence up to the first
// click: a device with its tab in the background gets its timers throttled to
// once a second, but a playing element keeps its own clock regardless.

import { CHIRP_MS, clickStartMs, clickWav } from './clickSignal'

/** Sample rate of a measurement file (most outputs run at 48 kHz: nothing to resample). */
export const MEASURE_SAMPLE_RATE = 48000
/** Sample rate of the tick file — minutes long, and the chirp tops out at 6 kHz. */
export const TICK_SAMPLE_RATE = 16000
/** Peak amplitude of a click before the device volume (-6 dBFS). */
export const CLICK_AMPLITUDE = 0.5

/** Less silence than this (ms) before the first click is too late to start cleanly. */
const MIN_LEAD_IN_MS = 400
const TAIL_MS = 400
/** Readings of the media clock: how often (ms), and how long after the start they are trusted. */
const READ_EVERY_MS = 25
const START_STALL_MS = 200
/** Readings within this media span (ms) of a click describe its clock. */
const CLOCK_SPAN_MS = 1500
/** A click with fewer readings around it is not reported. */
const MIN_READINGS = 5
/** A late start (ms) is caught up by skipping some of the silence. */
const CATCH_UP_ABOVE_MS = 30

export interface CalibrationClock {
    /** Server time now (ms). */
    serverNow(): number
    /** Server minus local clock (ms): server = Date.now() + offset. */
    offset(): number
}

export type MeasureError = 'muted' | 'late' | 'blocked' | 'failed' | 'aborted'
/** Notes on how the clicks were played, for the calibration log (numbers and short strings). */
export type ClickDetails = Record<string, number | string | boolean | null>
export type MeasureResult =
    | { sounded_ms: (number | null)[]; details?: ClickDetails }
    | { error: MeasureError; details?: ClickDetails }

export interface Reading {
    /** Local wall clock (Date.now()). */
    at: number
    /** Media position (ms). */
    media: number
}

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b)
    const mid = sorted.length >> 1
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * When media position `positionMs` sounded on the local wall clock, from the
 * readings around it — the median, because Firefox's `currentTime` jitters by
 * ±40 ms. Null with too few readings.
 */
export function soundedAt(readings: Reading[], positionMs: number): number | null {
    const near = readings.filter(r => Math.abs(r.media - positionMs) <= CLOCK_SPAN_MS)
    if (near.length < MIN_READINGS) return null
    return median(near.map(r => r.at - r.media)) + positionMs
}

const round1 = (ms: number) => Math.round(ms * 10) / 10

/**
 * How steady the media clock ran against the wall clock: the spread of
 * (wall − media) over all readings, and how far it moved between the first
 * and the last second. A fresh element whose reported latency is still
 * settling shows up as drift — a click would then sound at another delay than
 * the long-running music it is meant to stand for.
 */
export function clockStats(readings: Reading[]): { spreadMs: number | null; driftMs: number | null } {
    if (readings.length < MIN_READINGS) return { spreadMs: null, driftMs: null }
    const origins = readings.map(r => r.at - r.media)
    const middle = median(origins)
    const spreadMs = round1(median(origins.map(o => Math.abs(o - middle))))
    const first = readings[0].at
    const last = readings[readings.length - 1].at
    const early = readings.filter(r => r.at - first <= 1000).map(r => r.at - r.media)
    const late = readings.filter(r => last - r.at <= 1000).map(r => r.at - r.media)
    const driftMs =
        early.length >= MIN_READINGS && late.length >= MIN_READINGS && last - first > 2000
            ? round1(median(late) - median(early))
            : null
    return { spreadMs, driftMs }
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)))
}

function whenPlayable(el: HTMLAudioElement, timeoutMs: number): Promise<boolean> {
    if (el.readyState >= 3) return Promise.resolve(true)
    return new Promise(resolve => {
        const done = (ok: boolean) => {
            clearTimeout(handle)
            el.removeEventListener('canplay', onReady)
            el.removeEventListener('error', onError)
            resolve(ok)
        }
        const onReady = () => done(true)
        const onError = () => done(false)
        const handle = setTimeout(() => done(false), timeoutMs)
        el.addEventListener('canplay', onReady)
        el.addEventListener('error', onError)
    })
}

function newElement(wav: ArrayBuffer, volume: number): { el: HTMLAudioElement; release: () => void } {
    const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }))
    const el = new Audio()
    el.preload = 'auto'
    el.volume = volume
    // Rate changes resample instead of time-stretching (see player.ts `setFineSteering`).
    const media = el as any
    media.preservesPitch = false
    media.webkitPreservesPitch = false
    media.mozPreservesPitch = false
    el.src = url
    const release = () => {
        el.pause()
        el.removeAttribute('src')
        el.load()
        URL.revokeObjectURL(url)
    }
    return { el, release }
}

/**
 * Play clicks at `clicksServerMs` and say when each one sounded (server ms,
 * by this device's media clock). `startLatencyMs` is how long this device
 * takes to start sound — the group steering learns it.
 */
export async function playMeasurement(opts: {
    clicksServerMs: number[]
    clock: CalibrationClock
    volume: number
    startLatencyMs: number
    signal: AbortSignal
}): Promise<MeasureResult> {
    const clicks = opts.clicksServerMs
    if (opts.volume <= 0) return { error: 'muted' }

    const first = clicks[0]
    const leadIn = first - opts.clock.serverNow() - opts.startLatencyMs
    if (leadIn < MIN_LEAD_IN_MS) return { error: 'late' }
    /** Server time at which media position 0 is due to sound. */
    const zeroAt = first - leadIn

    const positions = clicks.map(ms => clickStartMs(leadIn + (ms - first), MEASURE_SAMPLE_RATE))
    const last = positions[positions.length - 1]
    const wav = clickWav({
        sampleRate: MEASURE_SAMPLE_RATE,
        durationMs: last + CHIRP_MS + TAIL_MS,
        clicksMs: positions,
        amplitude: CLICK_AMPLITUDE,
    })
    const { el, release } = newElement(wav, opts.volume)

    const readings: Reading[] = []
    let started = Infinity
    let lastMedia = -1
    const read = () => {
        const media = el.currentTime * 1000
        const at = Date.now()
        if (media !== lastMedia && at - started >= START_STALL_MS) readings.push({ at, media })
        lastMedia = media
        return media
    }
    // Media events keep coming in a background tab, where timers slow to 1/s.
    el.addEventListener('timeupdate', read)

    try {
        if (!(await whenPlayable(el, 3000))) return { error: 'failed' }
        if (opts.signal.aborted) return { error: 'aborted' }

        const late = opts.clock.serverNow() + opts.startLatencyMs - zeroAt
        if (late > leadIn - MIN_LEAD_IN_MS / 2) return { error: 'late' }
        const caughtUp = late > CATCH_UP_ABOVE_MS ? late : 0
        if (caughtUp) el.currentTime = caughtUp / 1000

        try {
            await el.play()
        } catch {
            return { error: 'blocked' }
        }

        started = Date.now()
        const deadline = started + (last - el.currentTime * 1000) + 3000
        while (!opts.signal.aborted && !el.ended && Date.now() < deadline) {
            await sleep(READ_EVERY_MS)
            if (read() > last + CHIRP_MS + 150) break
        }
        if (opts.signal.aborted) return { error: 'aborted' }

        const offset = opts.clock.offset()
        const sounded = positions.map(position => {
            const local = soundedAt(readings, position)
            return local === null ? null : local + offset
        })
        const clock = clockStats(readings)
        const details: ClickDetails = {
            lead_in_ms: Math.round(leadIn),
            caught_up_ms: Math.round(caughtUp),
            readings: readings.length,
            clock_spread_ms: clock.spreadMs,
            clock_drift_ms: clock.driftMs,
        }
        return sounded.some(s => s !== null) ? { sounded_ms: sounded, details } : { error: 'failed', details }
    } finally {
        el.removeEventListener('timeupdate', read)
        release()
    }
}

// --- by ear ------------------------------------------------------------------

/** Steering: how often (ms), the readings it takes the median of, and how fast an error is worked off (ms). */
const TICK_STEER_MS = 50
const TICK_READINGS = 7
const TICK_CORRECT_OVER_MS = 800
/** At most this far from 1.0 — a tick resampled by 5 % is still the same tick. */
const TICK_MAX_RATE_DELTA = 0.05
/** Off by more than this (ms), seek instead — between two ticks, where it is silent. */
const TICK_SEEK_ABOVE_MS = 40
/** A seek needs this much silence ahead (ms) before the next tick. */
const TICK_SEEK_ROOM_MS = 300
/** After a start or seek, readings are its stall (ms). */
const TICK_SETTLE_MS = 300

/** The playback rate that works `errorMs` off over the next stretch, within the tick limits. */
export function tickRate(errorMs: number): number {
    if (Math.abs(errorMs) < 1) return 1
    const delta = Math.max(-TICK_MAX_RATE_DELTA, Math.min(TICK_MAX_RATE_DELTA, errorMs / TICK_CORRECT_OVER_MS))
    return 1 - delta
}

export interface TickPlan {
    run: string
    /** Server time of the first tick (before trims). */
    startServerMs: number
    periodMs: number
    count: number
}

export class TickPlayer {
    private el: HTMLAudioElement | null = null
    private release: (() => void) | null = null
    private timer: any = null
    private plan: TickPlan | null = null

    /** The run ticking now, or ''. */
    get run(): string {
        return this.plan?.run ?? ''
    }

    /**
     * Tick along `plan`, `trimMs()` ms ahead like the music. The trim is read
     * live, so changing it while ticking moves the ticks with it.
     */
    async start(
        plan: TickPlan,
        opts: {
            clock: CalibrationClock
            trimMs: () => number
            volume: number
            startLatencyMs: number
            seekLatencyMs: number
        }
    ): Promise<boolean> {
        this.stop()
        if (opts.volume <= 0 || plan.count < 1) return false

        // Silence up to the first tick, so the element plays from now on.
        const leadIn = Math.max(MIN_LEAD_IN_MS, plan.startServerMs - opts.clock.serverNow())
        const ticks = Array.from({ length: plan.count }, (_, k) =>
            clickStartMs(leadIn + k * plan.periodMs, TICK_SAMPLE_RATE)
        )
        const lastTick = ticks[ticks.length - 1]
        const wav = clickWav({
            sampleRate: TICK_SAMPLE_RATE,
            durationMs: lastTick + CHIRP_MS + TAIL_MS,
            clicksMs: ticks,
            amplitude: CLICK_AMPLITUDE,
        })
        const { el, release } = newElement(wav, opts.volume)
        this.el = el
        this.release = release
        this.plan = plan

        const expected = (serverMs: number) => leadIn + (serverMs - plan.startServerMs) + opts.trimMs()
        const owns = () => this.el === el

        if (!(await whenPlayable(el, 3000))) {
            if (owns()) this.stop()
            return false
        }
        if (!owns()) return false
        el.currentTime = Math.max(0, expected(opts.clock.serverNow() + opts.startLatencyMs)) / 1000
        try {
            await el.play()
        } catch {
            if (owns()) this.stop()
            return false
        }
        if (!owns()) return false

        let readings: number[] = []
        let lastMedia = -1
        let settleUntil = Date.now() + TICK_SETTLE_MS
        this.timer = setInterval(() => {
            if (!owns()) return
            const media = el.currentTime * 1000
            if (el.ended || media > lastTick + CHIRP_MS + 100) {
                this.stop()
                return
            }
            // Not advancing (stalled, or paused by the system): nothing to read.
            if (media === lastMedia) return
            lastMedia = media
            if (Date.now() < settleUntil) return

            readings.push(media - expected(opts.clock.serverNow()))
            if (readings.length > TICK_READINGS) readings.shift()
            if (readings.length < 3) return
            const error = median(readings)

            const nextTick = ticks.find(t => t > media) ?? Infinity
            if (Math.abs(error) > TICK_SEEK_ABOVE_MS && nextTick - media > TICK_SEEK_ROOM_MS) {
                el.playbackRate = 1
                el.currentTime = Math.max(0, expected(opts.clock.serverNow() + opts.seekLatencyMs)) / 1000
                settleUntil = Date.now() + TICK_SETTLE_MS
                readings = []
                return
            }
            const rate = tickRate(error)
            if (Math.abs(rate - el.playbackRate) > 0.0005) el.playbackRate = rate
        }, TICK_STEER_MS)
        return true
    }

    /** Stop ticking — only `run`, when given. */
    stop(run?: string) {
        if (run !== undefined && run !== this.run) return
        if (this.timer) clearInterval(this.timer)
        this.timer = null
        this.release?.()
        this.release = null
        this.el = null
        this.plan = null
    }
}
