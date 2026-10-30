import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FromOptions } from '@/enums'
import { QUEUE_UNDO_MS } from '@/helpers/queueUndo'
import { useToast } from '@/stores/notification'

// Controllable device-sync stand-in: flip joined/applying per test.
const { dsMock, player } = vi.hoisted(() => ({
    dsMock: { joined: false, applying: false, intercept: vi.fn() },
    player: { playCurrent: vi.fn(), clearNextAudio: vi.fn() },
}))
vi.mock('@/stores/devicesync', () => ({ default: () => dsMock }))

// player.ts builds real <audio> elements at import — stub it.
vi.mock('@/stores/player', () => ({
    usePlayer: () => ({
        playCurrent: player.playCurrent,
        clearNextAudio: player.clearNextAudio,
        clearMovingNextTimeout() {},
    }),
    audioSource: { playingSource: { src: '', paused: true, currentTime: 0 } },
    getUrl: () => '',
}))
vi.mock('@/stores/interface', () => ({ default: () => ({ focusCurrentInSidebar() {} }) }))
vi.mock('@/stores/pages/playlists', () => ({ default: () => ({ movePlayedToTop: vi.fn() }) }))

import useQueue from '@/stores/queue'
import useTracklist from '@/stores/queue/tracklist'
import useSettings from '@/stores/settings'

const mk = (hash: string): any => ({
    trackhash: hash,
    filepath: `/music/${hash}.mp3`,
    title: `Title ${hash}`,
    duration: 1,
})

const hashes = () => useTracklist().tracklist.map((t: any) => t.trackhash)

/** The Undo action of the one toast on offer, if any. */
function undoToasts() {
    return useToast().notifs.filter(n => n.action?.label === 'Undo')
}

function undoHandler(): () => void {
    const [toast] = undoToasts()
    if (!toast?.action) throw new Error('no Undo toast on offer')
    return toast.action.handler
}

