import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FromOptions } from '@/enums'
import { getOrCreateDeviceId } from '@/utils/deviceSync/deviceId'

// ---------------------------------------------------------------------------
// The play tracker is the only thing that writes listening history, and
// listening history is the only input every mix and recommendation has
// (ScrobbleTable). A bug here does not crash anything: the mixes just get
// quietly worse. So the parts the backend depends on are pinned here —
// the wire format (/logger/track/log, parsed by models/logger.py), what counts
// as play time, and who is allowed to submit in a group session.
// ---------------------------------------------------------------------------

const { dsMock, queueMock, tracklistMock, audioSourceMock } = vi.hoisted(() => ({
    dsMock: { joined: false, isScrobbleLeader: true },
    queueMock: { currenttrack: { trackhash: 'a' }, currenttrackhash: 'a' },
    tracklistMock: { from: {} as any },
    audioSourceMock: { playingSource: null as any },
}))
vi.mock('@/stores/devicesync', () => ({ default: () => dsMock }))
vi.mock('@/stores/queue', () => ({ default: () => queueMock }))
vi.mock('@/stores/queue/tracklist', () => ({ default: () => tracklistMock }))
// player.ts builds real <audio> elements at import — stub it.
vi.mock('@/stores/player', () => ({ audioSource: audioSourceMock }))
const { celebrateMilestone } = vi.hoisted(() => ({ celebrateMilestone: vi.fn() }))
vi.mock('@/utils/milestones', () => ({ celebrateMilestone }))

import useTracker, { minLoggedSeconds, sendLogData } from '@/stores/tracker'
import useHome from '@/stores/home'

/** Stands in for the Worker behind sendLogData; records what would be POSTed. */
const posted: any[] = []
class FakeWorker {
    static last: FakeWorker | undefined
    onmessage: ((e: { data: any }) => void) | null = null
    constructor(public url: string) {
        FakeWorker.last = this
    }
    postMessage(data: any) {
        posted.push({ url: this.url, ...data })
    }
}

class FakeAudio extends EventTarget {
    paused = false
}

function setCurrentTrack(hash: string, duration?: number) {
    queueMock.currenttrack = { trackhash: hash, duration } as any
    queueMock.currenttrackhash = hash
}

/** Let wall time pass, then fire one `timeupdate` on the given element(s). */
function tick(ms = 1000, ...elements: FakeAudio[]) {
    vi.advanceTimersByTime(ms)
    for (const el of elements.length ? elements : [audioSourceMock.playingSource]) {
        el.dispatchEvent(new Event('timeupdate'))
    }
}

const ALBUM = { type: FromOptions.album, albumhash: 'alb1', name: 'Album' }

beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-21T12:00:00Z'))
    vi.stubGlobal('Worker', FakeWorker)
    posted.length = 0
    dsMock.joined = false
    dsMock.isScrobbleLeader = true
    setCurrentTrack('a')
    tracklistMock.from = ALBUM
    audioSourceMock.playingSource = new FakeAudio()
})

