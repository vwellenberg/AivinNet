// The listening side of a sync calibration.
//
// One device — usually the phone in your hand — records while every group
// member clicks in turn through its own speaker. Each member reports when its
// clicks sounded by its own media clock; the recording says when they really
// arrived. What differs between members is exactly what the browsers cannot
// see (Windows hides Bluetooth latency: 155 ms measured), and it becomes each
// member's trim. The arithmetic is in utils/deviceSync/calibration.ts, the
// member side in stores/devicesync.ts (`sync_click`, `sync_ticks`).
//
// "Align by ear" is the same idea without a microphone: every member ticks in
// step with the group, trim included, and the user moves the trims until the
// ticks fall on top of each other. It needs no secure page.
//
// The music pauses while either runs: it would drown the clicks, and nobody
// wants a second song under the ticks. It resumes afterwards if it played.

import { defineStore } from 'pinia'

import { clampOffset } from '@/utils/deviceSync/audioOffset'
import {
    measureClicks,
    planClicks,
    planEndMs,
    PREP_MS,
    relativeLatencies,
    suggestTrims,
    type Recording,
} from '@/utils/deviceSync/calibration'
import { micAvailable, startMicCapture, type MicCapture } from '@/utils/deviceSync/micCapture'
import type { DeviceSummary } from '@/utils/deviceSync/types'
import useDeviceSync, { onCalibrationReport, type CalibrationReport } from './devicesync'

export type CalibrationPhase = 'idle' | 'insecure' | 'starting' | 'listening' | 'result' | 'applied' | 'error' | 'ear'

export type RowStatus =
    | 'waiting'
    | 'clicking'
    | 'heard'
    | 'unclear'
    | 'no-answer'
    | 'muted'
    | 'late'
    | 'blocked'
    | 'failed'

export interface CalibrationRow {
    id: string
    name: string
    self: boolean
    status: RowStatus
    /** How much later than the reference device this one sounds (ms); null when not measured. */
    latencyMs: number | null
    /**
     * Per click: arrival behind the reported sound time (ms), plus a constant
     * shared by every row; null where nothing clear was heard. How well a
     * device's clicks agree, for diagnostics.
     */
    offsetsMs: (number | null)[]
    /** The trim the device has now (ms). */
    currentTrim: number
    /** The trim the measurement suggests (ms); null when the device was not measured. */
    suggestedTrim: number | null
    /** The device heard earliest: the others are lined up with it. */
    reference: boolean
}

/** By ear: a tick a second, for two minutes at most. */
export const TICK_PERIOD_MS = 1000
export const TICK_COUNT = 120
/** Ticks start this far ahead (ms): the pause lands and the plan reaches every device. */
const TICK_PREP_MS = 2500
/** Keep recording this long past the last window (ms) — a device that started late clicks late. */
const RECORD_TAIL_MS = 800
/** Reports are awaited this long past the plan (ms); a device silent until then gave no answer. */
const REPORT_WAIT_MS = 4000
/** A trim dragged by ear is sent after this pause (ms), not on every step. */
const EAR_SEND_MS = 150
/**
 * A suggestion this close to the current trim changes nothing (ms). The
 * browsers' media clocks themselves sit up to ~8 ms off what sounds (measured,
 * see utils/deviceSync/calibration.ts), and so many ms between two speakers
 * are not heard — below it, a second measurement would only chase noise.
 */
export const NO_CHANGE_MS = 8
/** Level-meter bars kept. */
const LEVEL_BARS = 12

// --- non-reactive run state ---------------------------------------------------

let mic: MicCapture | null = null
let run = ''
let plan: Record<string, number[]> = {}
let planEnd = 0
let reports: Record<string, CalibrationReport> = {}
let ticker: any = null
let pausedByUs = false
let earRun = ''
let earMembers: string[] = []
const earSends = new Map<string, any>()
let earEnd: any = null