describe('queue undo (#644)', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        setActivePinia(createPinia())
        dsMock.joined = false
        dsMock.applying = false
        dsMock.intercept.mockReset()
        player.playCurrent.mockReset()
        player.clearNextAudio.mockReset()
        useSettings().shuffle = false
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    describe('removal', () => {
        it('a row above the playing track: undo restores the same list and the same currentindex', () => {
            const q = useQueue()
            const tl = useTracklist()
            tl.tracklist = [mk('a'), mk('b'), mk('c'), mk('d')]
            q.currentindex = 2

            tl.removeByIndex(0)
            expect(hashes()).toEqual(['b', 'c', 'd'])
            expect(q.currentindex).toBe(1)

            undoHandler()()

            expect(hashes()).toEqual(['a', 'b', 'c', 'd'])
            expect(q.currentindex).toBe(2)
        })

        it('a row below the playing track: undo restores list and currentindex', () => {
            const q = useQueue()
            const tl = useTracklist()
            tl.tracklist = [mk('a'), mk('b'), mk('c'), mk('d')]
            q.currentindex = 1

            tl.removeByIndex(3)
            undoHandler()()

            expect(hashes()).toEqual(['a', 'b', 'c', 'd'])
            expect(q.currentindex).toBe(1)
        })

        it('removing the playing track: undo brings the row back without changing the track that plays', () => {
            const q = useQueue()
            const tl = useTracklist()
            tl.tracklist = [mk('a'), mk('b'), mk('c'), mk('d')]
            q.currentindex = 1
            q.playing = true

            tl.removeByIndex(1)
            // The successor started (that is the removal's own track change).
            expect(q.currentindex).toBe(1)
            expect(hashes()).toEqual(['a', 'c', 'd'])
            const loadsBeforeUndo = player.playCurrent.mock.calls.length

            undoHandler()()

            expect(hashes()).toEqual(['a', 'b', 'c', 'd'])
            // Still on 'c' — the track that was playing — now at its new row.
            expect(hashes()[q.currentindex]).toBe('c')
            expect(q.playing).toBe(true)
            expect(player.playCurrent.mock.calls.length).toBe(loadsBeforeUndo)
        })

        it('a second removal replaces the undo state: only the latest one comes back', () => {
            const q = useQueue()
            const tl = useTracklist()
            tl.tracklist = [mk('a'), mk('b'), mk('c'), mk('d')]
            q.currentindex = 3

            tl.removeByIndex(0) // a
            const firstHandler = undoHandler()
            tl.removeByIndex(1) // c (from [b, c, d])

            // The first toast is gone; exactly one Undo is on offer.
            expect(undoToasts()).toHaveLength(1)

            // Even if the stale handler is invoked, it does nothing.
            firstHandler()
            expect(hashes()).toEqual(['b', 'd'])

            undoHandler()()
            expect(hashes()).toEqual(['b', 'c', 'd'])
            expect(q.currentindex).toBe(2)
        })

        it('undo after the window does nothing', () => {
            const tl = useTracklist()
            tl.tracklist = [mk('a'), mk('b'), mk('c')]

            tl.removeByIndex(1)
            const handler = undoHandler()

            vi.advanceTimersByTime(QUEUE_UNDO_MS + 1)
            handler()

            expect(hashes()).toEqual(['a', 'c'])
        })

        it('the undo toast is an action toast that lives as long as the window', () => {
            const tl = useTracklist()
            tl.tracklist = [mk('a'), mk('b')]

            tl.removeByIndex(0)
            expect(undoToasts()).toHaveLength(1)

            vi.advanceTimersByTime(QUEUE_UNDO_MS - 1)
            expect(undoToasts()).toHaveLength(1)

            vi.advanceTimersByTime(1)
            expect(undoToasts()).toHaveLength(0)
        })

        it('no undo when the queue changed after the removal (a track was added)', () => {
            const tl = useTracklist()
            tl.tracklist = [mk('a'), mk('b'), mk('c')]

            tl.removeByIndex(0)
            const handler = undoHandler()
            tl.insertAt([mk('x')], 0)

            handler()

            expect(hashes()).toEqual(['x', 'b', 'c'])
        })

        it('keeps shuffle pointing at the same tracks, before and after the undo', () => {
            const q = useQueue()
            const tl = useTracklist()
            tl.tracklist = [mk('a'), mk('b'), mk('c'), mk('d'), mk('e')]
            useSettings().shuffle = true
            q.currentindex = 0
            q.shuffleRecent = [0]
            q.shuffleNextIndex = 3 // 'd'

            tl.removeByIndex(1) // 'b' — above the target
            expect(hashes()[q.nextindex]).toBe('d')

            undoHandler()()
            expect(hashes()).toEqual(['a', 'b', 'c', 'd', 'e'])
            expect(hashes()[q.nextindex]).toBe('d')
        })

        it('removing the only track: undo restores it with its source', () => {
            const q = useQueue()
            const tl = useTracklist()
            tl.tracklist = [mk('a')]
            tl.from = { type: FromOptions.search, query: 'x' } as any
            q.currentindex = 0

            tl.removeByIndex(0)
            expect(hashes()).toEqual([])

            undoHandler()()

            expect(hashes()).toEqual(['a'])
            expect(tl.from).toEqual({ type: FromOptions.search, query: 'x' })
            expect(q.currentindex).toBe(0)
        })
    })

    describe('clear', () => {
        it('undo restores the tracks, their order, the source and the playing index', () => {
            const q = useQueue()
            const tl = useTracklist()
            tl.tracklist = [mk('a'), mk('b'), mk('c')]
            tl.from = { type: FromOptions.search, query: 'x' } as any
            q.currentindex = 2

            q.clearQueue()
            expect(hashes()).toEqual([])
            expect(q.currentindex).toBe(0)

            undoHandler()()

            expect(hashes()).toEqual(['a', 'b', 'c'])
            expect(tl.from).toEqual({ type: FromOptions.search, query: 'x' })
            expect(q.currentindex).toBe(2)
        })

        it('no undo offered for clearing an empty queue', () => {
            useQueue().clearQueue()
            expect(undoToasts()).toHaveLength(0)
        })

        it('no undo when tracks were added during the window', () => {
            const q = useQueue()
            const tl = useTracklist()
            tl.tracklist = [mk('a')]

            q.clearQueue()
            const handler = undoHandler()
            tl.insertAt([mk('x')], 0)

            handler()

            expect(hashes()).toEqual(['x'])
        })

        it('undo after the window does nothing', () => {
            const tl = useTracklist()
            tl.tracklist = [mk('a'), mk('b')]

            useQueue().clearQueue()
            const handler = undoHandler()
            vi.advanceTimersByTime(QUEUE_UNDO_MS + 1)

            handler()
            expect(hashes()).toEqual([])
        })
    })

    describe('group mode', () => {
        it('a removal in a group is intercepted and gets no local undo', () => {
            const tl = useTracklist()
            tl.tracklist = [mk('a'), mk('b'), mk('c')]
            dsMock.joined = true

            tl.removeByIndex(1)

            expect(dsMock.intercept).toHaveBeenCalledWith('removeTracks', 1)
            expect(hashes()).toEqual(['a', 'b', 'c'])
            expect(undoToasts()).toHaveLength(0)
            // A plain confirmation, without the action.
            expect(useToast().notifs.map(n => [n.text, n.action])).toEqual([['Removed “Title b”', undefined]])
        })

        it('a clear in a group is intercepted and gets no local undo', () => {
            const tl = useTracklist()
            tl.tracklist = [mk('a'), mk('b')]
            dsMock.joined = true

            useQueue().clearQueue()

            expect(dsMock.intercept).toHaveBeenCalledWith('clearQueue')
            expect(hashes()).toEqual(['a', 'b'])
            expect(undoToasts()).toHaveLength(0)
            expect(useToast().notifs.map(n => [n.text, n.action])).toEqual([['Queue cleared', undefined]])
        })

        it('joining during the window: the undo does not mutate the local queue', () => {
            const tl = useTracklist()
            tl.tracklist = [mk('a'), mk('b'), mk('c')]

            tl.removeByIndex(0)
            const handler = undoHandler()
            dsMock.joined = true
            dsMock.intercept.mockReset()

            handler()

            expect(hashes()).toEqual(['b', 'c'])
            expect(dsMock.intercept).not.toHaveBeenCalled()
        })

        it('the mirror (applying) removes and clears without offering an undo', () => {
            const tl = useTracklist()
            tl.tracklist = [mk('a'), mk('b')]
            dsMock.joined = true
            dsMock.applying = true

            tl.removeByIndex(1)
            useQueue().clearQueue()

            expect(dsMock.intercept).not.toHaveBeenCalled()
            expect(undoToasts()).toHaveLength(0)
        })
    })
})