afterEach(() => {
    // The timeupdate throttle and the submit lock are timers; run them out so
    // the next test does not start inside this one's quiet window.
    vi.advanceTimersByTime(5000)
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

describe('sendLogData — the wire format the backend parses', () => {
    // models/logger.py maps these prefixes to a source type; pf: and q: are
    // sent too and land there as plain track plays.
    it.each([
        [{ type: FromOptions.album, albumhash: 'h1' }, 'al:h1'],
        [{ type: FromOptions.artist, artisthash: 'h2' }, 'ar:h2'],
        [{ type: FromOptions.folder, path: '/music/x' }, 'fo:/music/x'],
        [{ type: FromOptions.playlist, id: 7 }, 'pl:7'],
        [{ type: FromOptions.playlistFolder, id: 3 }, 'pf:3'],
        [{ type: FromOptions.search, query: 'blue' }, 'q:blue'],
        [{ type: FromOptions.favorite }, 'favorite'],
    ])('%o is sent as source %s', (from, source) => {
        sendLogData('t1', 60_000, from as any, 1)
        expect(posted[0].source).toBe(source)
    })

    it('sends duration in whole seconds, rounded, to the logger worker', () => {
        sendLogData('t1', 4600, ALBUM as any, 1790000000)
        expect(posted).toEqual([
            {
                url: '/workers/logtrack.js',
                trackhash: 't1',
                duration: 5,
                source: 'al:alb1',
                timestamp: 1790000000,
                deviceId: getOrCreateDeviceId(),
            },
        ])
    })

    it('tells the worker which device played (#541): the id the device-sync registry knows this browser by', () => {
        localStorage.setItem('aivinnet.device_id', 'device-phone-1')

        sendLogData('t1', 60_000, ALBUM as any, 1)

        expect(posted[0].deviceId).toBe('device-phone-1')
    })

    it('drops plays the server would reject as skips (under 5 s after rounding)', () => {
        sendLogData('t1', 4400, ALBUM as any, 1) // rounds to 4
        sendLogData('t1', 1500, ALBUM as any, 1)
        expect(posted).toEqual([])

        sendLogData('t1', 4500, ALBUM as any, 1) // rounds to 5: accepted
        expect(posted).toHaveLength(1)
    })

    // #882: a track shorter than 5 s could never count as played, so an album
    // holding one stayed in "Almost complete" forever. The same table as
    // tests/test_play_floor.py: client and server must agree, or the server 400s.
    it.each([
        [0, 5], // length unknown: the plain floor
        [3, 1],
        [4, 2],
        [6, 4],
        [7, 5],
        [300, 5],
    ])('a %i s track counts from %i s of play', (length, floor) => {
        expect(minLoggedSeconds(length)).toBe(floor)
    })

    it('sends a short track that ran to the end (#882)', () => {
        sendLogData('t1', 1400, ALBUM as any, 1, 3) // 3 s stinger, 1 s measured: played through
        expect(posted).toHaveLength(1)
        expect(posted[0].duration).toBe(1)

        sendLogData('t1', 1400, ALBUM as any, 1, 200) // the same second of a long track: a skip
        expect(posted).toHaveLength(1)
    })

    it('celebrates a milestone play the worker passes back (#545)', () => {
        celebrateMilestone.mockClear()
        sendLogData('t1', 60_000, ALBUM as any, 1)

        const milestone = { number: 1000, track: 'Blue' }
        FakeWorker.last?.onmessage?.({ data: { logged: true, milestone } })

        expect(celebrateMilestone).toHaveBeenCalledWith(milestone)
    })

    it('does nothing (and does not throw) without Worker support', () => {
        vi.stubGlobal('Worker', undefined)
        expect(() => sendLogData('t1', 60_000, ALBUM as any, 1)).not.toThrow()
        expect(posted).toEqual([])
    })
})

describe('play time accounting', () => {
    it('counts the wall time between timeupdate ticks and stamps the last one', () => {
        const tracker = useTracker()
        tracker.resetData()
        tracker.reassignEventListener()

        for (let i = 0; i < 5; i++) tick()

        expect(tracker.duration).toBe(5000)
        expect(tracker.timestamp).toBe(Math.floor(Date.now() / 1000))
    })

    it('does not count a pause (or any gap longer than 1.75 s)', () => {
        const tracker = useTracker()
        tracker.resetData()
        tracker.reassignEventListener()

        for (let i = 0; i < 3; i++) tick()
        vi.advanceTimersByTime(60_000) // paused: no timeupdate fires
        tick() // the first tick after resuming spans the gap — not counted
        tick()

        expect(tracker.duration).toBe(4000)
    })

    it('a track change submits the previous track with the source it was started from', () => {
        const tracker = useTracker()
        tracker.resetData() // track "a", started from ALBUM
        tracker.reassignEventListener()
        for (let i = 0; i < 30; i++) tick()

        setCurrentTrack('b')
        tracklistMock.from = { type: FromOptions.playlist, id: 7 }
        tracker.changeKey()
        tick()

        expect(posted).toHaveLength(1)
        expect(posted[0]).toMatchObject({ trackhash: 'a', duration: 30, source: 'al:alb1' })
        // ...and the tracker has moved on to the new track.
        expect(tracker.trackhash).toBe('b')
        expect(tracker.from).toEqual({ type: FromOptions.playlist, id: 7 })
    })
})

// A fresh browser profile has no persisted tracker: no trackhash, no source,
// and `key`/`prevKey` that the first play's changeKey() pulls apart. The
// key-change flush then fired ~2 s into track 1 and sent track 1 itself with
// source "" — and the real play at its end went out too (measured 2026-11-21:
// two 201s for one play). The player's own order of calls, as player.ts makes them.
describe('the first play of a fresh session', () => {
    function playFromAlbum(hash: string, seconds: number) {
        setCurrentTrack(hash, seconds)
        tracklistMock.from = ALBUM
        const tracker = useTracker()
        tracker.changeKey() // playCurrentTrack()
        tracker.reassignEventListener() // assignEventHandlers()
        return tracker
    }

    beforeEach(() => {
        // player.ts wires the tracker at setup, before anything is queued.
        queueMock.currenttrack = {} as any
        queueMock.currenttrackhash = ''
        tracklistMock.from = {}
        useTracker().reassignEventListener()
    })

    it('logs track 1 once, from the album it was started from, with all its play time', () => {
        const tracker = playFromAlbum('a', 200)
        for (let i = 0; i < 30; i++) tick()

        tracker.submitData() // ended

        expect(posted).toHaveLength(1)
        expect(posted[0]).toMatchObject({ trackhash: 'a', source: 'al:alb1', duration: 30 })
    })

    it('a short track (low floor, #882) is not counted twice', () => {
        // 3 s: its floor is 1 s, so the bogus early send passed it and the server took it.
        const tracker = playFromAlbum('a', 3)
        for (let i = 0; i < 6; i++) tick()

        setCurrentTrack('b', 200) // the next track starts
        tracker.changeKey()
        tick()

        expect(posted.filter((p) => p.trackhash === 'a')).toHaveLength(1)
        expect(posted).toEqual([expect.objectContaining({ trackhash: 'a', source: 'al:alb1' })])
    })
})

// The same flush, one track later: `ended` submits the finished track and the
// reset re-arms the tracker on it (the queue has not moved yet). The next track's
// changeKey() then made the flush send the finished track a second time, timed
// with the new track's first seconds.
describe('after the ended submit', () => {
    it('the next track start does not send the finished track again', () => {
        setCurrentTrack('a', 3)
        const tracker = useTracker()
        tracker.resetData()
        tracker.reassignEventListener()
        for (let i = 0; i < 3; i++) tick()
        tracker.submitData() // ended: "a" is sent
        expect(posted).toHaveLength(1)

        vi.advanceTimersByTime(300)
        setCurrentTrack('b', 200) // queue.playNext() → playCurrentTrack()
        tracklistMock.from = { type: FromOptions.playlist, id: 7 }
        tracker.changeKey()
        for (let i = 0; i < 10; i++) tick()

        expect(posted).toHaveLength(1)
        // ...and the 10 s of "b" are counted for "b", with its own source.
        expect(tracker.trackhash).toBe('b')
        expect(tracker.duration).toBe(10_000)
        tracker.submitData()
        expect(posted[1]).toMatchObject({ trackhash: 'b', duration: 10, source: 'pl:7' })
    })
})

describe('a short track (#882)', () => {
    it('a 3 s stinger that played through is submitted on the next track', () => {
        setCurrentTrack('stinger', 3)
        const tracker = useTracker()
        tracker.resetData()
        tracker.reassignEventListener()
        tick() // first tick of the stinger
        tick() // a second later; it ends before the next one

        setCurrentTrack('b', 200)
        tracker.changeKey()
        tick()

        expect(posted).toHaveLength(1)
        expect(posted[0]).toMatchObject({ trackhash: 'stinger', duration: 2 })
        expect(tracker.trackSeconds).toBe(200)
    })
})

describe('submitData', () => {
    it('submits once even when called twice for the same track (ended + track change)', () => {
        const tracker = useTracker()
        tracker.resetData()
        tracker.reassignEventListener()
        for (let i = 0; i < 10; i++) tick()

        tracker.submitData()
        tracker.submitData()

        expect(posted).toHaveLength(1)
        expect(posted[0]).toMatchObject({ trackhash: 'a', duration: 10 })
    })

    it('group session, not the scrobble leader: submits nothing and discards the accumulated time', () => {
        dsMock.joined = true
        dsMock.isScrobbleLeader = false
        const tracker = useTracker()
        tracker.resetData()
        tracker.reassignEventListener()
        for (let i = 0; i < 10; i++) tick()

        setCurrentTrack('b')
        tracker.submitData()

        expect(posted).toEqual([])
        // Discarded, not deferred: a later leadership change must not submit
        // one inflated scrobble against a stale trackhash.
        expect(tracker.duration).toBe(0)
        expect(tracker.trackhash).toBe('b')
    })

    it('group session, scrobble leader: submits', () => {
        dsMock.joined = true
        dsMock.isScrobbleLeader = true
        const tracker = useTracker()
        tracker.resetData()
        tracker.reassignEventListener()
        for (let i = 0; i < 10; i++) tick()

        tracker.submitData()

        expect(posted).toHaveLength(1)
        expect(posted[0]).toMatchObject({ trackhash: 'a', duration: 10 })
    })
})

describe('timeupdate listener', () => {
    // player.ts calls reassignEventListener on every track start and has no
    // handle to remove the previous listener — they must not pile up.
    it('wires each audio element once, however often it is re-assigned', () => {
        const el = audioSourceMock.playingSource as FakeAudio
        const add = vi.spyOn(el, 'addEventListener')
        const tracker = useTracker()

        for (let i = 0; i < 5; i++) tracker.reassignEventListener()

        expect(add.mock.calls.filter(([type]) => type === 'timeupdate')).toHaveLength(1)
    })

    it('with both gapless elements wired, one tick of wall time is counted once', () => {
        const first = audioSourceMock.playingSource as FakeAudio
        const second = new FakeAudio()
        const tracker = useTracker()
        tracker.resetData()
        tracker.reassignEventListener()
        audioSourceMock.playingSource = second // gapless swap
        tracker.reassignEventListener()

        // The standby element can fire timeupdate too (it plays silence on
        // iOS). Play time is a wall-clock delta against one shared timestamp,
        // so a second listener firing at the same moment adds nothing.
        for (let i = 0; i < 5; i++) tick(1000, second, first)

        expect(tracker.duration).toBe(5000)
    })
})

// #529: a play that is logged takes its song out of the Home card at once.
describe('sendLogData and Home (#529)', () => {
    it('tells the Home store the song was heard, once the server took the play', () => {
        const home = useHome()
        const spy = vi.spyOn(home, 'notePlayed')

        sendLogData('t1', 60_000, ALBUM as any, 1)
        expect(posted).toHaveLength(1)
        // Sent, not yet taken: the card stays until the server answers.
        expect(spy).not.toHaveBeenCalled()

        FakeWorker.last?.onmessage?.({ data: { logged: true, milestone: null } })
        expect(spy).toHaveBeenCalledWith('t1')
    })

    it('leaves the card when the worker never reports the play as taken', () => {
        const spy = vi.spyOn(useHome(), 'notePlayed')

        sendLogData('t1', 60_000, ALBUM as any, 1)

        expect(posted).toHaveLength(1)
        expect(spy).not.toHaveBeenCalled()
    })

    it('does not tell Home about a play below the floor', () => {
        const spy = vi.spyOn(useHome(), 'notePlayed')

        sendLogData('t1', 1500, ALBUM as any, 1)

        expect(posted).toEqual([])
        expect(spy).not.toHaveBeenCalled()
    })
})
