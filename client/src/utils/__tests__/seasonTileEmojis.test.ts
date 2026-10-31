import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
    ATTR_CORNER,
    ATTR_EMOJI,
    TILE_CAP_MAX,
    TILE_CORNERS,
    TILE_DELAY_MAX_MS,
    TILE_DELAY_MIN_MS,
    TILE_EMOJIS,
    addOneTile,
    clearTiles,
    mostlyInView,
    nextTileDelayMs,
    pickTileCorner,
    pickTileEmoji,
    pickTileTarget,
    tileCap,
} from '@/utils/seasonTileEmojis'

const MIDDLE = () => 0.5

/** Deterministic but well spread (mulberry32), so the spread checks are real. */
function sequence(seed: number): () => number {
    let s = seed >>> 0
    return () => {
        s = (s + 0x6d2b79f5) | 0
        let t = Math.imul(s ^ (s >>> 15), 1 | s)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

describe('tileCap: how many emoji may be on the page', () => {
    it('is three in four of the visible covers, rounded up', () => {
        expect(tileCap(0)).toBe(0)
        expect(tileCap(1)).toBe(1)
        expect(tileCap(4)).toBe(3)
        expect(tileCap(5)).toBe(4)
        expect(tileCap(10)).toBe(8)
    })

    it('never goes past the maximum, however many covers are visible', () => {
        expect(TILE_CAP_MAX).toBe(16)
        expect(tileCap(20)).toBe(15)
        expect(tileCap(21)).toBe(16)
        expect(tileCap(1000)).toBe(16)
    })

    it('does not shrink as more covers come into view', () => {
        let last = 0
        for (let n = 0; n <= 100; n++) {
            const cap = tileCap(n)
            expect(cap).toBeGreaterThanOrEqual(last)
            last = cap
        }
    })
})

describe('nextTileDelayMs: one emoji every few seconds', () => {
    it('is random between 2 s and 6 s', () => {
        expect(TILE_DELAY_MIN_MS).toBe(2000)
        expect(TILE_DELAY_MAX_MS).toBe(6000)
        expect(nextTileDelayMs(() => 0)).toBe(2000)
        expect(nextTileDelayMs(() => 0.5)).toBe(4000)
        expect(nextTileDelayMs(() => 0.999999)).toBeLessThan(6000)
        for (let seed = 1; seed <= 20; seed++) {
            const d = nextTileDelayMs(sequence(seed))
            expect(d).toBeGreaterThanOrEqual(2000)
            expect(d).toBeLessThan(6000)
        }
    })
})

describe('pickTileTarget: only a card without an emoji', () => {
    it('never picks a card that already has one', () => {
        const cards = [
            { id: 'a', hasEmoji: true },
            { id: 'b', hasEmoji: false },
            { id: 'c', hasEmoji: true },
        ]
        for (let seed = 1; seed <= 10; seed++) {
            expect(pickTileTarget(cards, sequence(seed))?.id).toBe('b')
        }
    })

    it('returns null when every card has one, or there are none', () => {
        expect(pickTileTarget([{ hasEmoji: true }], MIDDLE)).toBeNull()
        expect(pickTileTarget([], MIDDLE)).toBeNull()
    })

    it('spreads the picks over the free cards', () => {
        const cards = [1, 2, 3, 4].map((id) => ({ id, hasEmoji: false }))
        const picked = new Set<number>()
        for (let seed = 1; seed <= 60; seed++) picked.add(pickTileTarget(cards, sequence(seed))!.id)
        expect(picked).toEqual(new Set([1, 2, 3, 4]))
    })
})

describe('pickTileEmoji: a themed emoji, not the neighbours\' one', () => {
    it('only ever returns an emoji from the list', () => {
        expect(TILE_EMOJIS).toHaveLength(6)
        for (let seed = 1; seed <= 30; seed++) {
            expect(TILE_EMOJIS).toContain(pickTileEmoji([], sequence(seed)))
        }
    })

    it('avoids the emoji of the neighbours', () => {
        const avoid = [TILE_EMOJIS[0], TILE_EMOJIS[3]]
        for (let seed = 1; seed <= 40; seed++) {
            const e = pickTileEmoji(avoid, sequence(seed))
            expect(avoid).not.toContain(e)
        }
    })

    it('falls back to any emoji when the neighbours cover them all', () => {
        expect(TILE_EMOJIS).toContain(pickTileEmoji([...TILE_EMOJIS], MIDDLE))
    })
})

describe('pickTileCorner: the left corners only', () => {
    it('is top-left or bottom-left, never the stamp or the play button corners', () => {
        expect(TILE_CORNERS).toEqual(['tl', 'bl'])
        const seen = new Set<string>()
        for (let seed = 1; seed <= 30; seed++) seen.add(pickTileCorner(sequence(seed)))
        expect(seen).toEqual(new Set(['tl', 'bl']))
    })
})

describe('mostlyInView', () => {
    const vp = { width: 1000, height: 800 }
    const rect = (top: number, left: number, width: number, height: number) => ({
        top,
        left,
        width,
        height,
        bottom: top + height,
        right: left + width,
    })

    it('accepts a rect entirely inside the viewport', () => {
        expect(mostlyInView(rect(10, 10, 100, 100), vp)).toBe(true)
    })

    it('accepts a rect with at least half of it inside', () => {
        expect(mostlyInView(rect(-1, 10, 100, 100), vp)).toBe(true)
        expect(mostlyInView(rect(750, 10, 100, 100), vp)).toBe(true)
        expect(mostlyInView(rect(-50, 10, 100, 100), vp)).toBe(true)
    })

    it('rejects a rect mostly outside an edge', () => {
        expect(mostlyInView(rect(760, 10, 100, 100), vp)).toBe(false)
        expect(mostlyInView(rect(10, 960, 100, 100), vp)).toBe(false)
        expect(mostlyInView(rect(-60, 10, 100, 100), vp)).toBe(false)
    })

    it('rejects an empty rect (jsdom and display: none measure zero)', () => {
        expect(mostlyInView(rect(10, 10, 0, 0), vp)).toBe(false)
    })
})

describe('the DOM part on a page of covers', () => {
    let page: HTMLDivElement
    const vp = { width: 1000, height: 800 }

    /** A cover with a fixed rect; `inside` puts it in the viewport, otherwise it sticks out. */
    function cover(inside: boolean): HTMLElement {
        const el = document.createElement('div')
        el.className = 'card-art'
        const top = inside ? 10 : 790
        el.getBoundingClientRect = () =>
            ({ top, left: 10, width: 100, height: 100, bottom: top + 100, right: 110 }) as DOMRect
        page.appendChild(el)
        return el
    }

    beforeEach(() => {
        page = document.createElement('div')
        document.body.appendChild(page)
    })

    afterEach(() => {
        page.remove()
    })

    it('adds an emoji and a corner to a visible cover without one', () => {
        // Five visible covers: the cap is 4 (three in four, rounded up).
        const covers = [1, 2, 3, 4, 5].map(() => cover(true))
        const done = addOneTile(page, MIDDLE, vp)
        expect(covers).toContain(done)
        expect(TILE_EMOJIS).toContain(done!.getAttribute(ATTR_EMOJI))
        expect(['tl', 'bl']).toContain(done!.getAttribute(ATTR_CORNER))
    })

    it('lets a single visible cover carry one', () => {
        cover(true)
        expect(addOneTile(page, MIDDLE, vp)).not.toBeNull()
        expect(addOneTile(page, MIDDLE, vp)).toBeNull()
    })

    it('leaves covers outside the viewport alone', () => {
        cover(false)
        expect(addOneTile(page, MIDDLE, vp)).toBeNull()
        expect(page.querySelector(`[${ATTR_EMOJI}]`)).toBeNull()
    })

    it('stops at the cap: 4 visible covers allow 3 emoji', () => {
        for (let i = 0; i < 4; i++) cover(true)
        for (let i = 0; i < 3; i++) expect(addOneTile(page, MIDDLE, vp)).not.toBeNull()
        expect(addOneTile(page, MIDDLE, vp)).toBeNull()
        expect(page.querySelectorAll(`[${ATTR_EMOJI}]`)).toHaveLength(3)
    })

    it('clearTiles removes every emoji and corner, and nothing else', () => {
        const a = cover(true)
        const b = cover(true)
        b.setAttribute('data-other', 'keep')
        a.setAttribute(ATTR_EMOJI, '🦇')
        a.setAttribute(ATTR_CORNER, 'tl')
        b.setAttribute(ATTR_EMOJI, '👻')
        b.setAttribute(ATTR_CORNER, 'bl')

        clearTiles(page)

        expect(a.hasAttribute(ATTR_EMOJI)).toBe(false)
        expect(a.hasAttribute(ATTR_CORNER)).toBe(false)
        expect(b.hasAttribute(ATTR_EMOJI)).toBe(false)
        expect(b.getAttribute('data-other')).toBe('keep')
    })

    it('after a clear the count starts again from zero', () => {
        for (let i = 0; i < 5; i++) cover(true)
        addOneTile(page, MIDDLE, vp)
        addOneTile(page, MIDDLE, vp)
        clearTiles(page)
        expect(addOneTile(page, MIDDLE, vp)).not.toBeNull()
        expect(page.querySelectorAll(`[${ATTR_EMOJI}]`)).toHaveLength(1)
    })
})
