import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The queue store pulls in the player, device sync, the router and media
// notifications. None of that matters for the next/prev index maths, so stub it.
const { tracklistState } = vi.hoisted(() => ({ tracklistState: { tracklist: [] as any[] } }))

vi.mock('@/stores/player', () => ({
    audioSource: {
        playingSource: { src: '', currentTime: 0 },
        pausePlayingSource: vi.fn(),
        playPlayingSource: vi.fn(),
    },
    getUrl: () => '',
    usePlayer: () => ({
        playCurrent: vi.fn(),
        clearNextAudio: vi.fn(),
        clearMovingNextTimeout: vi.fn(),
    }),
}))
vi.mock('@/stores/devicesync', () => ({ default: () => ({ joined: false, applying: false, intercept: vi.fn() }) }))
vi.mock('@/stores/interface', () => ({ default: () => ({ focusCurrentInSidebar: vi.fn() }) }))
vi.mock('@/stores/lyrics', () => ({ default: () => ({ setCurrentLine: vi.fn(), calculateCurrentLine: () => 0 }) }))
vi.mock('@/stores/notification', () => ({
    NotifType: { Success: 0, Error: 1, Info: 2 },
    useToast: () => ({ showNotification: vi.fn() }),
}))
vi.mock('@/stores/queue/tracklist', () => ({ default: () => tracklistState }))
vi.mock('@/helpers/mediaNotification', () => ({ default: vi.fn() }))
vi.mock('@/requests/favorite', () => ({ isFavorite: () => Promise.resolve(false) }))
vi.mock('@/router', () => ({
    router: { currentRoute: { value: { name: 'other' } } },
    Routes: { Lyrics: 'Lyrics' },
}))

import useQueue from '@/stores/queue'
import useSettings from '@/stores/settings'

const seedQueue = (n: number) => {
    tracklistState.tracklist = Array.from({ length: n }, (_, i) => ({ trackhash: `h${i}`, filepath: `${i}.mp3` }))
}

