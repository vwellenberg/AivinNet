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
    TILE_PER_COVER_MAX,
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
    readTiles,
    tileAnchor,
    tileCap,
    tileEmojiWeightsFor,
    tileHalfPct,
    writeTiles,
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

/** Emoji that must never stand on a tile: the ghost, the cobweb, the spider, the zombies and the bat. */
const BANNED = ['👻', '\u{1F578}️', '\u{1F577}️', '🧟', '🧟‍♂️', '🧟‍♀️', '🦇']

describe('tileCap: how many glyphs may be on the page', () => {
    it('is one and a half glyphs per visible cover, rounded up', () => {
        expect(tileCap(0)).toBe(0)
        expect(tileCap(1)).toBe(2)
        expect(tileCap(2)).toBe(3)
        expect(tileCap(4)).toBe(6)
        expect(tileCap(5)).toBe(8)
        expect(tileCap(10)).toBe(15)
    })

    it('never goes past the maximum, however many covers are visible', () => {
        expect(TILE_CAP_MAX).toBe(24)
        expect(tileCap(16)).toBe(24)
        expect(tileCap(17)).toBe(24)
        expect(tileCap(1000)).toBe(24)
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

describe('tileEmojiWeightsFor: each season has its own weighted set', () => {
    it('keeps Halloween: graves and pumpkins most often, then the rest of the set', () => {
        const halloween = tileEmojiWeightsFor('halloween')
        expect(halloween).toBe(TILE_EMOJI_WEIGHTS)
        expect(halloween.map((e) => e.emoji)).toEqual(TILE_EMOJIS)
        expect(halloween.find((e) => e.emoji === '🪦')?.weight).toBe(3)
        expect(halloween.find((e) => e.emoji === '🎃')?.weight).toBe(3)
    })

    it('gives the Halloween set nine emoji, the rest each with weight 1', () => {
        expect(TILE_EMOJIS).toHaveLength(9)
        expect(TILE_EMOJIS).toEqual([
            '🪦',
            '🎃',
            '💀',
            '\u{1F56F}️',
            '🍬',
            '⚰️',
            '🦴',
            '\u{1F408}‍⬛',
            '🔮',
        ])
        const rest = TILE_EMOJI_WEIGHTS.filter((e) => e.emoji !== '🪦' && e.emoji !== '🎃')
        expect(rest).toHaveLength(7)
        expect(rest.every((e) => e.weight === 1)).toBe(true)
    })

    it('gives Christmas presents, cookies, stars, the tree and the snowman, and a little snow', () => {
        const emojis = tileEmojiWeightsFor('christmas').map((e) => e.emoji)
        expect(emojis).toEqual(
            expect.arrayContaining(['🎁', '🍪', '⭐', '🎄', '⛄', '❄️', '\u{1F328}️'])
        )
        // None of the Halloween ones.
        for (const halloween of TILE_EMOJIS) expect(emojis).not.toContain(halloween)
    })

    it('weights the Christmas presents and cookies most, the snow least', () => {
        const weight = (emoji: string) => tileEmojiWeightsFor('christmas').find((e) => e.emoji === emoji)!.weight
        expect(weight('🎁')).toBe(3)
        expect(weight('🍪')).toBe(3)
        expect(weight('❄️')).toBe(1)
        expect(weight('\u{1F328}️')).toBe(1)
    })

    it('draws a Christmas tile only from the Christmas set', () => {
        const christmas = tileEmojiWeightsFor('christmas')
        const picked = new Set<string>()
        for (let seed = 1; seed <= 200; seed++) picked.add(pickTileEmoji([], sequence(seed), christmas))
        expect(picked).toEqual(new Set(christmas.map((e) => e.emoji)))
    })

    it("still avoids the neighbour's emoji with a Christmas set", () => {
        const christmas = tileEmojiWeightsFor('christmas')
        for (let seed = 1; seed <= 40; seed++) {
            expect(pickTileEmoji(['🎁'], sequence(seed), christmas)).not.toBe('🎁')
        }
    })
})

describe('nextTileDelayMs: irregular, 1.2 s to 7 s', () => {
    it('is random between 1.2 s and 7 s', () => {
        expect(TILE_DELAY_MIN_MS).toBe(1200)
        expect(TILE_DELAY_MAX_MS).toBe(7000)
        expect(nextTileDelayMs(() => 0)).toBe(1200)
        expect(nextTileDelayMs(() => 0.5)).toBe(4100)
        expect(nextTileDelayMs(() => 0.999999)).toBeLessThan(7000)
        for (let seed = 1; seed <= 20; seed++) {
            const d = nextTileDelayMs(sequence(seed))
            expect(d).toBeGreaterThanOrEqual(1200)
            expect(d).toBeLessThan(7000)
        }
    })
})

describe('pickTileTarget: only a cover that is not full', () => {
    it('never picks a cover flagged full', () => {
        const covers = [
            { id: 'a', full: true },
            { id: 'b', full: false },
            { id: 'c', full: true },
        ]
        for (let seed = 1; seed <= 10; seed++) {
            expect(pickTileTarget(covers, sequence(seed))?.id).toBe('b')
        }
    })

    it('returns null when every cover is full, or there are none', () => {
        expect(pickTileTarget([{ full: true }], MIDDLE)).toBeNull()
        expect(pickTileTarget([], MIDDLE)).toBeNull()
    })

    it('spreads the picks over the free covers', () => {
        const covers = [1, 2, 3, 4].map((id) => ({ id, full: false }))
        const picked = new Set<number>()
        for (let seed = 1; seed <= 60; seed++) picked.add(pickTileTarget(covers, sequence(seed))!.id)
        expect(picked).toEqual(new Set([1, 2, 3, 4]))
    })
})

// Zombies and bats are crossers (utils/seasonParticles.ts). Standing still on a
// tile they looked like a crossing that got stuck ("bitte keine fledermäuse und
// zombies auf den kacheln", user, 2026-10-31). The ghost, the cobweb and the
// spider stay in the sky too ("bitte keine gespenster, spinnenweben, spinnen auf
// den kacheln", user, 2026-10-31).
describe('tile emoji: nothing that belongs to the crossings or the sky', () => {
    it('never has a zombie, a bat, a ghost, a cobweb or a spider in the set', () => {
        for (const emoji of BANNED) expect(TILE_EMOJIS, emoji).not.toContain(emoji)
    })

    it('never picks one of them, for many seeds', () => {
        for (let seed = 1; seed <= 300; seed++) {
            expect(BANNED).not.toContain(pickTileEmoji([], sequence(seed)))
        }
    })
})

describe("pickTileEmoji: a themed emoji, not the neighbours' one", () => {
    it('only ever returns an emoji from the list', () => {
        expect(TILE_EMOJIS).toContain('🪦')
        expect(TILE_EMOJIS).toContain('🎃')
        for (let seed = 1; seed <= 30; seed++) {
            expect(TILE_EMOJIS).toContain(pickTileEmoji([], sequence(seed)))
        }
    })

    it('avoids the emoji of the neighbours', () => {
        const avoid = [TILE_EMOJIS[0], TILE_EMOJIS[1]]
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

    it('gives the grave and the pumpkin the largest weight, and the rest less', () => {
        const weight = (emoji: string) => TILE_EMOJI_WEIGHTS.find((e) => e.emoji === emoji)?.weight ?? 0
        expect(weight('🪦')).toBeGreaterThan(weight('💀'))
        expect(weight('🎃')).toBeGreaterThan(weight('🔮'))
        expect(weight('🪦')).toBe(weight('🎃'))
        expect(weight('🪦')).toBeGreaterThan(0)
    })

    it('shows a grave or a pumpkin about as often as their weights say, and half the time', () => {
        const counts = tally()
        const total = Object.values(counts).reduce((a, b) => a + b, 0)
        const graves = (counts['🪦'] ?? 0) + (counts['🎃'] ?? 0)
        const weightSum = TILE_EMOJI_WEIGHTS.reduce((a, e) => a + e.weight, 0)
        const expected = (3 + 3) / weightSum
        expect(graves / total).toBeGreaterThan(0.45)
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

describe('tileHalfPct: the room one glyph takes on each side of its centre', () => {
    it('is half the glyph width and a 3 px gap, in % of the cover width', () => {
        expect(tileHalfPct(100)).toBe(17)
        expect(tileHalfPct(200)).toBe(8.5)
    })
})

describe('readTiles / writeTiles: several glyphs per cover, in two attributes', () => {
    it('reads the emoji and the x lists, paired by position', () => {
        const el = document.createElement('div')
        el.setAttribute(ATTR_EMOJI, '🪦 🎃')
        el.setAttribute(ATTR_X, '22.5 61')
        expect(readTiles(el)).toEqual([
            { emoji: '🪦', x: 22.5 },
            { emoji: '🎃', x: 61 },
        ])
    })

    it('reads nothing from a cover without the attributes', () => {
        expect(readTiles(document.createElement('div'))).toEqual([])
    })

    it('drops a glyph whose x is not a number', () => {
        const el = document.createElement('div')
        el.setAttribute(ATTR_EMOJI, '🪦 🎃')
        el.setAttribute(ATTR_X, 'nope 3')
        expect(readTiles(el)).toEqual([{ emoji: '🎃', x: 3 }])
    })

    it('writes the two attributes, and removes both for no glyphs', () => {
        const el = document.createElement('div')
        writeTiles(el, [
            { emoji: '🪦', x: 22.5 },
            { emoji: '🎃', x: 61 },
        ])
        expect(el.getAttribute(ATTR_EMOJI)).toBe('🪦 🎃')
        expect(el.getAttribute(ATTR_X)).toBe('22.5 61')
        writeTiles(el, [])
        expect(el.hasAttribute(ATTR_EMOJI)).toBe(false)
        expect(el.hasAttribute(ATTR_X)).toBe(false)
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
     * inside the content; a top of 790 is past the bottom of the viewport. The
     * default width is 100 px; a cover that must carry two or three glyphs needs
     * 200 px, since each glyph takes a full glyph width along the edge.
     */
    function cover(opts: { top?: number; round?: boolean; width?: number } = {}): HTMLElement {
        const top = opts.top ?? 60
        const width = opts.width ?? 100
        const card = document.createElement('div')
        const el = document.createElement('div')
        el.className = opts.round ? 'card-art is-round' : 'card-art'
        el.getBoundingClientRect = () => ({ top, left: 10, width, height: 100, bottom: top + 100, right: 10 + width }) as DOMRect
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
        expect(TILE_EMOJIS).toContain(readTiles(done!)[0].emoji)
        const x = readTiles(done!)[0].x
        expect(x).toBeGreaterThanOrEqual(TILE_X_MIN)
        expect(x).toBeLessThanOrEqual(TILE_X_MAX)
    })

    it('lets a single visible cover carry two, the cap for one cover', () => {
        const only = cover({ width: 200 })
        expect(addOneTile(page, MIDDLE, VP, BOUNDS)).toBe(only)
        expect(addOneTile(page, MIDDLE, VP, BOUNDS)).toBe(only)
        expect(readTiles(only)).toHaveLength(2)
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

    it('stops at the cap: 4 visible covers allow 6 glyphs, and no cover carries a fourth', () => {
        for (let i = 0; i < 4; i++) cover({ width: 200 })
        for (let i = 0; i < 6; i++) expect(addOneTile(page, MIDDLE, VP, BOUNDS)).not.toBeNull()
        expect(addOneTile(page, MIDDLE, VP, BOUNDS)).toBeNull()
        const all = Array.from(page.querySelectorAll<HTMLElement>(`[${ATTR_EMOJI}]`))
        expect(all.reduce((n, el) => n + readTiles(el).length, 0)).toBe(6)
        for (const el of all) expect(readTiles(el).length).toBeLessThanOrEqual(TILE_PER_COVER_MAX)
    })

    it('lets a cover carry up to three side by side, and never a fourth', () => {
        let reachedThree = false
        for (let seed = 1; seed <= 20; seed++) {
            page.innerHTML = ''
            const covers = Array.from({ length: 8 }, () => cover({ width: 200 }))
            for (let i = 0; i < 12; i++) expect(addOneTile(page, sequence(seed * 31 + i), VP, BOUNDS), `seed ${seed}`).not.toBeNull()
            for (const el of covers) {
                const n = readTiles(el).length
                expect(n, `seed ${seed}`).toBeLessThanOrEqual(TILE_PER_COVER_MAX)
                if (n === TILE_PER_COVER_MAX) reachedThree = true
            }
        }
        expect(reachedThree).toBe(true)
    })

    it('puts the glyphs of one cover next to each other, never on top of each other', () => {
        const width = 200
        // Two glyphs: one cover, and the cap for one visible cover is two.
        for (let seed = 1; seed <= 30; seed++) {
            page.innerHTML = ''
            const el = cover({ width })
            expect(addOneTile(page, sequence(seed), VP, BOUNDS)).toBe(el)
            expect(addOneTile(page, sequence(seed + 100), VP, BOUNDS)).toBe(el)
            const [a, b] = readTiles(el)
            expect(Math.abs(a.x - b.x), `seed ${seed}`).toBeGreaterThanOrEqual(2 * tileHalfPct(width) - 0.2)
        }
    })

    it('picks a cover that already has a glyph as readily as one without', () => {
        const withOne = cover({ width: 200 })
        const without = cover({ width: 200 })
        let onWithOne = 0
        let onWithout = 0
        for (let seed = 1; seed <= 40; seed++) {
            writeTiles(withOne, [{ emoji: '🪦', x: 50 }])
            writeTiles(without, [])
            const done = addOneTile(page, sequence(seed), VP, BOUNDS)
            if (done === withOne) onWithOne++
            if (done === without) onWithout++
        }
        expect(onWithOne).toBeGreaterThan(0)
        expect(onWithout).toBeGreaterThan(0)
    })

    it("avoids every emoji of the neighbours and of the cover itself, not just one", () => {
        // DOM order: prev (off screen, with a pumpkin), the target (with a grave), a filler
        // with no room for a glyph. Only the target can take one, and neither the pumpkin
        // nor the grave may be the new one.
        const prev = cover({ top: 790 })
        writeTiles(prev, [{ emoji: '🎃', x: 80 }])
        const target = cover({ width: 200 })
        cover({ top: 10 })
        const picked = new Set<string>()
        for (let seed = 1; seed <= 60; seed++) {
            writeTiles(target, [{ emoji: '🪦', x: 50 }])
            expect(addOneTile(page, sequence(seed), VP, BOUNDS)).toBe(target)
            const tiles = readTiles(target)
            expect(tiles).toHaveLength(2)
            expect(tiles[1].emoji, `seed ${seed}`).not.toBe('🎃')
            expect(tiles[1].emoji, `seed ${seed}`).not.toBe('🪦')
            picked.add(tiles[1].emoji)
        }
        // The rest of the set still comes up: the avoid list is not a ban on everything.
        expect(picked.size).toBeGreaterThan(3)
    })

    it('a glyph on a cover with the label above: the glyph stays away from the label', () => {
        // The label covers the left 60 % of the cover's width, just above its edge.
        const el = cover()
        const label = document.createElement('div')
        label.className = 'card-type-label'
        label.getBoundingClientRect = () => ({ top: 45, bottom: 58, left: 10, right: 70, width: 60, height: 13 }) as DOMRect
        el.parentElement!.insertBefore(label, el)
        const done = addOneTile(page, MIDDLE, VP, BOUNDS)
        expect(done).toBe(el)
        expect(readTiles(el)[0].x).toBeGreaterThanOrEqual(62)
    })

    it('keeps a round cover\'s glyph at its top centre', () => {
        const round = cover({ round: true })
        for (let seed = 1; seed <= 20; seed++) {
            round.removeAttribute(ATTR_EMOJI)
            round.removeAttribute(ATTR_X)
            addOneTile(page, sequence(seed), VP, BOUNDS)
            const x = readTiles(round)[0].x
            expect(x).toBeGreaterThanOrEqual(TILE_X_ROUND_MIN)
            expect(x).toBeLessThanOrEqual(TILE_X_ROUND_MAX)
        }
    })

    it('clearTiles removes every emoji, its spot and the drawing, and nothing else', () => {
        const a = cover()
        const b = cover()
        b.setAttribute('data-other', 'keep')
        a.setAttribute(ATTR_EMOJI, '🪦 🎃')
        a.setAttribute(ATTR_X, '40 70')
        b.setAttribute(ATTR_EMOJI, '💀')
        b.setAttribute(ATTR_X, '60')
        const layer = document.createElement('div')
        layer.innerHTML = '<span>🪦</span>'

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

    it('draws one span per glyph of a cover, side by side on its edge', () => {
        const el = cover(200, 40)
        writeTiles(el, [
            { emoji: '🪦', x: 25 },
            { emoji: '🎃', x: 75 },
        ])
        layoutTiles(page, layer)
        expect(layer.children).toHaveLength(2)
        const [a, b] = Array.from(layer.children) as HTMLElement[]
        expect(a.textContent).toBe('🪦')
        expect(a.style.left).toBe('65px')
        expect(a.style.top).toBe('200px')
        expect(b.textContent).toBe('🎃')
        expect(b.style.left).toBe('115px')
    })

    it('reuses the spans from one layout to the next, and drops the spare ones', () => {
        const el = cover(200, 40)
        writeTiles(el, [
            { emoji: '🪦', x: 25 },
            { emoji: '🎃', x: 75 },
        ])
        layoutTiles(page, layer)
        const before = Array.from(layer.children)
        layoutTiles(page, layer)
        expect(layer.children).toHaveLength(2)
        before.forEach((node, i) => expect(layer.children[i]).toBe(node))

        writeTiles(el, [{ emoji: '🪦', x: 25 }])
        layoutTiles(page, layer)
        expect(layer.children).toHaveLength(1)
        expect(layer.children[0]).toBe(before[0])
    })

    it('does not draw a cover without an emoji, and removes a glyph whose cover lost its tag', () => {
        const a = cover(200, 40)
        const b = cover(200, 300)
        a.setAttribute(ATTR_EMOJI, '🪦')
        a.setAttribute(ATTR_X, '50')
        b.setAttribute(ATTR_EMOJI, '💀')
        b.setAttribute(ATTR_X, '50')
        layoutTiles(page, layer)
        expect(layer.children).toHaveLength(2)

        b.removeAttribute(ATTR_EMOJI)
        layoutTiles(page, layer)
        expect(layer.children).toHaveLength(1)
        expect(layer.children[0].textContent).toBe('🪦')
    })

    it('brings a glyph back when its cover is tagged again', () => {
        const a = cover(200, 40)
        a.setAttribute(ATTR_EMOJI, '🪦')
        a.setAttribute(ATTR_X, '50')
        layoutTiles(page, layer)
        clearTiles(page, layer)
        expect(layer.children).toHaveLength(0)
        a.setAttribute(ATTR_EMOJI, '🪦')
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
