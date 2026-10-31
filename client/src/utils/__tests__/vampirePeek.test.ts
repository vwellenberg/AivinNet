import { describe, expect, it } from 'vitest'

import {
    PEEK_DELAY_MAX_MS,
    PEEK_DELAY_MIN_MS,
    PEEK_DURATION_MS,
    PEEK_LAUNCH_FRACTION,
    PEEK_SIZE_PX,
    nextPeekDelayMs,
    peekAnchor,
    peekExit,
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

describe('peekExit: the bat flies off the screen, it does not fade', () => {
    /** Where the bat's centre ends up, and whether its glyph is clear of the viewport on both edges. */
    function endsOffScreen(anchor: { x: number; y: number }, vp = VP): boolean {
        const exit = peekExit(anchor)
        const cx = anchor.x + exit.x
        const cy = anchor.y + exit.y
        const half = PEEK_SIZE_PX / 2
        return cx + half < 0 && cy + half < 0 && cx - half < vp.width && cy - half < vp.height
    }

    it('flies up and to the left: both offsets are negative', () => {
        const exit = peekExit({ x: 500, y: 300 })
        expect(exit.x).toBeLessThan(0)
        expect(exit.y).toBeLessThan(0)
    })

    it('ends past both the left and the top edge, for any anchor a peek can have', () => {
        // A peek needs a cover with room above it (pickPeekTarget): top >= PEEK_SIZE_PX.
        for (const x of [0, 40, 320, 999, 1400]) {
            for (const y of [PEEK_SIZE_PX, 120, 400, 790]) {
                expect(endsOffScreen({ x, y }), `anchor ${x},${y}`).toBe(true)
            }
        }
    })

    it('is measured from the anchor, so the same offset lands off screen on a phone', () => {
        expect(endsOffScreen({ x: 195, y: 260 }, { width: 390, height: 844 })).toBe(true)
    })

    it('takes off after the puff: the scroll listener is released at the launch, half way', () => {
        expect(PEEK_LAUNCH_FRACTION).toBe(0.5)
    })
})

