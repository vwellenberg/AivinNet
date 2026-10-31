import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
    ATTR_EMOJI,
    ATTR_X,
    COVER_SELECTOR,
    TILE_CAP_MAX,
    TILE_DELAY_MAX_MS,
    TILE_DELAY_MIN_MS,
    TILE_EMOJI_WEIGHTS,
    TILE_EMOJIS,
    TILE_GLYPH_PX,
    TILE_MIN_FREE_PCT,
    TILE_X_MAX,
    TILE_X_MIN,
    TILE_X_ROUND_MAX,
    TILE_X_ROUND_MIN,
    addOneTile,
    clearTiles,
    freeSpans,
    glyphRoom,
    layoutTiles,
    mostlyInView,
    nextTileDelayMs,
    pickTileEmoji,
    pickTileTarget,
    pickTileX,
    tileAnchor,
    tileCap,
    type TileBounds,
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

const VP = { width: 1000, height: 800 }
/** The content starts at the top of the viewport, the bar at the bottom: no edge is cut. */
const BOUNDS: TileBounds = { contentTop: 0, barTop: 800 }

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

// Zombies and bats are crossers (utils/seasonParticles.ts). Standing still on a
// tile they looked like a crossing that got stuck ("bitte keine fledermäuse und
// zombies auf den kacheln", user, 2026-10-31).
describe('tile emoji: nothing that belongs to the crossings', () => {
    it('never stands a zombie or a bat on a tile', () => {
        const banned = ['🧟', '🧟‍♂️', '🧟‍♀️', '🦇']
        for (const emoji of banned) expect(TILE_EMOJIS, emoji).not.toContain(emoji)
        for (let seed = 1; seed <= 200; seed++) expect(banned).not.toContain(pickTileEmoji([], sequence(seed)))
    })
})

