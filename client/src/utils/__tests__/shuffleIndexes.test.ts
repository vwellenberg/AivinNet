import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { resolveQueueMove } from '@/utils/queueMove'
import { remapAfterMove, shiftAfterInsert, shiftAfterRemove, successorOnRemove } from '@/utils/shuffleIndexes'

describe('shiftAfterInsert', () => {
    it('leaves indexes in front of the insert alone', () => {
        expect(shiftAfterInsert(2, 4, 1)).toBe(2)
        expect(shiftAfterInsert(3, 4, 1)).toBe(3)
    })

    it('pushes an index sitting exactly on the insert down', () => {
        // The new row takes that slot, so the tracked track moved.
        expect(shiftAfterInsert(4, 4, 1)).toBe(5)
    })

    it('shifts by the number of inserted rows', () => {
        expect(shiftAfterInsert(6, 2, 3)).toBe(9)
    })

    it('is a no-op for an empty insert', () => {
        expect(shiftAfterInsert(6, 2, 0)).toBe(6)
        expect(shiftAfterInsert(6, 2, -1)).toBe(6)
    })
})

describe('shiftAfterRemove', () => {
    it('moves indexes behind the removed row up', () => {
        expect(shiftAfterRemove(5, 2)).toBe(4)
    })

    it('leaves indexes in front of it alone', () => {
        expect(shiftAfterRemove(1, 2)).toBe(1)
    })

    it('returns null for the removed row itself', () => {
        // It names nothing now. Collapsing it onto a neighbour would hand back
        // a track the picker never chose.
        expect(shiftAfterRemove(2, 2)).toBeNull()
    })
})

describe('remapAfterMove', () => {
    it('travels with the row when it IS the moved one', () => {
        expect(remapAfterMove(3, 3, 7)).toBe(7)
    })

    it('shifts up when a row from above lands at or below it', () => {
        expect(remapAfterMove(5, 2, 5)).toBe(4)
        expect(remapAfterMove(5, 2, 8)).toBe(4)
    })

    it('shifts down when a row from below lands at or above it', () => {
        expect(remapAfterMove(5, 8, 5)).toBe(6)
        expect(remapAfterMove(5, 8, 2)).toBe(6)
    })

    it('stays put when the move happens entirely to one side', () => {
        expect(remapAfterMove(5, 7, 8)).toBe(5)
        expect(remapAfterMove(5, 1, 3)).toBe(5)
    })

    // The playing track goes through exactly these cases in resolveQueueMove,
    // and shuffle's indexes have no reason to disagree with it. This calls the
    // real function rather than restating its branches — a hand-copied clone
    // would compare remapAfterMove to itself and could never catch a drift
    // between the two.
    it('agrees with the currentindex arithmetic in resolveQueueMove', () => {
        const LENGTH = 10

        for (let from = 0; from < LENGTH; from++) {
            for (let to = 0; to <= LENGTH; to++) {
                for (let tracked = 0; tracked < LENGTH; tracked++) {
                    const move = resolveQueueMove(LENGTH, from, to, tracked)
                    if (!move) continue

                    expect(remapAfterMove(tracked, from, move.finalIndex)).toBe(move.currentindex)
                }
            }
        }
    })
})

describe('successorOnRemove', () => {
    it('hands over to the pre-rolled next row, wherever it is (shuffle)', () => {
        expect(successorOnRemove(10, 3, 7)).toBe(7)
        expect(successorOnRemove(10, 3, 0)).toBe(0)
    })

    it('hands over to the row below in sequential order', () => {
        // `nextindex` already is the row below there — passed through as is.
        expect(successorOnRemove(10, 3, 4)).toBe(4)
    })

    it("never repeats the row that is going away (repeat: 'one')", () => {
        expect(successorOnRemove(10, 3, 3)).toBe(4)
    })

    it('wraps to the top when the last row repeats and goes away', () => {
        expect(successorOnRemove(10, 9, 9)).toBe(0)
    })

    it('answers with a PRE-splice index — the caller shifts it', () => {
        const successor = successorOnRemove(10, 3, 7)
        expect(shiftAfterRemove(successor, 3)).toBe(6)
    })
})

// ---------------------------------------------------------------------------
// #264: the solo path and the group seam wrote this rule out each, and two
// copies of a queue rule are how the group drifted before (#506 → #518). Both
// halves call the helper, and neither spells the wrap out again.
// ---------------------------------------------------------------------------
describe('one successor rule for both halves', () => {
    it.each([
        ['src/stores/queue/tracklist.ts', 'removeByIndex'],
        ['src/stores/devicesync.ts', "case 'removeTracks'"],
    ])('%s (%s) asks successorOnRemove', (file, anchor) => {
        const source = readFileSync(file, 'utf8')
        const at = source.indexOf(anchor)
        expect(at, `${anchor} not found in ${file}`).toBeGreaterThanOrEqual(0)
        expect(source.slice(at, at + 4000)).toMatch(/successorOnRemove\(/)
        // The wrap written out by hand: `… === <len> - 1 ? 0 : … + 1`.
        expect(source).not.toMatch(/length\s*-\s*1\s*\?\s*0\s*:/)
    })
})