function newRunId(): string {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

/** Joined and online, this device first. */
function groupMembers(): DeviceSummary[] {
    const ds = useDeviceSync()
    const members = ds.devices.filter(d => d.joined && d.online)
    return [...members.filter(d => d.device_id === ds.deviceId), ...members.filter(d => d.device_id !== ds.deviceId)]
}

function rowFor(device: DeviceSummary): CalibrationRow {
    const ds = useDeviceSync()
    const self = device.device_id === ds.deviceId
    return {
        id: device.device_id,
        name: self ? 'This device' : device.name,
        self,
        status: 'waiting',
        latencyMs: null,
        offsetsMs: [],
        currentTrim: self ? ds.audioOffsetMs : Math.round(device.trim_ms ?? 0),
        suggestedTrim: null,
        reference: false,
    }
}

const REPORT_ERRORS: Record<string, RowStatus> = {
    muted: 'muted',
    late: 'late',
    blocked: 'blocked',
    failed: 'failed',
    aborted: 'failed',
}

function micError(error: unknown): string {
    const name = (error as { name?: string } | null)?.name
    if (name === 'NotAllowedError' || name === 'SecurityError')
        return 'The microphone was not allowed. Allow it for this site in the browser settings, then try again.'
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'This device has no microphone.'
    return 'The microphone could not be opened.'
}

export default defineStore('syncCalibration', {
    state: () => ({
        phase: 'idle' as CalibrationPhase,
        rows: [] as CalibrationRow[],
        /** Recent microphone levels, 0..1, newest last. */
        levels: [] as number[],
        error: '',
        /** By ear: the trim each device is set to right now (ms). */
        earTrims: {} as Record<string, number>,
    }),

    getters: {
        busy: state => state.phase === 'starting' || state.phase === 'listening',
        /** Rows whose trim Apply would change. */
        changes: state =>
            state.rows.filter(
                r => r.suggestedTrim !== null && Math.abs(r.suggestedTrim - r.currentTrim) >= NO_CHANGE_MS
            ),
        heardCount: state => state.rows.filter(r => r.status === 'heard').length,
    },

    actions: {
        /** Open the microphone flow: straight to the steps, or to why this page cannot record. */
        prepare() {
            this.error = ''
            this.phase = micAvailable() ? 'idle' : 'insecure'
        },

        async start() {
            if (this.busy) return
            if (!micAvailable()) {
                this.phase = 'insecure'
                return
            }
            const members = groupMembers()
            if (members.length < 2) {
                this.fail('Calibration needs this device and at least one more playing in the group.')
                return
            }

            this.phase = 'starting'
            this.error = ''
            try {
                mic = await startMicCapture()
            } catch (error) {
                this.fail(micError(error))
                return
            }

            const ds = useDeviceSync()
            run = newRunId()
            reports = {}
            this.rows = members.map(rowFor)
            this.levels = []

            await this.pauseGroup()
            plan = planClicks(
                members.map(d => d.device_id),
                ds.serverNow() + PREP_MS
            )
            planEnd = planEndMs(plan)
            onCalibrationReport(report => this.receive(report))

            const thisRun = run
            for (const device of members) {
                const clicks = plan[device.device_id]
                if (device.device_id === ds.deviceId) {
                    void ds
                        .measureClicks(clicks)
                        .then(result => this.receive({ run: thisRun, device: ds.deviceId, ...result }))
                } else {
                    void ds.sendCmd('sync_click', { run, listener: ds.deviceId, clicks_ms: clicks }, device.device_id)
                }
            }
            this.phase = 'listening'
            ticker = setInterval(() => this.tick(), 100)
        },

        /** A member's report — kept until the recording is complete. */
        receive(report: CalibrationReport) {
            if (!run || report.run !== run || !this.rows.some(r => r.id === report.device)) return
            reports[report.device] = report
        },

        tick() {
            if (this.phase !== 'listening' || !mic) return
            const ds = useDeviceSync()
            const now = ds.serverNow()

            this.levels = [...this.levels, Math.min(1, mic.level() * 5)].slice(-LEVEL_BARS)
            for (const row of this.rows) {
                const clicks = plan[row.id]
                if (row.status === 'waiting' && clicks && now >= clicks[0] - 200) row.status = 'clicking'
            }

            const complete = this.rows.every(r => reports[r.id])
            if (now < planEnd + RECORD_TAIL_MS) return
            if (!complete && now < planEnd + REPORT_WAIT_MS) return
            this.finish()
        },

        /** Stop recording, measure every reported device, and suggest trims. */
        finish() {
            const ds = useDeviceSync()
            const startLocal = mic?.startLocalMs() ?? null
            const recording: Recording | null =
                mic && startLocal !== null
                    ? {
                          samples: mic.samples(),
                          sampleRate: mic.sampleRate,
                          startServerMs: startLocal + (ds.serverNow() - Date.now()),
                      }
                    : null
            this.stopRun()
            void this.resumeGroup()
            if (!recording) {
                this.fail('The microphone delivered no sound.')
                return
            }

            const offsets: Record<string, (number | null)[]> = {}
            for (const row of this.rows) {
                const report = reports[row.id]
                if (!report) {
                    row.status = 'no-answer'
                } else if (report.error) {
                    row.status = REPORT_ERRORS[report.error] ?? 'failed'
                } else {
                    row.offsetsMs = measureClicks(recording, report.sounded_ms ?? [])
                    offsets[row.id] = row.offsetsMs
                }
            }
            const latencies = relativeLatencies(offsets)
            for (const row of this.rows) {
                if (!(row.id in offsets)) continue
                row.latencyMs = latencies[row.id] ?? null
                row.status = row.latencyMs === null ? 'unclear' : 'heard'
            }

            const heard = this.rows.filter(r => r.latencyMs !== null)
            const trims = suggestTrims(latencies)
            const earliest = heard.reduce<CalibrationRow | null>(
                (best, r) => (best === null || (r.latencyMs as number) < (best.latencyMs as number) ? r : best),
                null
            )
            for (const row of this.rows) {
                row.suggestedTrim = trims[row.id] ?? null
                row.reference = heard.length > 1 && row === earliest
            }
            reports = {}
            this.phase = 'result'
        },

        /** Give the measured devices their suggested trims. */
        apply() {
            const ds = useDeviceSync()
            for (const row of this.changes) {
                const trim = row.suggestedTrim as number
                if (row.self) ds.setAudioOffset(trim)
                else void ds.sendCmd('set_audio_offset', { offset_ms: trim }, row.id)
                row.currentTrim = trim
            }
            this.phase = 'applied'
        },

        /** Abort whatever runs (the flow is closed or left). */
        cancel() {
            if (this.phase === 'ear') {
                this.stopEar()
                return
            }
            if (this.busy) {
                this.stopRun()
                useDeviceSync().stopCalibrationAudio()
                void this.resumeGroup()
            }
            this.phase = 'idle'
        },

        stopRun() {
            if (ticker) clearInterval(ticker)
            ticker = null
            onCalibrationReport(null)
            mic?.stop()
            mic = null
            run = ''
        },

        fail(message: string) {
            this.stopRun()
            void this.resumeGroup()
            this.error = message
            this.phase = 'error'
        },

        // --- by ear ----------------------------------------------------------

        async startEar() {
            const members = groupMembers()
            if (members.length < 2) {
                this.fail('Aligning needs this device and at least one more playing in the group.')
                return
            }
            const ds = useDeviceSync()
            earRun = newRunId()
            earMembers = members.map(d => d.device_id)
            this.rows = members.map(rowFor)
            this.earTrims = Object.fromEntries(this.rows.map(r => [r.id, r.currentTrim]))
            this.error = ''
            this.phase = 'ear'

            await this.pauseGroup()
            const startMs = ds.serverNow() + TICK_PREP_MS
            for (const id of earMembers) {
                if (id === ds.deviceId) {
                    void ds.startTicks({ run: earRun, startServerMs: startMs, periodMs: TICK_PERIOD_MS, count: TICK_COUNT })
                } else {
                    void ds.sendCmd(
                        'sync_ticks',
                        { run: earRun, start_ms: startMs, period_ms: TICK_PERIOD_MS, count: TICK_COUNT },
                        id
                    )
                }
            }
            earEnd = setTimeout(() => this.stopEar(), TICK_PREP_MS + TICK_COUNT * TICK_PERIOD_MS + 1000)
        },

        /** Move one device's trim while it ticks. */
        setEarTrim(id: string, ms: number) {
            const trim = clampOffset(ms)
            this.earTrims = { ...this.earTrims, [id]: trim }
            const ds = useDeviceSync()
            if (id === ds.deviceId) {
                ds.setAudioOffset(trim)
                return
            }
            clearTimeout(earSends.get(id))
            earSends.set(
                id,
                setTimeout(() => {
                    earSends.delete(id)
                    void ds.sendCmd('set_audio_offset', { offset_ms: trim }, id)
                }, EAR_SEND_MS)
            )
        },

        stopEar() {
            if (this.phase !== 'ear') return
            const ds = useDeviceSync()
            // A trim still held back is sent now, not dropped.
            for (const [id, handle] of earSends) {
                clearTimeout(handle)
                void ds.sendCmd('set_audio_offset', { offset_ms: this.earTrims[id] }, id)
            }
            earSends.clear()
            clearTimeout(earEnd)
            earEnd = null
            for (const id of earMembers) {
                if (id === ds.deviceId) ds.stopTicks(earRun)
                else void ds.sendCmd('sync_ticks', { run: earRun, stop: true }, id)
            }
            earRun = ''
            earMembers = []
            void this.resumeGroup()
            this.phase = 'idle'
        },

        // --- the music around it ---------------------------------------------

        async pauseGroup() {
            const ds = useDeviceSync()
            if (!ds.playing) return
            pausedByUs = true
            await ds.sendCmd('pause', {})
        },

        /**
         * Resume what we paused. Not gated on `playing`: the pause takes effect
         * LEAD_MS after it is sent, so a run cancelled right away would still
         * see the group playing — and leave it paused a moment later. A play
         * for a group that is already playing moves nothing.
         */
        async resumeGroup() {
            if (!pausedByUs) return
            pausedByUs = false
            const ds = useDeviceSync()
            if (ds.joined) await ds.sendCmd('play', {})
        },
    },
})

/** TEST-ONLY: forget any run in flight. */
export function __resetSyncCalibrationTestState() {
    if (ticker) clearInterval(ticker)
    ticker = null
    mic = null
    run = ''
    plan = {}
    planEnd = 0
    reports = {}
    pausedByUs = false
    earRun = ''
    earMembers = []
    earSends.forEach(handle => clearTimeout(handle))
    earSends.clear()
    clearTimeout(earEnd)
    earEnd = null
}