describe("pickTileEmoji: a themed emoji, not the neighbours' one", () => {
    it('only ever returns an emoji from the list', () => {
        expect(TILE_EMOJIS).toHaveLength(6)
        expect(TILE_EMOJIS).toContain('🪦')
        expect(TILE_EMOJIS).toContain('🎃')
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

describe('pickTileEmoji: graves and pumpkins come up most often', () => {
    /** How often each emoji is picked over many seeds, with nothing to avoid. */
    function tally(seeds = 4000): Record<string, number> {
        const counts: Record<string, number> = {}
        for (let seed = 1; seed <= seeds; seed++) {
            const e = pickTileEmoji([], sequence(seed))
            counts[e] = (counts[e] ?? 0) + 1
        }
        return counts
    }

    it('gives the grave and the pumpkin the largest weight, and the others less', () => {
        const weight = (emoji: string) => TILE_EMOJI_WEIGHTS.find((e) => e.emoji === emoji)?.weight ?? 0
        expect(weight('🪦')).toBeGreaterThan(weight('🦇'))
        expect(weight('🎃')).toBeGreaterThan(weight('👻'))
        expect(weight('🪦')).toBe(weight('🎃'))
        expect(weight('🪦')).toBeGreaterThan(0)
    })

    it('shows a grave or a pumpkin about as often as their weights say, and well over a third of the time', () => {
        const counts = tally()
        const total = Object.values(counts).reduce((a, b) => a + b, 0)
        const graves = (counts['🪦'] ?? 0) + (counts['🎃'] ?? 0)
        const weightSum = TILE_EMOJI_WEIGHTS.reduce((a, e) => a + e.weight, 0)
        const expected = (3 + 3) / weightSum
        expect(graves / total).toBeGreaterThan(0.35)
        expect(Math.abs(graves / total - expected)).toBeLessThan(0.03)
    })

    it('still picks every emoji now and then', () => {
        const counts = tally()
        for (const e of TILE_EMOJIS) expect(counts[e] ?? 0, e).toBeGreaterThan(0)
    })

    it("leaves out the neighbours' emoji, weights and all", () => {
        for (let seed = 1; seed <= 300; seed++) {
            expect(pickTileEmoji(['🪦', '🎃'], sequence(seed))).not.toBe('🪦')
            expect(pickTileEmoji(['🪦', '🎃'], sequence(seed))).not.toBe('🎃')
        }
    })
})

describe('COVER_SELECTOR: every cover tile kind, Home included', () => {
    it('covers the shared card artwork and the Home continue card cover', () => {
        expect(COVER_SELECTOR).toContain('.card-art')
        expect(COVER_SELECTOR).toContain('.continue-card .cover')
    })

    it('never names the stamp or the play button, which own the other corners', () => {
        expect(COVER_SELECTOR).not.toMatch(/stamp|play/i)
    })
})

describe('freeSpans: the part of the top edge a glyph may use', () => {
    it('is the whole range with nothing blocked', () => {
        expect(freeSpans(15, 85, [])).toEqual([[15, 85]])
    })

    it('cuts out a blocked span, and keeps the two sides', () => {
        expect(freeSpans(15, 85, [[30, 50]])).toEqual([
            [15, 30],
            [50, 85],
        ])
    })

    it('handles spans that overlap, touch the range edge, or stick out of it', () => {
        expect(freeSpans(15, 85, [[0, 40], [35, 60]])).toEqual([[60, 85]])
        expect(freeSpans(15, 85, [[80, 200]])).toEqual([[15, 80]])
        expect(freeSpans(15, 85, [[-5, 20]])).toEqual([[20, 85]])
    })

    it('is empty when everything is blocked', () => {
        expect(freeSpans(15, 85, [[0, 100]])).toEqual([])
    })
})

describe('pickTileX: a spot on the top edge, away from the label', () => {
    it('stays inside the range for any seed', () => {
        for (let seed = 1; seed <= 200; seed++) {
            const x = pickTileX(sequence(seed))!
            expect(x).toBeGreaterThanOrEqual(TILE_X_MIN)
            expect(x).toBeLessThanOrEqual(TILE_X_MAX)
        }
    })

    it('spreads the spots, so covers look different', () => {
        const spots = new Set<number>()
        for (let seed = 1; seed <= 60; seed++) spots.add(Math.round(pickTileX(sequence(seed))!))
        expect(spots.size).toBeGreaterThan(20)
    })

    it('never lands on a blocked span', () => {
        for (let seed = 1; seed <= 200; seed++) {
            const x = pickTileX(sequence(seed), [[10, 62]])!
            expect(x).toBeGreaterThanOrEqual(62)
        }
    })

    it('returns null when the free part is too small for a glyph', () => {
        expect(pickTileX(MIDDLE, [[0, 100]])).toBeNull()
        expect(pickTileX(MIDDLE, [[TILE_X_MIN, TILE_X_MAX - TILE_MIN_FREE_PCT + 1]])).toBeNull()
    })

    it('keeps a round cover at its top centre, where the edge does not curve away', () => {
        for (let seed = 1; seed <= 100; seed++) {
            const x = pickTileX(sequence(seed), [], [TILE_X_ROUND_MIN, TILE_X_ROUND_MAX])!
            expect(x).toBeGreaterThanOrEqual(TILE_X_ROUND_MIN)
            expect(x).toBeLessThanOrEqual(TILE_X_ROUND_MAX)
        }
    })
})

describe('glyphRoom: the glyph stands inside the content, above the bar', () => {
    const rect = (top: number) => ({ top, width: 100, height: 100 })

    it('accepts a cover whose glyph band fits under the content top and whose edge is above the bar', () => {
        expect(glyphRoom(rect(TILE_GLYPH_PX + 10), BOUNDS)).toBe(true)
    })

    it('rejects a cover whose glyph would go up over the top nav', () => {
        expect(glyphRoom(rect(TILE_GLYPH_PX - 5), BOUNDS)).toBe(false)
        expect(glyphRoom(rect(TILE_GLYPH_PX + 20), { contentTop: 60, barTop: 800 })).toBe(false)
    })

    it('rejects a cover whose top edge is under the player bar', () => {
        expect(glyphRoom(rect(801), BOUNDS)).toBe(false)
    })

    it('rejects an empty rect', () => {
        expect(glyphRoom({ top: 100, width: 0, height: 0 }, BOUNDS)).toBe(false)
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

describe('tileAnchor: the glyph stands on the top edge, at its x', () => {
    it('is the top edge at the x of the cover width', () => {
        expect(tileAnchor({ top: 200, left: 100, width: 150 }, 50)).toEqual({ x: 175, y: 200 })
        expect(tileAnchor({ top: 200, left: 100, width: 150 }, 0)).toEqual({ x: 100, y: 200 })
    })
})

describe('the DOM part on a page of covers', () => {
    let page: HTMLDivElement

    /**
     * A cover in its own card, as the lists build them: the card is the cover's
     * parent, which is where the label and the stamp sit. `top` puts the edge
     * inside the content; a top of 790 is past the bottom of the viewport.
     */
    function cover(opts: { top?: number; round?: boolean } = {}): HTMLElement {
        const top = opts.top ?? 60
        const card = document.createElement('div')
        const el = document.createElement('div')
        el.className = opts.round ? 'card-art is-round' : 'card-art'
        el.getBoundingClientRect = () => ({ top, left: 10, width: 100, height: 100, bottom: top + 100, right: 110 }) as DOMRect
        card.appendChild(el)
        page.appendChild(card)
        return el
    }

    beforeEach(() => {
        page = document.createElement('div')
        document.body.appendChild(page)
    })

    afterEach(() => {
        page.remove()
    })

    it('adds an emoji and a spot on the top edge to a visible cover without one', () => {
        const covers = [1, 2, 3, 4, 5].map(() => cover())
        const done = addOneTile(page, MIDDLE, VP, BOUNDS)
        expect(covers).toContain(done)
        expect(TILE_EMOJIS).toContain(done!.getAttribute(ATTR_EMOJI))
        const x = Number(done!.getAttribute(ATTR_X))
        expect(x).toBeGreaterThanOrEqual(TILE_X_MIN)
        expect(x).toBeLessThanOrEqual(TILE_X_MAX)
    })

    it('lets a single visible cover carry one', () => {
        cover()
        expect(addOneTile(page, MIDDLE, VP, BOUNDS)).not.toBeNull()
        expect(addOneTile(page, MIDDLE, VP, BOUNDS)).toBeNull()
    })

    it('leaves covers outside the viewport alone', () => {
        cover({ top: 790 })
        expect(addOneTile(page, MIDDLE, VP, BOUNDS)).toBeNull()
        expect(page.querySelector(`[${ATTR_EMOJI}]`)).toBeNull()
    })

    it('leaves a cover alone when its glyph would go over the top nav', () => {
        cover({ top: 10 })
        expect(addOneTile(page, MIDDLE, VP, { contentTop: 0, barTop: 800 })).toBeNull()
    })

    it('stops at the cap: 4 visible covers allow 3 emoji', () => {
        for (let i = 0; i < 4; i++) cover()
        for (let i = 0; i < 3; i++) expect(addOneTile(page, MIDDLE, VP, BOUNDS)).not.toBeNull()
        expect(addOneTile(page, MIDDLE, VP, BOUNDS)).toBeNull()
        expect(page.querySelectorAll(`[${ATTR_EMOJI}]`)).toHaveLength(3)
    })

    it("keeps a round cover's glyph at its top centre", () => {
        const round = cover({ round: true })
        for (let seed = 1; seed <= 20; seed++) {
            round.removeAttribute(ATTR_EMOJI)
            round.removeAttribute(ATTR_X)
            addOneTile(page, sequence(seed), VP, BOUNDS)
            const x = Number(round.getAttribute(ATTR_X))
            expect(x).toBeGreaterThanOrEqual(TILE_X_ROUND_MIN)
            expect(x).toBeLessThanOrEqual(TILE_X_ROUND_MAX)
        }
    })

    it('puts the glyph away from the type label above the cover', () => {
        // The label covers the left 60 % of the cover's width, just above its edge.
        const el = cover()
        const label = document.createElement('div')
        label.className = 'card-type-label'
        label.getBoundingClientRect = () => ({ top: 45, bottom: 58, left: 10, right: 70, width: 60, height: 13 }) as DOMRect
        el.parentElement!.insertBefore(label, el)
        const done = addOneTile(page, MIDDLE, VP, BOUNDS)
        expect(done).toBe(el)
        expect(Number(el.getAttribute(ATTR_X))).toBeGreaterThanOrEqual(62)
    })

    it('clearTiles removes every emoji, its spot and the drawing, and nothing else', () => {
        const a = cover()
        const b = cover()
        b.setAttribute('data-other', 'keep')
        a.setAttribute(ATTR_EMOJI, '🦇')
        a.setAttribute(ATTR_X, '40')
        b.setAttribute(ATTR_EMOJI, '👻')
        b.setAttribute(ATTR_X, '60')
        const layer = document.createElement('div')
        layer.innerHTML = '<span>🦇</span>'

        clearTiles(page, layer)

        expect(a.hasAttribute(ATTR_EMOJI)).toBe(false)
        expect(a.hasAttribute(ATTR_X)).toBe(false)
        expect(b.hasAttribute(ATTR_EMOJI)).toBe(false)
        expect(b.getAttribute('data-other')).toBe('keep')
        expect(layer.children).toHaveLength(0)
    })

    it('after a clear the count starts again from zero', () => {
        for (let i = 0; i < 5; i++) cover()
        addOneTile(page, MIDDLE, VP, BOUNDS)
        addOneTile(page, MIDDLE, VP, BOUNDS)
        clearTiles(page)
        expect(addOneTile(page, MIDDLE, VP, BOUNDS)).not.toBeNull()
        expect(page.querySelectorAll(`[${ATTR_EMOJI}]`)).toHaveLength(1)
    })
})

describe('layoutTiles: one glyph per tagged cover, on its top edge, in the layer', () => {
    let page: HTMLDivElement
    let layer: HTMLDivElement

    function cover(top: number, left: number): HTMLElement {
        const el = document.createElement('div')
        el.className = 'card-art'
        el.getBoundingClientRect = () => ({ top, left, width: 100, height: 100, bottom: top + 100, right: left + 100 }) as DOMRect
        page.appendChild(el)
        return el
    }

    beforeEach(() => {
        page = document.createElement('div')
        layer = document.createElement('div')
        document.body.append(page, layer)
    })

    afterEach(() => {
        page.remove()
        layer.remove()
    })

    it('draws a span with the emoji, placed on the top edge at the spot', () => {
        const el = cover(200, 40)
        el.setAttribute(ATTR_EMOJI, '🎃')
        el.setAttribute(ATTR_X, '25')
        layoutTiles(page, layer)
        expect(layer.children).toHaveLength(1)
        const glyph = layer.children[0] as HTMLElement
        expect(glyph.textContent).toBe('🎃')
        expect(glyph.className).toBe('season-tile-emoji')
        expect(glyph.getAttribute('aria-hidden')).toBe('true')
        expect(glyph.style.left).toBe('65px')
        expect(glyph.style.top).toBe('200px')
    })

    it('does not draw a cover without an emoji, and removes a glyph whose cover lost its tag', () => {
        const a = cover(200, 40)
        const b = cover(200, 300)
        a.setAttribute(ATTR_EMOJI, '🦇')
        a.setAttribute(ATTR_X, '50')
        b.setAttribute(ATTR_EMOJI, '👻')
        b.setAttribute(ATTR_X, '50')
        layoutTiles(page, layer)
        expect(layer.children).toHaveLength(2)

        b.removeAttribute(ATTR_EMOJI)
        layoutTiles(page, layer)
        expect(layer.children).toHaveLength(1)
        expect(layer.children[0].textContent).toBe('🦇')
    })

    it('brings a glyph back when its cover is tagged again', () => {
        const a = cover(200, 40)
        a.setAttribute(ATTR_EMOJI, '🦇')
        a.setAttribute(ATTR_X, '50')
        layoutTiles(page, layer)
        clearTiles(page, layer)
        expect(layer.children).toHaveLength(0)
        a.setAttribute(ATTR_EMOJI, '🦇')
        a.setAttribute(ATTR_X, '50')
        layoutTiles(page, layer)
        expect(layer.children).toHaveLength(1)
    })

    it('follows a cover when the layout moves it', () => {
        let top = 200
        const el = document.createElement('div')
        el.className = 'card-art'
        el.getBoundingClientRect = () => ({ top, left: 0, width: 100, height: 100, bottom: top + 100, right: 100 }) as DOMRect
        page.appendChild(el)
        el.setAttribute(ATTR_EMOJI, '💀')
        el.setAttribute(ATTR_X, '50')
        layoutTiles(page, layer)
        top = 260
        layoutTiles(page, layer)
        expect((layer.children[0] as HTMLElement).style.top).toBe('260px')
    })
})
