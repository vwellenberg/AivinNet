import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The device-sync store keeps its clock estimator, dedupe set and timers as
// module-level singletons. Tests reset the module registry per case so those
// start fresh; the mocks below are captured once (hoisted) and survive resets.
const { playerMock, audioSourceMock, requestsMock } = vi.hoisted(() => ({
    playerMock: {
        setPlaybackRate: vi.fn(),
        getCurrentTimeMs: vi.fn(() => 0),
        hardSeekMs: vi.fn(),
        playCurrent: vi.fn(),
        setMute: vi.fn(),
        setVolume: vi.fn(),
        clearNextAudio: vi.fn(),
        clearMovingNextTimeout: vi.fn(),
        isPaused: vi.fn(() => true),
        loadedTrackhash: vi.fn(() => ''),
        isAdvancing: vi.fn(() => false),
        durationMs: vi.fn((): number | null => null),
        prepareGroupStandby: vi.fn(),
        groupStandbyReady: vi.fn(() => false),
        groupStandbyTimeMs: vi.fn(() => 0),
        seekGroupStandbyMs: vi.fn(),
        switchToGroupStandby: vi.fn(),
    },
    audioSourceMock: {
        playPlayingSource: vi.fn(() => Promise.resolve()),
        pausePlayingSource: vi.fn(),
    },
    requestsMock: {
        registerDevice: vi.fn(() => Promise.resolve({ status: 200, data: {} })),
        pollSession: vi.fn(),
        joinGroup: vi.fn(() => Promise.resolve({ status: 200, data: {} })),
        leaveGroup: vi.fn(() => Promise.resolve({ status: 200, data: {} })),
        setQueue: vi.fn(() => Promise.resolve({ status: 200, data: {} })),
        sendCommand: vi.fn(() => Promise.resolve({ status: 200, data: {} })),
        resolveTracks: vi.fn(() => Promise.resolve([] as any[])),
    },
}))

// player.ts builds real <audio> elements at import — stub it to the imperatives
// the store actually drives.
vi.mock('@/stores/player', () => ({
    usePlayer: () => playerMock,
    audioSource: audioSourceMock,
    getUrl: () => '',
}))
vi.mock('@/requests/devicesync', () => requestsMock)
// setNewList / setFromPlaylist touch these — keep them light in jsdom.
vi.mock('@/stores/interface', () => ({ default: () => ({ focusCurrentInSidebar() {} }) }))
vi.mock('@/stores/pages/playlists', () => ({ default: () => ({ movePlayedToTop: vi.fn() }) }))

// Realistic backend shape: image strings carry a `?pathhash=` suffix (repo
// fixture rule — a sanitized `hash.webp` has hidden real bugs before).
const mkTrack = (hash: string): any => ({
    trackhash: hash,
    filepath: `/music/${hash}.mp3`,
    title: hash,
    duration: 100,
    image: `${hash}.webp?pathhash=${hash}ph`,
})

const mkState = (over: Partial<any> = {}): any => ({
    queue_id: 'q1',
    trackhashes: ['h1', 'h2'],
    from: {},
    currentindex: 0,
    repeat: 'all',
    playing: false,
    anchor: { position_ms: 0, at_server_ms: 1000 },
    ...over,
})

const mkPoll = (over: Partial<any> = {}): any => ({
    server_now_ms: 1000,
    version: 1,
    joined: false,
    scrobble_leader: null,
    commands: [],
    devices: [],
    ...over,
})

// Top-level imports, NOT dynamic imports inside setup()/beforeEach (#329):
// without vi.resetModules() both resolve to the same module instance, but the
// dynamic form paid the FIRST transform+evaluation of the store's whole module
// graph inside the first beforeEach — the heaviest import in the suite, billed
// against the 10s hook budget. Under a starved CI worker that intermittently
// blew up as "Hook timed out in 10000ms". Static imports move that cost to
// collection, which has no timeout.
import useDeviceSyncStore, { __latencyForTest, __resetDeviceSyncTestState } from '@/stores/devicesync'
import useQueueStore from '@/stores/queue'
import useTracklistStore from '@/stores/queue/tracklist'
import useSettingsStore from '@/stores/settings'

// Still awaited at the call sites — awaiting a plain object is a no-op, and
// keeping the shape avoids touching all 41 tests.
function setup() {
    return {
        useDeviceSync: useDeviceSyncStore,
        useTracklist: useTracklistStore,
        useQueue: useQueueStore,
        useSettings: useSettingsStore,
    }
}

