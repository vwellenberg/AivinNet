import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FromOptions } from '@/enums'

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

import useTracker, { sendLogData } from '@/stores/tracker'

/** Stands in for the Worker behind sendLogData; records what would be POSTed. */
const posted: any[] = []
class FakeWorker {
    constructor(public url: string) {}
    postMessage(data: any) {
        posted.push({ url: this.url, ...data })
    }
}

class FakeAudio extends EventTarget {
    paused = false
}

function setCurrentTrack(hash: string) {
    queueMock.currenttrack = { trackhash: hash }
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
            },
        ])
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
