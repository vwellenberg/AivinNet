import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The listening side, with everything around it stubbed: the group store (who
// is in the group, what it sends), the microphone, and the measurement itself
// — utils/deviceSync/__tests__/calibration.test.ts covers that on synthetic
// recordings. Here: the sequence, and what reaches which device.
const { ds, mic, micModule, measure, reports } = vi.hoisted(() => {
    const reports: { handler: ((report: any) => void) | null } = { handler: null }
    const mic = {
        sampleRate: 48000,
        startLocalMs: vi.fn(() => 0 as number | null),
        samples: vi.fn(() => new Float32Array(10)),
        level: vi.fn(() => 0.1),
        stop: vi.fn(),
    }
    return {
        reports,
        mic,
        micModule: {
            micAvailable: vi.fn(() => true),
            startMicCapture: vi.fn(() => Promise.resolve(mic)),
        },
        measure: vi.fn(),
        ds: {
            deviceId: 'phone',
            joined: true,
            playing: true,
            audioOffsetMs: 0,
            devices: [] as any[],
            now: 100_000,
            serverNow: vi.fn(),
            sendCmd: vi.fn(() => Promise.resolve()),
            measureClicks: vi.fn(),
            startTicks: vi.fn(() => Promise.resolve()),
            stopTicks: vi.fn(),
            stopCalibrationAudio: vi.fn(),
            setAudioOffset: vi.fn(),
        },
    }
})

vi.mock('@/stores/devicesync', () => ({
    default: () => ds,
    onCalibrationReport: (handler: any) => (reports.handler = handler),
}))
vi.mock('@/utils/deviceSync/micCapture', () => micModule)
vi.mock('@/utils/deviceSync/calibration', async () => ({
    ...(await vi.importActual<any>('@/utils/deviceSync/calibration')),
    measureClicks: measure,
}))

import { PREP_MS, planClicks, planEndMs } from '@/utils/deviceSync/calibration'
import useSyncCalibration, {
    __resetSyncCalibrationTestState,
    TICK_COUNT,
    TICK_PERIOD_MS,
} from '@/stores/syncCalibration'

const member = (id: string, over: Partial<any> = {}) => ({
    device_id: id,
    name: id === 'pc' ? 'Chrome on Windows' : `Device ${id}`,
    type: 'desktop',
    online: true,
    joined: true,
    volume: 1,
    mute: false,
    is_leader: false,
    trim_ms: 0,
    ...over,
})

/** The command sent to `target` of `type`, or undefined. */
const sent = (type: string, target?: string) =>
    (ds.sendCmd.mock.calls as any[]).find(([t, , to]) => t === type && to === target)

describe('sync calibration — with the microphone', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        __resetSyncCalibrationTestState()
        vi.clearAllMocks()
        setActivePinia(createPinia())
        reports.handler = null
        ds.playing = true
        ds.audioOffsetMs = 0
        ds.now = 100_000
        ds.serverNow.mockImplementation(() => ds.now)
        ds.devices = [
            member('pc', { trim_ms: 0 }),
            member('phone'),
            member('old-tablet', { online: false }),
            member('kitchen', { joined: false }),
        ]
        micModule.micAvailable.mockReturnValue(true)
        micModule.startMicCapture.mockImplementation(() => Promise.resolve(mic))
        mic.startLocalMs.mockReturnValue(Date.now() - 1000)
        // The listener's own clicks sound on plan.
        ds.measureClicks.mockImplementation((clicks: number[]) => Promise.resolve({ sounded_ms: clicks }))
        // Per click: phone 47 ms (12 hidden + 35 shared), the PC on Bluetooth
        // 202 ms. The phone clicks first, at the plan's start.
        const planStart = ds.now + PREP_MS
        measure.mockImplementation((_recording: any, sounded: number[]) =>
            sounded.map(() => (sounded[0] === planStart ? 47 : 202))
        )
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    async function listening() {
        const cal = useSyncCalibration()
        await cal.start()
        const plan = planClicks(['phone', 'pc'], ds.now + PREP_MS)
        return { cal, plan, run: (sent('sync_click', 'pc') as any)[1].run as string }
    }

    function afterThePlan(plan: Record<string, number[]>, extraMs = 900) {
        ds.now = planEndMs(plan) + extraMs
        vi.advanceTimersByTime(100)
    }

    it('pauses the music, asks every member in the group to click, and clicks here too', async () => {
        const { cal, plan } = await listening()

        expect(cal.phase).toBe('listening')
        expect(ds.sendCmd).toHaveBeenNthCalledWith(1, 'pause', {})
        // This device first, then the others — offline or outside members are left alone.
        expect(cal.rows.map(r => r.id)).toEqual(['phone', 'pc'])
        expect(sent('sync_click', 'pc')).toEqual([
            'sync_click',
            { run: expect.any(String), listener: 'phone', clicks_ms: plan.pc },
            'pc',
        ])
        expect(ds.measureClicks).toHaveBeenCalledWith(plan.phone)
        expect(sent('sync_click', 'old-tablet')).toBeUndefined()
        expect(sent('sync_click', 'kitchen')).toBeUndefined()
    })

    it('turns the reports into trims: the late speaker starts earlier, the music comes back', async () => {
        const { cal, plan, run } = await listening()
        reports.handler?.({ run, device: 'pc', sounded_ms: plan.pc })
        await flushPromises()
        afterThePlan(plan)

        expect(cal.phase).toBe('result')
        expect(mic.stop).toHaveBeenCalled()
        expect(ds.sendCmd).toHaveBeenLastCalledWith('play', {})
        const [phone, pc] = cal.rows
        expect(phone).toMatchObject({ status: 'heard', reference: true, suggestedTrim: 0 })
        expect(pc).toMatchObject({ status: 'heard', reference: false, suggestedTrim: 155, currentTrim: 0 })

        cal.apply()
        expect(ds.sendCmd).toHaveBeenLastCalledWith('set_audio_offset', { offset_ms: 155 }, 'pc')
        // Already where it should be: this device is left alone.
        expect(ds.setAudioOffset).not.toHaveBeenCalled()
        expect(cal.phase).toBe('applied')
    })

    it('counts a trim it just applied as the device’s own until the device reports it', async () => {
        const { cal, plan, run } = await listening()
        reports.handler?.({ run, device: 'pc', sounded_ms: plan.pc })
        await flushPromises()
        afterThePlan(plan)
        cal.apply() // the PC gets 155 — the device list still says 0 until its next report

        // Straight on to "by ear": the PC's slider starts where it really is. From
        // 0, the first touch would have thrown it back by 155 ms.
        await cal.startEar()
        expect(cal.earTrims.pc).toBe(155)
        cal.stopEar()

        // A device that never confirms: after a while its own report counts again.
        vi.advanceTimersByTime(11_000)
        await cal.startEar()
        expect(cal.earTrims.pc).toBe(0)
    })

    it('waits a while for a slow report, then calls the device silent', async () => {
        const { cal, plan } = await listening()
        await flushPromises()

        afterThePlan(plan)
        expect(cal.phase).toBe('listening') // the PC may still answer

        afterThePlan(plan, 4100)
        expect(cal.phase).toBe('result')
        expect(cal.rows[1]).toMatchObject({ status: 'no-answer', suggestedTrim: null })
        expect(cal.changes).toEqual([])
    })

    it("names a member's reason instead of measuring nothing, and ignores other runs", async () => {
        const { cal, plan, run } = await listening()
        reports.handler?.({ run: 'someone-else', device: 'pc', sounded_ms: plan.pc })
        reports.handler?.({ run, device: 'pc', error: 'muted' })
        await flushPromises()
        afterThePlan(plan)

        expect(cal.rows[1].status).toBe('muted')
        expect(measure).toHaveBeenCalledTimes(1) // only this device's own clicks
    })

    it('leaves the music alone if it was not playing', async () => {
        ds.playing = false
        const { plan, run } = await listening()
        reports.handler?.({ run, device: 'pc', sounded_ms: plan.pc })
        await flushPromises()
        afterThePlan(plan)

        expect(sent('pause')).toBeUndefined()
        expect(sent('play')).toBeUndefined()
    })

    it('on an http page, explains instead of asking for the microphone', async () => {
        micModule.micAvailable.mockReturnValue(false)
        const cal = useSyncCalibration()
        cal.prepare()
        expect(cal.phase).toBe('insecure')

        await cal.start()
        expect(cal.phase).toBe('insecure')
        expect(micModule.startMicCapture).not.toHaveBeenCalled()
        expect(ds.sendCmd).not.toHaveBeenCalled()
    })

    it('says so when the microphone is refused — and never paused the music', async () => {
        micModule.startMicCapture.mockRejectedValue(Object.assign(new Error('no'), { name: 'NotAllowedError' }))
        const cal = useSyncCalibration()
        await cal.start()

        expect(cal.phase).toBe('error')
        expect(cal.error).toMatch(/not allowed/)
        expect(ds.sendCmd).not.toHaveBeenCalled()
    })

    it('cancelling stops the microphone and its own clicks, and brings the music back', async () => {
        const { cal } = await listening()
        cal.cancel()

        expect(mic.stop).toHaveBeenCalled()
        expect(ds.stopCalibrationAudio).toHaveBeenCalled()
        expect(ds.sendCmd).toHaveBeenLastCalledWith('play', {})
        expect(cal.phase).toBe('idle')
    })

    it('closing the panel during the microphone prompt ends it all — no recording, no clicks', async () => {
        let grant: (capture: any) => void = () => {}
        micModule.startMicCapture.mockImplementation((() => new Promise(resolve => (grant = resolve))) as any)
        const cal = useSyncCalibration()
        const starting = cal.start()
        cal.cancel() // the panel closes while the browser still asks
        grant(mic)
        await starting

        expect(mic.stop).toHaveBeenCalled()
        expect(ds.sendCmd).not.toHaveBeenCalled()
        expect(cal.phase).toBe('idle')
    })

    it('needs a second device in the group', async () => {
        ds.devices = [member('phone'), member('pc', { online: false })]
        const cal = useSyncCalibration()
        await cal.start()

        expect(cal.phase).toBe('error')
        expect(micModule.startMicCapture).not.toHaveBeenCalled()
    })
})