describe('queue store: permanent shuffle', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        seedQueue(10)
    })

    it('walks the queue in order while shuffle is off', () => {
        const queue = useQueue()
        queue.currentindex = 3

        expect(queue.nextindex).toBe(4)
        expect(queue.previndex).toBe(2)
    })

    it('wraps around at the ends while shuffle is off', () => {
        const queue = useQueue()

        queue.currentindex = 9
        expect(queue.nextindex).toBe(0)

        queue.currentindex = 0
        expect(queue.previndex).toBe(9)
    })

    it('toggleShuffle flips the persisted setting', () => {
        const queue = useQueue()
        const settings = useSettings()

        expect(settings.shuffle).toBe(false)
        queue.toggleShuffle()
        expect(settings.shuffle).toBe(true)
        queue.toggleShuffle()
        expect(settings.shuffle).toBe(false)
    })

    it('picks a random next track once shuffle is on', () => {
        const queue = useQueue()
        queue.currentindex = 3
        queue.toggleShuffle()

        expect(queue.shuffleNextIndex).not.toBeNull()
        expect(queue.nextindex).toBe(queue.shuffleNextIndex)
        expect(queue.nextindex).not.toBe(3)
    })

    it('nextindex is stable across reads — the roll happens in an action', () => {
        // This is what keeps the audio preload and the group-session track_change
        // broadcast pointing at the same track.
        const queue = useQueue()
        queue.toggleShuffle()

        const reads = new Set([queue.nextindex, queue.nextindex, queue.nextindex, queue.nextindex])
        expect(reads.size).toBe(1)
    })

    it('re-rolls when the current track changes', () => {
        const queue = useQueue()
        queue.toggleShuffle()

        const rolls = new Set<number>()
        for (let i = 0; i < 40; i++) {
            queue.play(i % 10, false)
            rolls.add(queue.nextindex)
        }

        // A single fixed target across 40 track changes would mean it never re-rolled.
        expect(rolls.size).toBeGreaterThan(1)
    })

    it('never hands out the current index as next', () => {
        const queue = useQueue()
        queue.toggleShuffle()

        for (let i = 0; i < 60; i++) {
            queue.play(i % 10, false)
            expect(queue.nextindex).not.toBe(queue.currentindex)
        }
    })

    it('repeat "one" wins over shuffle', () => {
        const queue = useQueue()
        const settings = useSettings()

        queue.currentindex = 5
        queue.toggleShuffle()
        settings.repeat = 'one'

        expect(queue.nextindex).toBe(5)
        expect(queue.previndex).toBe(5)
    })

    it('previndex returns the track that actually played before', () => {
        const queue = useQueue()
        queue.toggleShuffle()

        queue.play(2, false)
        queue.play(7, false)

        expect(queue.previndex).toBe(2)
    })

    it('turning shuffle off restores sequential order and clears the roll', () => {
        const queue = useQueue()
        queue.currentindex = 4
        queue.toggleShuffle()
        queue.toggleShuffle()

        expect(queue.shuffleNextIndex).toBeNull()
        expect(queue.shuffleRecent).toEqual([])
        expect(queue.nextindex).toBe(5)
    })

    it('falls back to sequential when a stale roll points at the current track', () => {
        // Not every write to currentindex can re-roll: the group-session mirror
        // sets it directly by design. The getter must still never answer "next =
        // the track playing right now".
        const queue = useQueue()
        queue.toggleShuffle()
        queue.currentindex = 4
        queue.shuffleNextIndex = 4

        expect(queue.nextindex).toBe(5)
    })

    it('falls back to sequential when a stale roll points past the queue', () => {
        const queue = useQueue()
        queue.currentindex = 1
        queue.toggleShuffle()

        seedQueue(3)
        queue.shuffleNextIndex = 42

        expect(queue.nextindex).toBe(2)
    })

    it('is safe on a single-track queue', () => {
        seedQueue(1)
        const queue = useQueue()
        queue.toggleShuffle()

        expect(queue.nextindex).toBe(0)
        expect(queue.previndex).toBe(0)
    })

    it('is safe on an empty queue', () => {
        // An empty queue never plays, and its sequential nextindex is already
        // meaningless (0 === -1 is false, so it answers 1). The invariant worth
        // holding is that shuffle does not make it any worse.
        seedQueue(0)
        const queue = useQueue()
        const sequential = queue.nextindex

        expect(() => queue.toggleShuffle()).not.toThrow()
        expect(queue.nextindex).toBe(sequential)
        expect(queue.previndex).toBe(-1)
    })

    describe('playSource — starting a source', () => {
        it('starts on the first row while shuffle is off', () => {
            const queue = useQueue()
            queue.currentindex = 7

            queue.playSource()

            expect(queue.currentindex).toBe(0)
        })

        it('enters somewhere random once shuffle is on', () => {
            const queue = useQueue()
            queue.toggleShuffle()

            const starts = new Set<number>()
            for (let i = 0; i < 40; i++) {
                queue.playSource()
                starts.add(queue.currentindex)
            }

            // Always row 0 would mean "Play" opens with the same song every time.
            expect(starts.size).toBeGreaterThan(1)
        })

        it('never re-enters on the track that is already playing', () => {
            const queue = useQueue()
            queue.toggleShuffle()

            for (let i = 0; i < 60; i++) {
                const before = queue.currentindex
                queue.playSource()
                expect(queue.currentindex).not.toBe(before)
            }
        })

        it('starts on the only track of a one-track queue', () => {
            seedQueue(1)
            const queue = useQueue()
            queue.toggleShuffle()

            queue.playSource()

            expect(queue.currentindex).toBe(0)
        })
    })

    describe('moveForward — the gapless advance', () => {
        // This is how a track that plays out to its end actually advances: the
        // player switches to the pre-loaded audio and only reports the new index.
        // It used to skip the re-roll, so the target kept pointing at the track
        // that had just started and shuffle replayed the same song forever.
        it('never leaves the next target sitting on the current track', () => {
            const queue = useQueue()
            queue.currentindex = 3
            queue.toggleShuffle()

            const visited: number[] = []

            for (let i = 0; i < 20; i++) {
                queue.moveForward()
                visited.push(queue.currentindex)
                expect(queue.nextindex).not.toBe(queue.currentindex)
            }

            // A stuck target would visit exactly one track, twenty times over.
            expect(new Set(visited).size).toBeGreaterThan(1)
        })

        it('records the advance in the shuffle history', () => {
            const queue = useQueue()
            queue.toggleShuffle()
            queue.play(2, false)

            queue.moveForward()

            expect(queue.shuffleRecent[queue.shuffleRecent.length - 1]).toBe(queue.currentindex)
        })

        it('still steps one row forward with shuffle off', () => {
            const queue = useQueue()
            queue.currentindex = 3

            queue.moveForward()

            expect(queue.currentindex).toBe(4)
        })
    })

    describe('autoPlayNext', () => {
        it('follows the shuffle roll instead of the next row', () => {
            const queue = useQueue()
            const settings = useSettings()
            settings.repeat = 'all'

            queue.currentindex = 3
            queue.toggleShuffle()
            const target = queue.nextindex

            queue.autoPlayNext()

            expect(queue.currentindex).toBe(target)
        })

        it('still advances sequentially with shuffle off', () => {
            const queue = useQueue()
            const settings = useSettings()
            settings.repeat = 'all'
            queue.currentindex = 3

            queue.autoPlayNext()

            expect(queue.currentindex).toBe(4)
        })

        it('repeat "one" replays the same track even with shuffle on', () => {
            const queue = useQueue()
            const settings = useSettings()

            queue.currentindex = 6
            queue.toggleShuffle()
            settings.repeat = 'one'

            queue.autoPlayNext()

            expect(queue.currentindex).toBe(6)
        })
    })
})
