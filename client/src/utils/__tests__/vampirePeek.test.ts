import { describe, expect, it } from 'vitest'

import {
    PEEK_DELAY_MAX_MS,
    PEEK_DELAY_MIN_MS,
    PEEK_DURATION_MS,
    PEEK_SIZE_PX,
    nextPeekDelayMs,
    peekAnchor,
    pickPeekTarget,
    type PeekRect,
} from '@/utils/vampirePeek'

const VP = { width: 1000, height: 800 }
const MIDDLE = () => 0.5

function rect(top: number, left: number, width = 100, height = 100): PeekRect {
    return { top, left, width, height, bottom: top + height, right: left + width }
}

/** Deterministic but well spread (mulberry32). */
function sequence(seed: number): () => number {
    let s = seed >>> 0
    return () => {
        s = (s + 0x6d2b79f5) | 0
        let t = Math.imul(s ^ (s >>> 15), 1 | s)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

describe('nextPeekDelayMs: every 40 to 80 seconds', () => {
    it('spans the range from the random source', () => {
        expect(PEEK_DELAY_MIN_MS).toBe(40000)
        expect(PEEK_DELAY_MAX_MS).toBe(80000)
        expect(nextPeekDelayMs(() => 0)).toBe(40000)
        expect(nextPeekDelayMs(() => 0.5)).toBe(60000)
        for (let seed = 1; seed <= 30; seed++) {
            const d = nextPeekDelayMs(sequence(seed))
            expect(d).toBeGreaterThanOrEqual(40000)
            expect(d).toBeLessThan(80000)
        }
    })
})

describe('pickPeekTarget: a card fully inside the viewport, with room above', () => {
    it('returns null when no cover fits (the peek is skipped)', () => {
        expect(pickPeekTarget([], VP, MIDDLE)).toBeNull()
        // Sticks out of the bottom, and one that sits too high for the emoji to rise.
        expect(pickPeekTarget([rect(750, 10), rect(10, 10)], VP, MIDDLE)).toBeNull()
    })

    it('needs room above the cover for the emoji to rise into', () => {
        expect(PEEK_SIZE_PX).toBe(56)
        expect(pickPeekTarget([rect(PEEK_SIZE_PX - 1, 10)], VP, MIDDLE)).toBeNull()
        expect(pickPeekTarget([rect(PEEK_SIZE_PX, 10)], VP, MIDDLE)).toBe(0)
    })

    it('returns the index in the original list, skipping the covers that do not fit', () => {
        const rects = [rect(100, 10), rect(790, 10), rect(200, 300), rect(100, 950)]
        // Only index 0 and 2 fit; the random source chooses between them.
        expect(pickPeekTarget(rects, VP, () => 0)).toBe(0)
        expect(pickPeekTarget(rects, VP, () => 0.99)).toBe(2)
    })

    it('ignores a rect with no area (display: none, or not laid out)', () => {
        expect(pickPeekTarget([rect(100, 100, 0, 0)], VP, MIDDLE)).toBeNull()
    })

    it('chooses among the fitting covers with the random source, for any seed', () => {
        const rects = [rect(100, 10), rect(100, 200), rect(100, 400)]
        const picked = new Set<number | null>()
        for (let seed = 1; seed <= 40; seed++) picked.add(pickPeekTarget(rects, VP, sequence(seed)))
        expect(picked).toEqual(new Set([0, 1, 2]))
    })
})

describe('peekAnchor and the whole peek', () => {
    it('anchors at the middle of the cover\'s top edge', () => {
        expect(peekAnchor(rect(120, 40, 200, 200))).toEqual({ x: 140, y: 120 })
    })

    it('lasts a few seconds: rise, a pause of about a second, the puff and the bat', () => {
        expect(PEEK_DURATION_MS).toBe(3200)
    })
})