describe('sync calibration — by ear', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        __resetSyncCalibrationTestState()
        vi.clearAllMocks()
        setActivePinia(createPinia())
        ds.playing = true
        ds.audioOffsetMs = 10
        ds.now = 100_000
        ds.serverNow.mockImplementation(() => ds.now)
        ds.devices = [member('pc', { trim_ms: 150 }), member('phone')]
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('ticks every device from the same start, each with the trim it has', async () => {
        const cal = useSyncCalibration()
        await cal.startEar()

        const start = ds.now + 2500
        expect(cal.phase).toBe('ear')
        expect(cal.earTrims).toEqual({ phone: 10, pc: 150 })
        expect(ds.sendCmd).toHaveBeenNthCalledWith(1, 'pause', {})
        expect(ds.startTicks).toHaveBeenCalledWith(
            expect.objectContaining({ startServerMs: start, periodMs: TICK_PERIOD_MS, count: TICK_COUNT })
        )
        expect(sent('sync_ticks', 'pc')).toEqual([
            'sync_ticks',
            { run: expect.any(String), start_ms: start, period_ms: TICK_PERIOD_MS, count: TICK_COUNT },
            'pc',
        ])
    })

    it('sends a dragged trim once the drag rests, and this device’s at once', async () => {
        const cal = useSyncCalibration()
        await cal.startEar()
        ds.sendCmd.mockClear()

        cal.setEarTrim('pc', 152)
        cal.setEarTrim('pc', 157)
        expect(ds.sendCmd).not.toHaveBeenCalled()
        vi.advanceTimersByTime(200)
        expect(ds.sendCmd).toHaveBeenCalledTimes(1)
        expect(ds.sendCmd).toHaveBeenCalledWith('set_audio_offset', { offset_ms: 157 }, 'pc')

        cal.setEarTrim('phone', 20)
        expect(ds.setAudioOffset).toHaveBeenCalledWith(20)
    })

    it('Done sends what is still held back, stops every tick and resumes the music', async () => {
        const cal = useSyncCalibration()
        await cal.startEar()
        const run = (sent('sync_ticks', 'pc') as any)[1].run
        cal.setEarTrim('pc', 160)
        cal.stopEar()

        expect(sent('set_audio_offset', 'pc')).toEqual(['set_audio_offset', { offset_ms: 160 }, 'pc'])
        expect(ds.sendCmd).toHaveBeenCalledWith('sync_ticks', { run, stop: true }, 'pc')
        expect(ds.stopTicks).toHaveBeenCalledWith(run)
        expect(ds.sendCmd).toHaveBeenLastCalledWith('play', {})
        expect(cal.phase).toBe('idle')

        // Nothing left over to fire later.
        ds.sendCmd.mockClear()
        vi.advanceTimersByTime(10 * 60 * 1000)
        expect(ds.sendCmd).not.toHaveBeenCalled()
    })

    it('Done while the pause is still on its way leaves nobody ticking', async () => {
        let release: () => void = () => {}
        ds.sendCmd.mockImplementationOnce(() => new Promise<void>(resolve => (release = resolve)))
        const cal = useSyncCalibration()
        const starting = cal.startEar()
        cal.stopEar()
        release()
        await starting

        expect(ds.startTicks).not.toHaveBeenCalled()
        const started = (ds.sendCmd.mock.calls as any[]).some(([type, p]) => type === 'sync_ticks' && !p.stop)
        expect(started).toBe(false)
        vi.advanceTimersByTime(10 * 60 * 1000)
        expect(cal.phase).toBe('idle')
    })

    it('stops on its own after the last tick', async () => {
        const cal = useSyncCalibration()
        await cal.startEar()
        vi.advanceTimersByTime(2500 + TICK_COUNT * TICK_PERIOD_MS + 1000)
        expect(cal.phase).toBe('idle')
        expect(ds.stopTicks).toHaveBeenCalled()
    })
})
