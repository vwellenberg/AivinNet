import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// A controllable device-sync stand-in: flip joined/applying per test and assert
// that the queue seams route to intercept() (or fall through to local bodies).
const { dsMock } = vi.hoisted(() => ({
    dsMock: { joined: false, applying: false, intercept: vi.fn() },
}))
vi.mock('@/stores/devicesync', () => ({ default: () => dsMock }))

// player.ts builds real <audio> elements at import — stub it.
vi.mock('@/stores/player', () => ({
    usePlayer: () => ({ playCurrent() {}, clearNextAudio() {}, clearMovingNextTimeout() {} }),
    audioSource: { playingSource: { src: '', paused: true, currentTime: 0 } },
    getUrl: () => '',
}))
vi.mock('@/stores/interface', () => ({ default: () => ({ focusCurrentInSidebar() {} }) }))
vi.mock('@/stores/pages/playlists', () => ({ default: () => ({ movePlayedToTop: vi.fn() }) }))

import useQueue from '@/stores/queue'
import useTracklist from '@/stores/queue/tracklist'

const mkTrack = (hash: string): any => ({ trackhash: hash, filepath: `/music/${hash}.mp3`, title: hash, duration: 1 })

describe('queue group-mode seams', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        dsMock.joined = false
        dsMock.applying = false
        dsMock.intercept.mockReset()
    })

    it('joined + not applying: play intercepts and does not mutate queue state', () => {
        const q = useQueue()
        useTracklist().tracklist = [mkTrack('a'), mkTrack('b'), mkTrack('c')]
        dsMock.joined = true

        q.play(2)

        expect(dsMock.intercept).toHaveBeenCalledWith('play', 2)
        expect(q.currentindex).toBe(0)
        expect(q.playing).toBe(false)
    })

    it('joined + not applying: seek/playPause/playNext route to intercept without local mutation', () => {
        const q = useQueue()
        useTracklist().tracklist = [mkTrack('a'), mkTrack('b')]
        dsMock.joined = true

        q.seek(42)
        q.playPause()
        q.playNext()

        expect(dsMock.intercept).toHaveBeenCalledWith('seek', 42)
        expect(dsMock.intercept).toHaveBeenCalledWith('playPause')
        expect(dsMock.intercept).toHaveBeenCalledWith('playNext')
        expect(q.currentindex).toBe(0)
        expect(q.duration.current).toBe(0)
    })

    it('applying=true: actions run their normal local bodies', () => {
        const q = useQueue()
        useTracklist().tracklist = [mkTrack('a'), mkTrack('b'), mkTrack('c')]
        dsMock.joined = true
        dsMock.applying = true

        q.play(2)

        expect(dsMock.intercept).not.toHaveBeenCalled()
        expect(q.currentindex).toBe(2)
        expect(q.playing).toBe(true)
    })

    it('joined + not applying: queue removals and clears route to intercept', () => {
        const q = useQueue()
        const tl = useTracklist()
        tl.tracklist = [mkTrack('a'), mkTrack('b'), mkTrack('c')]
        dsMock.joined = true

        tl.removeByIndex(1)
        expect(dsMock.intercept).toHaveBeenCalledWith('removeTracks', 1)
        expect(tl.tracklist.map((t: any) => t.trackhash)).toEqual(['a', 'b', 'c'])

        q.clearQueue()
        expect(dsMock.intercept).toHaveBeenCalledWith('clearQueue')
        expect(tl.tracklist).toHaveLength(3)
    })

    it('applying=true: the mirror removes/clears locally without re-broadcasting', () => {
        const q = useQueue()
        const tl = useTracklist()
        tl.tracklist = [mkTrack('a'), mkTrack('b')]
        dsMock.joined = true
        dsMock.applying = true

        tl.removeByIndex(1)
        expect(tl.tracklist.map((t: any) => t.trackhash)).toEqual(['a'])

        q.clearQueue()
        expect(tl.tracklist).toEqual([])
        expect(dsMock.intercept).not.toHaveBeenCalled()
    })

    // "Play next" (context menus of album/artist/folder/playlist and the
    // sidebar's playlist row) used to splice the local list itself, so the
    // group queue never learned about it — the classic silent desync (#434).
    it('joined + not applying: "Play next" routes to intercept and leaves the local list alone', () => {
        const q = useQueue()
        const tl = useTracklist()
        tl.tracklist = [mkTrack('a'), mkTrack('b'), mkTrack('c')]
        q.currentindex = 1
        dsMock.joined = true

        const added = [mkTrack('x'), mkTrack('y')]
        tl.insertAfterCurrent(added)

        // The insert lands behind the playing track — index 2 here.
        expect(dsMock.intercept).toHaveBeenCalledWith('insertTracks', added, 2)
        expect(tl.tracklist.map((t: any) => t.trackhash)).toEqual(['a', 'b', 'c'])
    })

    it('solo: "Play next" splices right after the current track', () => {
        const q = useQueue()
        const tl = useTracklist()
        tl.tracklist = [mkTrack('a'), mkTrack('b'), mkTrack('c')]
        q.currentindex = 1

        tl.insertAfterCurrent([mkTrack('x'), mkTrack('y')])

        expect(dsMock.intercept).not.toHaveBeenCalled()
        expect(tl.tracklist.map((t: any) => t.trackhash)).toEqual(['a', 'b', 'x', 'y', 'c'])
    })

    it('joined + not applying: reordering the queue routes to intercept', () => {
        const tl = useTracklist()
        tl.tracklist = [mkTrack('a'), mkTrack('b'), mkTrack('c')]
        dsMock.joined = true

        tl.moveTrack(0, 3)

        expect(dsMock.intercept).toHaveBeenCalledWith('moveTrack', 0, 3)
        expect(tl.tracklist.map((t: any) => t.trackhash)).toEqual(['a', 'b', 'c'])
    })

    it('solo: reordering splices locally and carries the playing track with it', () => {
        const q = useQueue()
        const tl = useTracklist()
        tl.tracklist = [mkTrack('a'), mkTrack('b'), mkTrack('c'), mkTrack('d')]
        q.currentindex = 2 // "c" is playing

        // Drag "a" to the very bottom: everything above the playing track shifts
        // up, so "c" must end up at index 1 and still be the current track.
        tl.moveTrack(0, 4)

        expect(dsMock.intercept).not.toHaveBeenCalled()
        expect(tl.tracklist.map((t: any) => t.trackhash)).toEqual(['b', 'c', 'd', 'a'])
        expect(q.currentindex).toBe(1)
        expect(tl.tracklist[q.currentindex].trackhash).toBe('c')
    })

    it('solo: dragging the playing track moves the index with it', () => {
        const q = useQueue()
        const tl = useTracklist()
        tl.tracklist = [mkTrack('a'), mkTrack('b'), mkTrack('c')]
        q.currentindex = 0

        tl.moveTrack(0, 3)

        expect(tl.tracklist.map((t: any) => t.trackhash)).toEqual(['b', 'c', 'a'])
        expect(q.currentindex).toBe(2)
    })

    it('a no-op drop neither splices nor broadcasts', () => {
        const tl = useTracklist()
        tl.tracklist = [mkTrack('a'), mkTrack('b')]
        dsMock.joined = true

        tl.moveTrack(1, 2) // the gap directly below the row itself

        expect(dsMock.intercept).not.toHaveBeenCalled()
        expect(tl.tracklist.map((t: any) => t.trackhash)).toEqual(['a', 'b'])
    })

    it('autoPlayNext no-ops when joined', () => {
        const q = useQueue()
        useTracklist().tracklist = [mkTrack('a'), mkTrack('b')]
        dsMock.joined = true
        q.currentindex = 0

        q.autoPlayNext()

        expect(q.currentindex).toBe(0)
    })

    it('solo (not joined): play mutates locally and never intercepts', () => {
        const q = useQueue()
        useTracklist().tracklist = [mkTrack('a'), mkTrack('b'), mkTrack('c')]
        dsMock.joined = false

        q.play(1)

        expect(dsMock.intercept).not.toHaveBeenCalled()
        expect(q.currentindex).toBe(1)
        expect(q.playing).toBe(true)
    })
})