describe('devicesync store', () => {
    beforeEach(() => {
        // NO vi.resetModules(): in vitest 0.34 it can hand the re-imported
        // store a different pinia module copy that still resolves to the
        // PREVIOUS test's store state, and module instances end up shared
        // between tests anyway. Instead the store exposes an explicit
        // test-state reset for its module singletons (timers, estimator,
        // command dedupe, leave-suppress window).
        vi.clearAllMocks()
        requestsMock.pollSession.mockReset()
        requestsMock.resolveTracks.mockReset()
        requestsMock.resolveTracks.mockResolvedValue([])
        playerMock.getCurrentTimeMs.mockReset()
        playerMock.getCurrentTimeMs.mockReturnValue(0)
        playerMock.isPaused.mockReturnValue(true)
        playerMock.loadedTrackhash.mockReturnValue('')
        playerMock.isAdvancing.mockReturnValue(false)
        playerMock.durationMs.mockReturnValue(null)
        playerMock.groupStandbyReady.mockReturnValue(false)
        playerMock.groupStandbyTimeMs.mockReturnValue(0)
        requestsMock.sendCommand.mockResolvedValue({ status: 200, data: {} })
        // Cleared BEFORE the reset: it re-reads this device's persisted
        // latency estimates, and one test's learning must not leak into the next.
        localStorage.clear()
        __resetDeviceSyncTestState()
        setActivePinia(createPinia())
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('register captures a stable identity and marks registered', async () => {
        const { useDeviceSync } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')

        const ds = useDeviceSync()
        await ds.register()

        expect(ds.deviceId).toBe('devA')
        expect(ds.registered).toBe(true)
        expect(requestsMock.registerDevice).toHaveBeenCalledWith('devA', expect.any(String), expect.any(String))
    })

    it('poll applies state and resolves tracks only when the queue identity changes', async () => {
        const { useDeviceSync, useTracklist, useQueue } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()

        requestsMock.resolveTracks.mockResolvedValue([mkTrack('h1'), mkTrack('h2')])
        requestsMock.pollSession.mockResolvedValueOnce(
            mkPoll({ version: 1, joined: true, state: mkState({ currentindex: 0 }) })
        )
        await ds.poll()

        expect(requestsMock.resolveTracks).toHaveBeenCalledTimes(1)
        expect(useTracklist().tracklist.map((t: any) => t.trackhash)).toEqual(['h1', 'h2'])
        expect(useQueue().currentindex).toBe(0)

        // Same queue_id + hashes, new index → mirror the index, no re-resolve.
        requestsMock.pollSession.mockResolvedValueOnce(
            mkPoll({ version: 2, joined: true, state: mkState({ currentindex: 1 }) })
        )
        await ds.poll()

        expect(requestsMock.resolveTracks).toHaveBeenCalledTimes(1)
        expect(useQueue().currentindex).toBe(1)
    })

    it('mirrors repeat from state without re-broadcasting it', async () => {
        const { useDeviceSync, useSettings } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()

        requestsMock.resolveTracks.mockResolvedValue([mkTrack('h1'), mkTrack('h2')])
        requestsMock.pollSession.mockResolvedValueOnce(mkPoll({ joined: true, state: mkState({ repeat: 'one' }) }))
        await ds.poll()

        expect(useSettings().repeat).toBe('one')
        expect(requestsMock.sendCommand).not.toHaveBeenCalled()
    })

    it('executes a re-delivered targeted command only once (dedupe by id)', async () => {
        const { useDeviceSync, useSettings } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()
        const settings = useSettings()

        const cmd = { id: 'v1', type: 'set_volume', payload: { volume: 0.3 }, execute_at_ms: 0, target_device: 'devA' }
        requestsMock.pollSession.mockResolvedValueOnce(mkPoll({ version: 1, joined: true, commands: [cmd] }))
        await ds.poll()
        expect(settings.volume).toBe(0.3)

        // The server re-delivers it during its grace window, after the user
        // turned the volume up here — the stale command must not win again.
        settings.setVolume(0.8)
        requestsMock.pollSession.mockResolvedValueOnce(mkPoll({ version: 1, joined: true, commands: [cmd] }))
        await ds.poll()
        expect(settings.volume).toBe(0.8)
    })

    it('commits a future state at the offset-adjusted local time, early by the start latency', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(100000)
        const { useDeviceSync, useQueue } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        // This device takes 50 ms to start sounding.
        localStorage.setItem('aivinnet.sync_latency', JSON.stringify({ start: 50, seek: 90 }))
        __resetDeviceSyncTestState()
        const ds = useDeviceSync()
        await ds.register()

        // server ahead by 1000 ms (server_now 101000 at local 100000); the
        // group starts h2 at server 102500 → local 101500, minus 50 ms.
        requestsMock.resolveTracks.mockResolvedValue([mkTrack('h1'), mkTrack('h2')])
        requestsMock.pollSession.mockResolvedValueOnce(
            mkPoll({
                server_now_ms: 101000,
                joined: true,
                state: mkState({ currentindex: 1, playing: true, anchor: { position_ms: 0, at_server_ms: 102500 } }),
            })
        )
        await ds.poll()

        expect(playerMock.playCurrent).not.toHaveBeenCalled()
        expect(useQueue().currentindex).toBe(0) // not yet: still the state in effect
        vi.advanceTimersByTime(1449)
        expect(playerMock.playCurrent).not.toHaveBeenCalled()
        vi.advanceTimersByTime(1)
        expect(playerMock.playCurrent).toHaveBeenCalledTimes(1)
        expect(useQueue().currentindex).toBe(1)
    })

    it('catches up with a state whose time has already passed', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(100000)
        const { useDeviceSync } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()

        // offset 0 (server_now == local). The group started playing at 5 s
        // one second ago: this device joins in at 6 s, not at 5 s.
        requestsMock.resolveTracks.mockResolvedValue([mkTrack('h1'), mkTrack('h2')])
        requestsMock.pollSession.mockResolvedValueOnce(
            mkPoll({
                server_now_ms: 100000,
                joined: true,
                state: mkState({ playing: true, anchor: { position_ms: 5000, at_server_ms: 99000 } }),
            })
        )
        await ds.poll()

        expect(playerMock.playCurrent).toHaveBeenCalledTimes(1)
        expect(playerMock.hardSeekMs).toHaveBeenCalledWith(6000)
    })

    it('applies a targeted set_volume only when addressed to this device', async () => {
        const { useDeviceSync, useSettings } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()
        const settings = useSettings()

        requestsMock.pollSession.mockResolvedValueOnce(
            mkPoll({
                joined: true,
                commands: [
                    { id: 'v1', type: 'set_volume', payload: { volume: 0.3 }, execute_at_ms: 0, target_device: 'devA' },
                ],
            })
        )
        await ds.poll()
        expect(settings.volume).toBe(0.3)

        requestsMock.pollSession.mockResolvedValueOnce(
            mkPoll({
                version: 2,
                joined: true,
                commands: [
                    { id: 'v2', type: 'set_volume', payload: { volume: 0.9 }, execute_at_ms: 0, target_device: 'devB' },
                ],
            })
        )
        await ds.poll()
        expect(settings.volume).toBe(0.3)
    })

    it('leaves the group and stops audio on a play_here targeted at this device', async () => {
        const { useDeviceSync } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()
        ds.joined = true
        ds.status = 'joined'

        requestsMock.pollSession.mockResolvedValueOnce(
            mkPoll({
                joined: true,
                commands: [{ id: 'ph', type: 'play_here', payload: {}, execute_at_ms: 0, target_device: 'devA' }],
            })
        )
        await ds.poll()

        expect(requestsMock.leaveGroup).toHaveBeenCalledWith('devA')
        expect(audioSourceMock.pausePlayingSource).toHaveBeenCalled()
        expect(ds.joined).toBe(false)
    })

    it('intercept(play) sends track_change when the queue matches the mirror, queue-set when it differs', async () => {
        const { useDeviceSync, useTracklist } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()
        ds.joined = true

        const tl = useTracklist()
        tl.tracklist = [mkTrack('h1'), mkTrack('h2')]
        ds.lastMirroredHashKey = 'h1\nh2'

        ds.intercept('play', 1)
        expect(requestsMock.sendCommand).toHaveBeenCalledWith(
            expect.objectContaining({
                device_id: 'devA',
                type: 'track_change',
                payload: { index: 1, position_ms: 0, playing: true },
            })
        )
        expect(requestsMock.setQueue).not.toHaveBeenCalled()

        // Navigate locally to a new context → the hash key diverges from the mirror.
        tl.tracklist = [mkTrack('h3')]
        ds.intercept('play', 0)
        expect(requestsMock.setQueue).toHaveBeenCalledWith(
            expect.objectContaining({ device_id: 'devA', trackhashes: ['h3'], currentindex: 0 })
        )
    })

    it('onTrackEnded: leader advances (all wraps / none pauses at last), non-leader is silent', async () => {
        const { useDeviceSync, useTracklist, useQueue, useSettings } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()
        ds.joined = true
        ds.scrobbleLeader = 'devA'

        useTracklist().tracklist = [mkTrack('h1'), mkTrack('h2')]
        useQueue().currentindex = 1
        const settings = useSettings()

        settings.repeat = 'all'
        ds.onTrackEnded()
        expect(requestsMock.sendCommand).toHaveBeenLastCalledWith(
            expect.objectContaining({ type: 'track_change', payload: { index: 0, position_ms: 0, playing: true } })
        )

        settings.repeat = 'none'
        ds.onTrackEnded()
        expect(requestsMock.sendCommand).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'pause' }))

        requestsMock.sendCommand.mockClear()
        ds.scrobbleLeader = 'devB'
        ds.onTrackEnded()
        expect(requestsMock.sendCommand).not.toHaveBeenCalled()
    })

    it('onTrackEnded: with shuffle on the leader sends the rolled target, not the next row (#324)', async () => {
        const { useDeviceSync, useTracklist, useQueue, useSettings } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()
        ds.joined = true
        ds.scrobbleLeader = 'devA'

        useTracklist().tracklist = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map(mkTrack)
        const queue = useQueue()
        // The LAST row with repeat 'none': sequential order would pause the group
        // here, which is exactly how the ignored toggle showed up.
        queue.currentindex = 5
        useSettings().repeat = 'none'
        queue.toggleShuffle()

        ds.onTrackEnded()

        const target = queue.nextindex
        expect(target).not.toBe(5)
        expect(requestsMock.sendCommand).toHaveBeenLastCalledWith(
            expect.objectContaining({
                type: 'track_change',
                payload: { index: target, position_ms: 0, playing: true },
            })
        )
    })

    it('a mirrored index move re-rolls the shuffle target (#324)', async () => {
        const { useDeviceSync, useQueue } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()

        requestsMock.resolveTracks.mockResolvedValue([mkTrack('h1'), mkTrack('h2')])
        requestsMock.pollSession.mockResolvedValueOnce(
            mkPoll({ version: 1, joined: true, state: mkState({ currentindex: 0 }) })
        )
        await ds.poll()

        const queue = useQueue()
        queue.toggleShuffle()
        expect(queue.shuffleNextIndex).toBe(1)

        // The group moved on: the mirror writes currentindex directly, so nothing
        // re-rolls unless applyState does it — and a target equal to the current
        // index means the leader would broadcast the track that is already playing.
        requestsMock.pollSession.mockResolvedValueOnce(
            mkPoll({ version: 2, joined: true, state: mkState({ currentindex: 1 }) })
        )
        await ds.poll()

        expect(queue.currentindex).toBe(1)
        expect(queue.shuffleNextIndex).not.toBe(1)
        expect(queue.nextindex).not.toBe(1)
    })

    it('poll failures escalate to reconnecting then dissolve to solo (joined=false)', async () => {
        const { useDeviceSync } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()
        ds.joined = true
        ds.status = 'joined'

        requestsMock.pollSession.mockResolvedValue(null)

        for (let i = 0; i < 3; i++) await ds.poll()
        expect(ds.status).toBe('reconnecting')
        expect(ds.joined).toBe(true)

        for (let i = 0; i < 12; i++) await ds.poll()
        expect(ds.joined).toBe(false)
    })

    // --- auto-rejoin ---------------------------------------------------------
    // A device that dropped out involuntarily (reaped, network gap, server
    // restart) walks back into a STILL-RUNNING group by itself.

    const peer = (over: Partial<any> = {}): any => ({
        device_id: 'devB',
        name: 'Chrome on Android',
        type: 'mobile',
        online: true,
        joined: true,
        volume: 1,
        mute: false,
        is_leader: true,
        ...over,
    })

    it('remembers membership across reloads and forgets it on a deliberate leave', async () => {
        const { useDeviceSync } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()

        await ds.join()
        expect(localStorage.getItem('aivinnet.group_member')).toBe('1')

        await ds.leave()
        expect(localStorage.getItem('aivinnet.group_member')).toBeNull()
    })

    it('rejoins a still-running group after an involuntary drop-out', async () => {
        const { useDeviceSync } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        localStorage.setItem('aivinnet.group_member', '1')
        const ds = useDeviceSync()
        await ds.register()

        // Server says: you are not a member, but devB is → group is alive.
        requestsMock.pollSession.mockResolvedValueOnce(mkPoll({ joined: false, devices: [peer()] }))
        await ds.poll()
        await Promise.resolve()

        expect(requestsMock.joinGroup).toHaveBeenCalledWith('devA')
    })

    it('never CREATES a group on its own (no running group → no rejoin)', async () => {
        const { useDeviceSync } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        localStorage.setItem('aivinnet.group_member', '1')
        const ds = useDeviceSync()
        await ds.register()

        // Marker set, but nobody is in a group — opening the app must not
        // start group playback nobody asked for.
        requestsMock.pollSession.mockResolvedValueOnce(
            mkPoll({ joined: false, devices: [peer({ joined: false })] })
        )
        await ds.poll()
        await Promise.resolve()

        expect(requestsMock.joinGroup).not.toHaveBeenCalled()
    })

    it('does not rejoin without the membership marker', async () => {
        const { useDeviceSync } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()

        requestsMock.pollSession.mockResolvedValueOnce(mkPoll({ joined: false, devices: [peer()] }))
        await ds.poll()
        await Promise.resolve()

        expect(requestsMock.joinGroup).not.toHaveBeenCalled()
    })

    it('does not rejoin right after the user left (marker cleared + suppress window)', async () => {
        const { useDeviceSync } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()
        await ds.join()
        await ds.leave()
        requestsMock.joinGroup.mockClear()

        requestsMock.pollSession.mockResolvedValueOnce(mkPoll({ joined: false, devices: [peer()] }))
        await ds.poll()
        await Promise.resolve()

        expect(requestsMock.joinGroup).not.toHaveBeenCalled()
    })

    it('backs off between rejoin attempts so a failing one cannot loop', async () => {
        const { useDeviceSync } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        localStorage.setItem('aivinnet.group_member', '1')
        const ds = useDeviceSync()
        await ds.register()

        requestsMock.pollSession.mockResolvedValue(mkPoll({ joined: false, devices: [peer()] }))
        await ds.poll()
        await Promise.resolve()
        expect(requestsMock.joinGroup).toHaveBeenCalledTimes(1)

        // The rejoin did not stick (server still reports us outside) — the next
        // polls must not hammer /join.
        ds.joined = false
        await ds.poll()
        await ds.poll()
        await Promise.resolve()
        expect(requestsMock.joinGroup).toHaveBeenCalledTimes(1)
    })

    it('a solo (non-joined) device never mirrors group state onto its local queue', async () => {
        const { useDeviceSync, useTracklist, useQueue } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()

        // Server sends `state` to every device of the user — joined:false here.
        requestsMock.pollSession.mockResolvedValueOnce(mkPoll({ version: 3, joined: false, state: mkState() }))
        await ds.poll()

        expect(requestsMock.resolveTracks).not.toHaveBeenCalled()
        expect(useTracklist().tracklist).toEqual([])
        expect(useQueue().currentindex).toBe(0)
        expect(ds.joined).toBe(false)
    })

    it('drops a held group state on leave — no hijack of solo playback', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(100000)
        const { useDeviceSync } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()

        requestsMock.resolveTracks.mockResolvedValue([mkTrack('h1'), mkTrack('h2')])
        requestsMock.pollSession.mockResolvedValueOnce(
            mkPoll({
                server_now_ms: 100000,
                joined: true,
                state: mkState({ playing: true, anchor: { position_ms: 3000, at_server_ms: 102000 } }),
            })
        )
        await ds.poll()
        expect(ds.joined).toBe(true)

        await ds.leave()
        vi.advanceTimersByTime(5000)

        expect(playerMock.playCurrent).not.toHaveBeenCalled()
        expect(playerMock.switchToGroupStandby).not.toHaveBeenCalled()
        expect(playerMock.hardSeekMs).not.toHaveBeenCalled()
    })

    it('never executes a transport command on its own — the state carries it', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(100000)
        const { useDeviceSync, useQueue } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()

        // The command and the state describing it arrive in the same poll.
        // Executing both is how every seek ran twice; only the state counts.
        requestsMock.resolveTracks.mockResolvedValue([mkTrack('h1'), mkTrack('h2')])
        requestsMock.pollSession.mockResolvedValueOnce(
            mkPoll({
                server_now_ms: 100000,
                joined: true,
                state: mkState({ anchor: { position_ms: 0, at_server_ms: 99000 } }),
                commands: [
                    { id: 'tc', type: 'track_change', payload: { index: 1 }, execute_at_ms: 99500, target_device: null },
                    { id: 'sk', type: 'seek', payload: { position_ms: 9000 }, execute_at_ms: 101500, target_device: null },
                ],
            })
        )
        await ds.poll()
        vi.advanceTimersByTime(5000)

        expect(useQueue().currentindex).toBe(0)
        expect(playerMock.hardSeekMs).not.toHaveBeenCalledWith(9000)
    })

    it('the applying guard never spans the resolve await — user actions still intercept', async () => {
        const { useDeviceSync } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()
        ds.joined = true

        let release: (tracks: any[]) => void = () => {}
        requestsMock.resolveTracks.mockReturnValueOnce(new Promise(resolve => (release = resolve)))

        const pending = ds.applyState(mkState())
        // Let applyState reach (and suspend at) the resolve await.
        await Promise.resolve()
        expect(ds.applying).toBe(false)

        release([mkTrack('h1'), mkTrack('h2')])
        await pending
        expect(ds.applying).toBe(false)
        expect(ds.queueId).toBe('q1')
    })

    it('keeps known_version stale when the track resolve fails, so the server re-sends state', async () => {
        const { useDeviceSync } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()

        requestsMock.resolveTracks.mockResolvedValueOnce([])
        requestsMock.pollSession.mockResolvedValueOnce(mkPoll({ version: 5, joined: true, state: mkState() }))
        await ds.poll()
        expect(ds.sessionVersion).toBe(0)

        requestsMock.resolveTracks.mockResolvedValueOnce([mkTrack('h1'), mkTrack('h2')])
        requestsMock.pollSession.mockResolvedValueOnce(mkPoll({ version: 5, joined: true, state: mkState() }))
        await ds.poll()
        expect(ds.sessionVersion).toBe(5)
    })

    it('intercept(playPrev) restarts the current track past 3 s, jumps back before it', async () => {
        const { useDeviceSync, useTracklist, useQueue } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()
        ds.joined = true

        useTracklist().tracklist = [mkTrack('h1'), mkTrack('h2')]
        useQueue().currentindex = 1

        playerMock.getCurrentTimeMs.mockReturnValue(10000)
        ds.intercept('playPrev')
        expect(requestsMock.sendCommand).toHaveBeenLastCalledWith(
            expect.objectContaining({ type: 'seek', payload: { position_ms: 0 } })
        )
        expect(useQueue().duration.current).toBe(0)

        playerMock.getCurrentTimeMs.mockReturnValue(1000)
        ds.intercept('playPrev')
        expect(requestsMock.sendCommand).toHaveBeenLastCalledWith(
            expect.objectContaining({ type: 'track_change', payload: { index: 0, position_ms: 0, playing: true } })
        )
    })

    it('intercept(seek) optimistically moves the progress thumb', async () => {
        const { useDeviceSync, useQueue } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()
        ds.joined = true

        ds.intercept('seek', 42)
        expect(useQueue().duration.current).toBe(42)
        expect(requestsMock.sendCommand).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'seek', payload: { position_ms: 42000 } })
        )
    })

    it('does not re-adopt membership right after a voluntary leave (server lag race)', async () => {
        const { useDeviceSync } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()

        // Server considers us a member (page-reload semantics) → adopt.
        requestsMock.pollSession.mockResolvedValueOnce(mkPoll({ joined: true }))
        await ds.poll()
        expect(ds.joined).toBe(true)

        await ds.leave()
        expect(ds.joined).toBe(false)

        // The server has not processed the leave yet — this stale poll must
        // NOT bounce the device back into the group.
        requestsMock.pollSession.mockResolvedValueOnce(mkPoll({ joined: true }))
        await ds.poll()
        expect(ds.joined).toBe(false)
    })

    it('re-adopting a membership forces a full queue re-mirror (local list may have diverged)', async () => {
        const { useDeviceSync } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()

        requestsMock.resolveTracks.mockResolvedValue([mkTrack('h1'), mkTrack('h2')])
        requestsMock.pollSession.mockResolvedValueOnce(mkPoll({ version: 1, joined: true, state: mkState() }))
        await ds.poll()
        expect(requestsMock.resolveTracks).toHaveBeenCalledTimes(1)

        // Outage → solo; same server session survives with the same queue_id.
        ds.toSolo()

        requestsMock.pollSession.mockResolvedValueOnce(mkPoll({ version: 1, joined: true, state: mkState() }))
        await ds.poll()

        // Same queue_id, but the re-adopt reset the mirror → re-resolve.
        expect(requestsMock.resolveTracks).toHaveBeenCalledTimes(2)
        expect(ds.joined).toBe(true)
    })

    it('sends WHOLE-millisecond positions (a fractional one is rejected with 422)', async () => {
        const { useDeviceSync, useTracklist, useQueue } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()
        ds.joined = true

        useTracklist().tracklist = [mkTrack('h1'), mkTrack('h2')]
        useQueue().currentindex = 0
        // Real players report fractional seconds → *1000 keeps the fraction.
        playerMock.getCurrentTimeMs.mockReturnValue(3213.456)

        await ds.sendQueueSet()

        expect(requestsMock.setQueue).toHaveBeenCalledWith(expect.objectContaining({ position_ms: 3213 }))

        // ...and the seek command path too.
        ds.intercept('seek', 12.3456)
        expect(requestsMock.sendCommand).toHaveBeenLastCalledWith(
            expect.objectContaining({ type: 'seek', payload: { position_ms: 12346 } })
        )
    })

    it('surfaces a rejected sync call instead of swallowing it', async () => {
        const { useDeviceSync, useTracklist } = await setup()
        const { useToast } = await import('@/stores/notification')
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()
        ds.joined = true
        useTracklist().tracklist = [mkTrack('h1')]

        requestsMock.setQueue.mockResolvedValueOnce({ status: 422, data: {} })
        const toast = useToast()
        const spy = vi.spyOn(toast, 'showNotification')

        await ds.sendQueueSet()

        expect(spy).toHaveBeenCalled()
    })

    it('play seeds the group queue when the session never received one', async () => {
        const { useDeviceSync, useTracklist, useQueue } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()
        ds.joined = true

        useTracklist().tracklist = [mkTrack('h1'), mkTrack('h2')]
        useQueue().playing = false
        ds.lastMirroredHashKey = '' // nothing mirrored → server queue is empty

        ds.intercept('playPause')

        expect(requestsMock.setQueue).toHaveBeenCalledWith(
            expect.objectContaining({ trackhashes: ['h1', 'h2'], playing: true })
        )
        expect(requestsMock.sendCommand).not.toHaveBeenCalled()
    })

    it('applies this device audio offset to where it should be (Bluetooth latency trim)', async () => {
        const { useDeviceSync } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()

        ds.joined = true
        ds.playing = false
        ds.anchor = { position_ms: 10_000, at_server_ms: 1000 }
        expect(ds.expectedMs()).toBe(10_000)

        // A +300 ms trim means this device must run 300 ms AHEAD to
        // compensate a delayed output path — steering aims there.
        ds.setAudioOffset(300)
        expect(ds.audioOffsetMs).toBe(300)
        expect(ds.expectedMs()).toBe(10_300)
    })

    it('persists the audio offset across store instances', async () => {
        const { useDeviceSync } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        useDeviceSync().setAudioOffset(-120)

        const { loadAudioOffset } = await import('@/utils/deviceSync/audioOffset')
        expect(loadAudioOffset()).toBe(-120)
    })

    it('intercept(insertTracks) broadcasts the would-be queue instead of mutating locally', async () => {
        const { useDeviceSync, useTracklist, useQueue } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()
        ds.joined = true

        const tl = useTracklist()
        tl.tracklist = [mkTrack('h1'), mkTrack('h2')]
        useQueue().currentindex = 0

        // "Play next" funnels through tracklist.insertAt → the group seam.
        tl.insertAt([mkTrack('h9')], 1)

        expect(tl.tracklist.map((t: any) => t.trackhash)).toEqual(['h1', 'h2'])
        expect(requestsMock.setQueue).toHaveBeenCalledWith(
            expect.objectContaining({ trackhashes: ['h1', 'h9', 'h2'], currentindex: 0 })
        )
    })

    it('intercept(removeTracks) broadcasts the would-be queue and shifts the index up', async () => {
        const { useDeviceSync, useTracklist, useQueue } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()
        ds.joined = true

        const tl = useTracklist()
        tl.tracklist = [mkTrack('h1'), mkTrack('h2'), mkTrack('h3')]
        useQueue().currentindex = 2
        useQueue().playing = true
        playerMock.getCurrentTimeMs.mockReturnValue(41000)

        // "Remove from queue" funnels through tracklist.removeByIndex.
        tl.removeByIndex(0)

        // Local list untouched — the server's echo is what changes it.
        expect(tl.tracklist.map((t: any) => t.trackhash)).toEqual(['h1', 'h2', 'h3'])
        expect(useQueue().currentindex).toBe(2)
        // Removed BELOW the current track → the current one is now index 1, and
        // playback continues from where it is.
        expect(requestsMock.setQueue).toHaveBeenCalledWith(
            expect.objectContaining({
                trackhashes: ['h2', 'h3'],
                currentindex: 1,
                playing: true,
                position_ms: 41000,
            })
        )
    })

    it('removing the CURRENT track hands over to its successor and restarts at 0', async () => {
        const { useDeviceSync, useTracklist, useQueue } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()
        ds.joined = true

        const tl = useTracklist()
        tl.tracklist = [mkTrack('h1'), mkTrack('h2'), mkTrack('h3')]
        useQueue().currentindex = 1
        playerMock.getCurrentTimeMs.mockReturnValue(41000)

        tl.removeByIndex(1)

        expect(requestsMock.setQueue).toHaveBeenCalledWith(
            expect.objectContaining({ trackhashes: ['h1', 'h3'], currentindex: 1, position_ms: 0 })
        )

        // ...and removing the LAST track wraps to the top, exactly like the
        // solo path does. It used to clamp onto the new last row instead — a
        // different track than the one the group would have played next.
        requestsMock.setQueue.mockClear()
        useQueue().currentindex = 2
        tl.removeByIndex(2)

        expect(requestsMock.setQueue).toHaveBeenCalledWith(
            expect.objectContaining({ trackhashes: ['h1', 'h2'], currentindex: 0, position_ms: 0 })
        )
    })

    // -----------------------------------------------------------------------
    // #518: the group path asked "which slot falls away", the solo path asks
    // "who takes over". Under shuffle those are different rows, and the
    // leader's auto-advance (`track_change` with `queue.nextindex`) already
    // followed the solo answer — so removing the playing row moved the whole
    // group onto a track nobody was heading for. Synchronously, without an
    // error anywhere.
    // -----------------------------------------------------------------------
    it('broadcasts the pre-rolled shuffle successor when the playing row goes', async () => {
        const { useDeviceSync, useTracklist, useQueue, useSettings } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()
        ds.joined = true

        const tl = useTracklist()
        tl.tracklist = [mkTrack('h1'), mkTrack('h2'), mkTrack('h3'), mkTrack('h4')]
        const queue = useQueue()
        useSettings().shuffle = true
        queue.currentindex = 1
        queue.shuffleNextIndex = 3
        queue.playing = true

        tl.removeByIndex(1)

        // h4 was the pre-rolled target and sits at 2 once h2 is gone. The old
        // code sent 1 — which is h3, the row that merely slid into the gap.
        expect(requestsMock.setQueue).toHaveBeenCalledWith(
            expect.objectContaining({ trackhashes: ['h1', 'h3', 'h4'], currentindex: 2, position_ms: 0 })
        )
    })

    // Green against the old code too — `repeat: 'one'` was the one case where
    // "keep the slot" happened to give the right answer. Kept as a guard: the
    // new successor logic reads `nextindex`, which returns the row being
    // deleted here, so this is the branch that would break silently if the
    // fall-through were ever dropped.
    it('moves on instead of repeating a deleted row under repeat: one', async () => {
        const { useDeviceSync, useTracklist, useQueue, useSettings } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()
        ds.joined = true

        const tl = useTracklist()
        tl.tracklist = [mkTrack('h1'), mkTrack('h2'), mkTrack('h3')]
        const queue = useQueue()
        useSettings().repeat = 'one'
        queue.currentindex = 1
        queue.playing = true

        tl.removeByIndex(1)

        // `nextindex` returns the current row here, so "who takes over" has to
        // fall through to the row below — h3, which lands on 1.
        expect(requestsMock.setQueue).toHaveBeenCalledWith(
            expect.objectContaining({ trackhashes: ['h1', 'h3'], currentindex: 1 })
        )
    })

    it('an out-of-range remove is ignored instead of broadcasting a bogus queue', async () => {
        const { useDeviceSync, useTracklist } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()
        ds.joined = true

        useTracklist().tracklist = [mkTrack('h1'), mkTrack('h2')]
        ds.intercept('removeTracks', 7)

        expect(requestsMock.setQueue).not.toHaveBeenCalled()
    })

    it('intercept(clearQueue) empties the GROUP queue instead of only the local list', async () => {
        const { useDeviceSync, useTracklist, useQueue } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()
        ds.joined = true

        const tl = useTracklist()
        tl.tracklist = [mkTrack('h1'), mkTrack('h2')]
        const queue = useQueue()
        queue.currentindex = 1

        queue.clearQueue()

        expect(tl.tracklist.map((t: any) => t.trackhash)).toEqual(['h1', 'h2'])
        expect(requestsMock.setQueue).toHaveBeenCalledWith(
            expect.objectContaining({ trackhashes: [], currentindex: 0, playing: false, position_ms: 0 })
        )
    })

    it('mirroring an EMPTY group queue stops audio instead of letting the steerer hammer it to 0', async () => {
        const { useDeviceSync, useTracklist, useQueue } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()

        // Playing along in a group...
        requestsMock.resolveTracks.mockResolvedValueOnce([mkTrack('h1'), mkTrack('h2')])
        requestsMock.pollSession.mockResolvedValueOnce(
            mkPoll({ version: 1, joined: true, state: mkState({ playing: true }) })
        )
        await ds.poll()
        useQueue().playing = true

        // ...another device clears the queue: no track to reconcile onto, and
        // the anchor sits at 0 while this element is 41 s into the old track.
        requestsMock.resolveTracks.mockResolvedValueOnce([])
        requestsMock.pollSession.mockResolvedValueOnce(
            mkPoll({
                version: 2,
                joined: true,
                state: mkState({ queue_id: 'q-empty', trackhashes: [], playing: false }),
            })
        )
        playerMock.getCurrentTimeMs.mockReturnValue(41000)
        audioSourceMock.pausePlayingSource.mockClear()

        await ds.poll()

        expect(useTracklist().tracklist).toEqual([])
        // Stopped — which is also what defuses the steer loop: it may pull the
        // element onto the zero anchor once, but a PAUSED element stays there
        // instead of playing on and being yanked back every 250 ms.
        expect(audioSourceMock.pausePlayingSource).toHaveBeenCalled()
        expect(useQueue().playing).toBe(false)
    })

    it('the leader does not fire a track_change into an emptied queue (400 → error toast)', async () => {
        const { useDeviceSync, useTracklist, useSettings } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()
        ds.joined = true
        ds.scrobbleLeader = 'devA'

        useTracklist().tracklist = []
        useSettings().repeat = 'all'

        ds.onTrackEnded()

        expect(requestsMock.sendCommand).not.toHaveBeenCalled()
    })

    // --- membership feedback -------------------------------------------------
    // Joining takes a round trip plus a clock-calibration burst, leaving takes
    // a round trip, and the picker renders the SERVER device list — which the
    // next poll refreshes at the earliest. Both transitions therefore looked
    // like nothing had happened, and a second tap fired a second request.

    it('names the pending membership transition while the join is in flight', async () => {
        const { useDeviceSync } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()

        let release: (v: any) => void = () => {}
        requestsMock.joinGroup.mockReturnValueOnce(new Promise(r => (release = r)))

        const inFlight = ds.join()
        expect(ds.membershipPending).toBe('join')

        release({ status: 200, data: mkPoll({ joined: true }) })
        await inFlight
        expect(ds.membershipPending).toBeNull()
    })

    it('refuses a second join while the first one is still running', async () => {
        const { useDeviceSync } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()

        let release: (v: any) => void = () => {}
        requestsMock.joinGroup.mockReturnValueOnce(new Promise(r => (release = r)))

        const first = ds.join()
        await ds.join()
        await ds.joinNow()

        expect(requestsMock.joinGroup).toHaveBeenCalledTimes(1)

        release({ status: 200, data: mkPoll({ joined: true }) })
        await first
    })

    it('names the pending leave and refuses a second one', async () => {
        const { useDeviceSync } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()
        ds.joined = true

        let release: (v: any) => void = () => {}
        requestsMock.leaveGroup.mockReturnValueOnce(new Promise(r => (release = r)))

        const inFlight = ds.leave()
        expect(ds.membershipPending).toBe('leave')
        await ds.leave()
        expect(requestsMock.leaveGroup).toHaveBeenCalledTimes(1)

        release({ status: 200, data: {} })
        await inFlight
        expect(ds.membershipPending).toBeNull()
    })

    it('a leave that lands mid-join still leaves ("Not now" on the invite overlay)', async () => {
        const { useDeviceSync } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()

        let release: (v: any) => void = () => {}
        requestsMock.joinGroup.mockReturnValueOnce(new Promise(r => (release = r)))

        // The overlay appears while the join is still calibrating, so "Not now"
        // fires into exactly this window. Dropping the leave there would leave
        // the device inside the group it just declined.
        const joining = ds.joinNow()
        const leaving = ds.leave()
        release({ status: 200, data: mkPoll({ joined: true }) })
        await joining
        await leaving

        expect(requestsMock.leaveGroup).toHaveBeenCalledWith('devA')
        expect(ds.joined).toBe(false)
        expect(ds.membershipPending).toBeNull()
    })

    it('drops this device out of the cached device list on leave, without waiting for a poll', async () => {
        const { useDeviceSync } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()
        ds.joined = true
        ds.devices = [peer({ device_id: 'devA', name: 'This one' }), peer()]

        await ds.leave()

        expect(ds.devices.find(d => d.device_id === 'devA')?.joined).toBe(false)
        // Nobody else is touched — they are still in the group.
        expect(ds.devices.find(d => d.device_id === 'devB')?.joined).toBe(true)
    })

    it('marks this device as a member as soon as the join request lands', async () => {
        const { useDeviceSync } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()
        ds.devices = [peer({ device_id: 'devA', name: 'This one', joined: false })]

        // A join response without a device list (server restarted mid-call):
        // the row must still stop offering "Join group".
        requestsMock.joinGroup.mockResolvedValueOnce({ status: 200, data: {} })
        await ds.join()

        expect(ds.devices.find(d => d.device_id === 'devA')?.joined).toBe(true)
    })

    it('solo (not joined) keeps the local queue mutations local', async () => {
        const { useDeviceSync, useTracklist, useQueue } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()
        ds.joined = false

        const tl = useTracklist()
        tl.tracklist = [mkTrack('h1'), mkTrack('h2'), mkTrack('h3')]
        useQueue().currentindex = 0

        tl.removeByIndex(2)
        expect(tl.tracklist.map((t: any) => t.trackhash)).toEqual(['h1', 'h2'])

        useQueue().clearQueue()
        expect(tl.tracklist).toEqual([])
        expect(requestsMock.setQueue).not.toHaveBeenCalled()
    })

    // --- transitions, steering and the booked hand-over ----------------------
    // Measured with two browsers on one clock (~/syncprobe on the server): the
    // state that describes a transport command arrives with the command, i.e.
    // up to 1.5 s EARLY, and was applied on arrival — each device at its own
    // poll phase. A Next started the new track early and then restarted it,
    // a seek ran twice, a pause stopped every device at a different moment,
    // and the steerer re-seeked every 250 ms because each seek itself cost
    // more than its 80 ms threshold.

    const THREE = ['h1', 'h2', 'h3']

    /**
     * Joined and playing h1 of [h1, h2, h3] on a clock where server == local,
     * the join's own load already settled and the element on the anchor —
     * the steady state every transition starts from.
     */
    async function playingGroup(start = 100_000) {
        vi.useFakeTimers()
        vi.setSystemTime(start)
        const { useDeviceSync, useQueue, useTracklist } = await setup()
        localStorage.setItem('aivinnet.device_id', 'devA')
        const ds = useDeviceSync()
        await ds.register()

        requestsMock.resolveTracks.mockResolvedValue(THREE.map(mkTrack))
        requestsMock.pollSession.mockResolvedValueOnce(
            mkPoll({
                server_now_ms: start,
                joined: true,
                state: mkState({
                    trackhashes: THREE,
                    playing: true,
                    anchor: { position_ms: 0, at_server_ms: start },
                }),
            })
        )
        await ds.poll()

        playerMock.isPaused.mockReturnValue(false)
        playerMock.isAdvancing.mockReturnValue(true)
        playerMock.getCurrentTimeMs.mockImplementation(() => Math.round(ds.expectedMs()))
        vi.advanceTimersByTime(1000)
        vi.clearAllMocks()

        return { ds, queue: useQueue(), tracklist: useTracklist(), start }
    }

    /** A poll answer on the shared clock, carrying `state`. */
    const at = (state: any, over: Partial<any> = {}) =>
        mkPoll({ server_now_ms: Date.now(), version: 2, joined: true, state, ...over })

    async function settleMicrotasks() {
        for (let i = 0; i < 6; i++) await Promise.resolve()
    }

    /** The playbackRate the steerer set last. */
    const lastRate = () => {
        const calls = playerMock.setPlaybackRate.mock.calls
        return calls[calls.length - 1]?.[0]
    }

    it('a track change is prepared on arrival and switched to at its time — once', async () => {
        const { ds, queue } = await playingGroup()
        const now = Date.now()
        playerMock.groupStandbyReady.mockReturnValue(true)

        requestsMock.pollSession.mockResolvedValueOnce(
            at(
                mkState({
                    trackhashes: THREE,
                    currentindex: 1,
                    playing: true,
                    anchor: { position_ms: 0, at_server_ms: now + 1500 },
                }),
                {
                    commands: [
                        {
                            id: 'tc',
                            type: 'track_change',
                            payload: { index: 1, position_ms: 0, playing: true },
                            execute_at_ms: now + 1500,
                            target_device: null,
                        },
                    ],
                }
            )
        )
        await ds.poll()

        // Nothing sounds different yet: the old track plays on, the next one
        // loads on the standby element.
        expect(playerMock.prepareGroupStandby).toHaveBeenCalledWith(
            expect.objectContaining({ trackhash: 'h2' }),
            0,
            expect.any(String)
        )
        expect(playerMock.playCurrent).not.toHaveBeenCalled()
        expect(playerMock.switchToGroupStandby).not.toHaveBeenCalled()
        expect(queue.currentindex).toBe(0)

        vi.advanceTimersByTime(1500)
        expect(playerMock.switchToGroupStandby).toHaveBeenCalledTimes(1)
        expect(playerMock.switchToGroupStandby).toHaveBeenCalledWith(expect.objectContaining({ trackhash: 'h2' }), true, true)
        expect(queue.currentindex).toBe(1)

        // ...and nothing restarts it afterwards.
        vi.advanceTimersByTime(5000)
        expect(playerMock.switchToGroupStandby).toHaveBeenCalledTimes(1)
        expect(playerMock.playCurrent).not.toHaveBeenCalled()
        expect(playerMock.hardSeekMs).not.toHaveBeenCalled()
    })

    it('a seek happens once, at its time — not on arrival and again on the command', async () => {
        const { ds } = await playingGroup()
        const now = Date.now()
        playerMock.groupStandbyReady.mockReturnValue(true)
        playerMock.groupStandbyTimeMs.mockReturnValue(60_000)

        requestsMock.pollSession.mockResolvedValueOnce(
            at(mkState({ trackhashes: THREE, playing: true, anchor: { position_ms: 60_000, at_server_ms: now + 1500 } }))
        )
        await ds.poll()
        expect(playerMock.prepareGroupStandby).toHaveBeenCalledWith(
            expect.objectContaining({ trackhash: 'h1' }),
            60_000,
            expect.any(String)
        )
        expect(playerMock.hardSeekMs).not.toHaveBeenCalled()

        vi.advanceTimersByTime(6000)
        expect(playerMock.switchToGroupStandby).toHaveBeenCalledTimes(1)
        expect(playerMock.switchToGroupStandby).toHaveBeenCalledWith(expect.objectContaining({ trackhash: 'h1' }), true, false)
        expect(playerMock.hardSeekMs).not.toHaveBeenCalled()
    })

    it('a pause stops at its time on every device, exactly on the anchor', async () => {
        const { ds } = await playingGroup()
        const now = Date.now()

        requestsMock.pollSession.mockResolvedValueOnce(
            at(mkState({ trackhashes: THREE, playing: false, anchor: { position_ms: 2500, at_server_ms: now + 1500 } }))
        )
        await ds.poll()
        expect(audioSourceMock.pausePlayingSource).not.toHaveBeenCalled()

        vi.advanceTimersByTime(1499)
        expect(audioSourceMock.pausePlayingSource).not.toHaveBeenCalled()
        vi.advanceTimersByTime(1)
        expect(audioSourceMock.pausePlayingSource).toHaveBeenCalledTimes(1)
        expect(playerMock.hardSeekMs).toHaveBeenCalledWith(2500)
    })

    it('a resume starts early by this device start latency, right where it paused', async () => {
        const { ds } = await playingGroup()
        // Paused at 2.5 s.
        requestsMock.pollSession.mockResolvedValueOnce(
            at(mkState({ trackhashes: THREE, playing: false, anchor: { position_ms: 2500, at_server_ms: Date.now() } }))
        )
        await ds.poll()
        playerMock.isPaused.mockReturnValue(true)
        playerMock.getCurrentTimeMs.mockImplementation(() => 2500)
        vi.clearAllMocks()

        const now = Date.now()
        requestsMock.pollSession.mockResolvedValueOnce(
            at(mkState({ trackhashes: THREE, playing: true, anchor: { position_ms: 2500, at_server_ms: now + 1500 } }), {
                version: 3,
            })
        )
        await ds.poll()

        // Default start latency is 30 ms: play() goes out at 1470 ms.
        vi.advanceTimersByTime(1469)
        expect(audioSourceMock.playPlayingSource).not.toHaveBeenCalled()
        vi.advanceTimersByTime(1)
        expect(audioSourceMock.playPlayingSource).toHaveBeenCalledTimes(1)
        expect(playerMock.hardSeekMs).not.toHaveBeenCalled()
        expect(playerMock.prepareGroupStandby).not.toHaveBeenCalled()
    })

    it('a queue edit while listening leaves the audio alone (it used to jump back 1.5 s)', async () => {
        const { ds, tracklist, start } = await playingGroup()

        requestsMock.resolveTracks.mockResolvedValue([...THREE, 'h9'].map(mkTrack))
        requestsMock.pollSession.mockResolvedValueOnce(
            at(
                mkState({
                    queue_id: 'q2',
                    trackhashes: [...THREE, 'h9'],
                    playing: true,
                    // A live edit keeps the anchor: it lies in the past.
                    anchor: { position_ms: 0, at_server_ms: start },
                })
            )
        )
        await ds.poll()

        expect(tracklist.tracklist.map((t: any) => t.trackhash)).toEqual([...THREE, 'h9'])
        expect(playerMock.playCurrent).not.toHaveBeenCalled()
        expect(playerMock.switchToGroupStandby).not.toHaveBeenCalled()
        expect(playerMock.hardSeekMs).not.toHaveBeenCalled()
        expect(audioSourceMock.pausePlayingSource).not.toHaveBeenCalled()
    })

    it('sends queue edits as live, new starts not', async () => {
        const { ds, tracklist, queue } = await playingGroup()

        tracklist.insertAt([mkTrack('h9')], 3)
        expect(requestsMock.setQueue).toHaveBeenLastCalledWith(expect.objectContaining({ live: true }))

        queue.clearQueue()
        expect(requestsMock.setQueue).toHaveBeenLastCalledWith(expect.objectContaining({ live: false }))

        ds.lastMirroredHashKey = 'something else'
        ds.intercept('play', 1)
        expect(requestsMock.setQueue).toHaveBeenLastCalledWith(expect.objectContaining({ live: false, position_ms: 0 }))
    })

    it('seeks once when off and lets the seek land before judging again (no seek storm)', async () => {
        const { ds } = await playingGroup()

        // 400 ms behind — say, after a buffering stall.
        playerMock.getCurrentTimeMs.mockImplementation(() => Math.round(ds.expectedMs()) - 400)
        vi.advanceTimersByTime(250)
        expect(playerMock.hardSeekMs).toHaveBeenCalledTimes(1)
        // Aimed ahead by this device's seek latency (default 90 ms).
        expect(playerMock.hardSeekMs).toHaveBeenLastCalledWith(ds.expectedMs() + 90)

        // It still reads as behind while the seek lands — no second seek.
        vi.advanceTimersByTime(500)
        expect(playerMock.hardSeekMs).toHaveBeenCalledTimes(1)
    })

    it('learns its seek latency from where a seek actually landed', async () => {
        const { ds } = await playingGroup()

        playerMock.getCurrentTimeMs.mockImplementation(() => Math.round(ds.expectedMs()) - 400)
        vi.advanceTimersByTime(250)
        expect(playerMock.hardSeekMs).toHaveBeenCalledTimes(1)

        // The seek cost 140 ms here, not the 90 assumed: settled, the device
        // sits 50 ms behind → the estimate moves 60 % of the way.
        playerMock.getCurrentTimeMs.mockImplementation(() => Math.round(ds.expectedMs()) - 50)
        vi.advanceTimersByTime(750)

        expect(__latencyForTest().seek).toBe(120)
        expect(JSON.parse(localStorage.getItem('aivinnet.sync_latency') as string).seek).toBe(120)
        // The residual itself is small: eased out by rate, not seeked.
        expect(playerMock.hardSeekMs).toHaveBeenCalledTimes(1)
        expect(lastRate()).toBeCloseTo(1.025, 6)
    })

    it('the leader books the next track for the exact end of the current one', async () => {
        const { ds, start } = await playingGroup()
        ds.scrobbleLeader = 'devA'
        // h1 is 4.5 s long and has played 1 s: 3.5 s left, inside the window.
        playerMock.durationMs.mockReturnValue(4500)

        vi.advanceTimersByTime(250)
        expect(requestsMock.sendCommand).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'track_change',
                payload: { index: 1, position_ms: 0, playing: true },
                execute_at_ms: start + 4500,
            })
        )

        // One booking per anchor, and `ended` must not advance a second time.
        vi.advanceTimersByTime(1000)
        ds.onTrackEnded()
        expect(requestsMock.sendCommand).toHaveBeenCalledTimes(1)
    })

    it('a booking that failed leaves the advance to `ended`', async () => {
        const { ds } = await playingGroup()
        ds.scrobbleLeader = 'devA'
        playerMock.durationMs.mockReturnValue(4500)
        requestsMock.sendCommand.mockResolvedValueOnce({ status: 400, data: {} })

        vi.advanceTimersByTime(250)
        await settleMicrotasks()
        ds.onTrackEnded()

        expect(requestsMock.sendCommand).toHaveBeenCalledTimes(2)
        expect(requestsMock.sendCommand).toHaveBeenLastCalledWith(
            expect.objectContaining({ type: 'track_change', payload: { index: 1, position_ms: 0, playing: true } })
        )
        expect((requestsMock.sendCommand.mock.calls[1] as any[])[0].execute_at_ms).toBeUndefined()
    })

    it('a second Next during the lead counts from the track the group is heading to', async () => {
        const { ds } = await playingGroup()
        requestsMock.pollSession.mockResolvedValueOnce(
            at(
                mkState({
                    trackhashes: THREE,
                    currentindex: 1,
                    playing: true,
                    anchor: { position_ms: 0, at_server_ms: Date.now() + 1500 },
                })
            )
        )
        await ds.poll()

        ds.intercept('playNext')
        expect(requestsMock.sendCommand).toHaveBeenLastCalledWith(
            expect.objectContaining({ type: 'track_change', payload: { index: 2, position_ms: 0, playing: true } })
        )

        // ...and Previous right after a Next goes back to the track still playing here.
        ds.intercept('playPrev')
        expect(requestsMock.sendCommand).toHaveBeenLastCalledWith(
            expect.objectContaining({ type: 'track_change', payload: { index: 0, position_ms: 0, playing: true } })
        )
    })

    it('only the newest held state takes effect', async () => {
        const { ds, queue } = await playingGroup()
        const now = Date.now()
        playerMock.groupStandbyReady.mockReturnValue(true)

        requestsMock.pollSession.mockResolvedValueOnce(
            at(
                mkState({
                    trackhashes: THREE,
                    currentindex: 1,
                    playing: true,
                    anchor: { position_ms: 0, at_server_ms: now + 1500 },
                })
            )
        )
        await ds.poll()
        // Withdrawn before its time: the group pauses h1 instead.
        requestsMock.pollSession.mockResolvedValueOnce(
            at(mkState({ trackhashes: THREE, playing: false, anchor: { position_ms: 2800, at_server_ms: now + 1800 } }), {
                version: 3,
            })
        )
        await ds.poll()

        vi.advanceTimersByTime(3000)
        expect(playerMock.switchToGroupStandby).not.toHaveBeenCalled()
        expect(queue.currentindex).toBe(0)
        expect(audioSourceMock.pausePlayingSource).toHaveBeenCalledTimes(1)
    })

    it('a stale poll answer cannot roll back a newer state', async () => {
        const { ds, queue } = await playingGroup()

        let releaseOld: (v: any) => void = () => {}
        requestsMock.pollSession.mockReturnValueOnce(new Promise(r => (releaseOld = r)))
        const oldPoll = ds.poll()

        requestsMock.pollSession.mockResolvedValueOnce(
            at(mkState({ trackhashes: THREE, currentindex: 2, playing: true, anchor: { position_ms: 0, at_server_ms: 1 } }), {
                version: 3,
            })
        )
        await ds.poll()
        expect(queue.currentindex).toBe(2)

        releaseOld(
            at(mkState({ trackhashes: THREE, currentindex: 1, playing: true, anchor: { position_ms: 0, at_server_ms: 1 } }))
        )
        await oldPoll
        expect(queue.currentindex).toBe(2)
        expect(ds.sessionVersion).toBe(3)
    })

    it('a transition committed late (throttled timer) moves the standby on before it sounds', async () => {
        const { ds } = await playingGroup()
        const now = Date.now()
        playerMock.groupStandbyReady.mockReturnValue(true)
        playerMock.groupStandbyTimeMs.mockReturnValue(0)

        requestsMock.pollSession.mockResolvedValueOnce(
            at(
                mkState({
                    trackhashes: THREE,
                    currentindex: 1,
                    playing: true,
                    anchor: { position_ms: 0, at_server_ms: now + 1500 },
                })
            )
        )
        await ds.poll()

        // A hidden tab's timer fires 800 ms late: the wall clock runs on while
        // the timer (due at 1470 ms, start latency 30) waits.
        vi.setSystemTime(now + 800)
        vi.advanceTimersByTime(1470)

        // Where the group will be once this device sounds: 800 ms into h2.
        expect(playerMock.seekGroupStandbyMs).toHaveBeenCalledWith(800)
        expect(playerMock.switchToGroupStandby).toHaveBeenCalledTimes(1)
    })

    it('leaving resets a steering rate instead of leaving solo playback stretched', async () => {
        const { ds } = await playingGroup()
        playerMock.getCurrentTimeMs.mockImplementation(() => Math.round(ds.expectedMs()) + 60)
        vi.advanceTimersByTime(250)
        expect(lastRate()).toBeCloseTo(0.97, 6)

        ds.toSolo()
        expect(playerMock.setPlaybackRate).toHaveBeenLastCalledWith(1)
    })
})
