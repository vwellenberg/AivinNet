import { describe, expect, it } from 'vitest'

import { rangeAligns, resolveQueueMove } from '@/utils/queueMove'

/** Mirror of the splice the store performs, so the maths can be checked end to end. */
function applyMove<T>(items: T[], from: number, finalIndex: number): T[] {
    const result = items.slice()
    const [item] = result.splice(from, 1)
    result.splice(finalIndex, 0, item)
    return result
}

const queue = ['a', 'b', 'c', 'd', 'e']

describe('resolveQueueMove', () => {
    it('corrects the drop gap to a final index when moving down', () => {
        // Dropping "a" on the bottom half of "c" emits to = 3.
        const move = resolveQueueMove(queue.length, 0, 3, 4)
        expect(move?.finalIndex).toBe(2)
        expect(applyMove(queue, 0, move!.finalIndex)).toEqual(['b', 'c', 'a', 'd', 'e'])
    })

    it('takes the drop gap as-is when moving up', () => {
        const move = resolveQueueMove(queue.length, 3, 1, 4)
        expect(move?.finalIndex).toBe(1)
        expect(applyMove(queue, 3, move!.finalIndex)).toEqual(['a', 'd', 'b', 'c', 'e'])
    })

    it('returns null when the row lands where it already was', () => {
        expect(resolveQueueMove(queue.length, 2, 2, 0)).toBeNull()
        // to = from + 1 is the gap directly below the row itself.
        expect(resolveQueueMove(queue.length, 2, 3, 0)).toBeNull()
    })

    it('rejects indices outside the queue', () => {
        expect(resolveQueueMove(queue.length, -1, 2, 0)).toBeNull()
        expect(resolveQueueMove(queue.length, 5, 2, 0)).toBeNull()
        expect(resolveQueueMove(queue.length, 1, 6, 0)).toBeNull()
        expect(resolveQueueMove(queue.length, 1.5, 2, 0)).toBeNull()
    })

    describe('the playing track keeps playing', () => {
        // The one thing a server cannot work out for us: a reorder must never
        // turn into a track change. Each case below moves a row and checks that
        // the reported currentindex still points at the same trackhash.
        const check = (from: number, to: number, currentindex: number) => {
            const move = resolveQueueMove(queue.length, from, to, currentindex)
            expect(move).not.toBeNull()
            const after = applyMove(queue, from, move!.finalIndex)
            expect(after[move!.currentindex]).toBe(queue[currentindex])
        }

        it('follows the playing track when it is the one dragged', () => {
            const move = resolveQueueMove(queue.length, 1, 4, 1)
            expect(move).toEqual({ finalIndex: 3, currentindex: 3 })
            check(1, 4, 1)
        })

        it('shifts up when a track from above lands below it', () => {
            const move = resolveQueueMove(queue.length, 0, 4, 2)
            expect(move).toEqual({ finalIndex: 3, currentindex: 1 })
            check(0, 4, 2)
        })

        it('shifts down when a track from below lands above it', () => {
            const move = resolveQueueMove(queue.length, 4, 1, 2)
            expect(move).toEqual({ finalIndex: 1, currentindex: 3 })
            check(4, 1, 2)
        })

        it('shifts up when a track from above lands exactly in its slot', () => {
            // "a" dropped on the BOTTOM half of "c": to = 3, finalIndex = 2 —
            // exactly where the playing track sat, so it is pushed up to 1.
            expect(resolveQueueMove(queue.length, 0, 3, 2)).toEqual({ finalIndex: 2, currentindex: 1 })
            check(0, 3, 2)
        })

        it('stays put when a track from above lands just short of its slot', () => {
            // One gap higher (to = 2, finalIndex = 1): the removal above and the
            // insertion above cancel out. This is the off-by-one the four cases
            // exist to get right.
            expect(resolveQueueMove(queue.length, 0, 2, 2)).toEqual({ finalIndex: 1, currentindex: 2 })
            check(0, 2, 2)
        })

        it('shifts down when a track from below lands exactly in its slot', () => {
            expect(resolveQueueMove(queue.length, 4, 2, 2)).toEqual({ finalIndex: 2, currentindex: 3 })
            check(4, 2, 2)
        })

        it('leaves it alone when both ends of the move are below it', () => {
            expect(resolveQueueMove(queue.length, 3, 5, 1)).toEqual({ finalIndex: 4, currentindex: 1 })
            check(3, 5, 1)
        })

        it('leaves it alone when both ends of the move are above it', () => {
            expect(resolveQueueMove(queue.length, 0, 2, 4)).toEqual({ finalIndex: 1, currentindex: 4 })
            check(0, 2, 4)
        })
    })
})
