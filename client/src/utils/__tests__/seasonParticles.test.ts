import { describe, expect, it } from 'vitest'

import { CHASE_GROUP, MAX_PARTICLES, SLEIGH_GROUP, SPIDER_GLYPH, crossing, particlesFor } from '@/utils/seasonParticles'

// A fixed random source: every value lands mid-range, so the layout is the same
// on every run. The ranges themselves are checked below with a spread of values.
const MIDDLE = () => 0.5

/** Deterministic but well spread (mulberry32), so the spread checks below are real. */
function sequence(seed: number): () => number {
    let s = seed >>> 0
    return () => {
        s = (s + 0x6d2b79f5) | 0
        let t = Math.imul(s ^ (s >>> 15), 1 | s)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

describe('particlesFor: no season, no particles', () => {
    it('returns nothing when no season is active', () => {
        expect(particlesFor(null, MIDDLE)).toEqual([])
    })
})

describe('particlesFor: the count is capped', () => {
    it('never returns more than MAX_PARTICLES, for any season or random source', () => {
        expect(MAX_PARTICLES).toBe(25)
        for (const season of ['christmas', 'halloween'] as const) {
            for (let seed = 1; seed <= 20; seed++) {
                expect(particlesFor(season, sequence(seed)).length).toBeLessThanOrEqual(MAX_PARTICLES)
            }
        }
    })

    it('a season with a few particles keeps every one of them', () => {
        expect(particlesFor('halloween', MIDDLE)).toHaveLength(8)
        // 18 snowflakes and the one sleigh.
        expect(particlesFor('christmas', MIDDLE)).toHaveLength(19)
    })
})

describe('particlesFor: Christmas is snow, and now and then a sleigh', () => {
    it('makes snowflakes with a few sizes, and one sleigh among them', () => {
        const all = particlesFor('christmas', sequence(7))
        const flakes = all.filter((p) => p.kind === 'flake')
        expect(flakes).toHaveLength(18)
        expect(flakes.every((p) => p.group.length === 0)).toBe(true)
        expect(all.filter((p) => p.kind !== 'flake').map((p) => p.kind)).toEqual(['sleigh'])

        const sizes = new Set(flakes.map((p) => Math.round(p.size)))
        expect(sizes.size).toBeGreaterThan(2)
    })

    it('starts the flakes part-way through their fall, so the screen is not empty at first', () => {
        for (const p of particlesFor('christmas', sequence(3)).filter((p) => p.kind === 'flake')) {
            expect(p.delay).toBeLessThanOrEqual(0)
            expect(-p.delay).toBeLessThanOrEqual(p.duration)
        }
    })

    it('sways sideways, both ways', () => {
        const drifts = particlesFor('christmas', sequence(11)).map((p) => p.drift)
        expect(drifts.some((d) => d < 0)).toBe(true)
        expect(drifts.some((d) => d > 0)).toBe(true)
    })
})

describe('particlesFor: Halloween is a few emoji, now and then', () => {
    it('makes bats, ghosts and one pumpkin, with their own emoji', () => {
        const items = particlesFor('halloween', MIDDLE)
        const count = (kind: string) => items.filter((p) => p.kind === kind).length
        expect(count('bat')).toBe(3)
        expect(count('ghost')).toBe(2)
        expect(count('pumpkin')).toBe(1)

        expect(items.find((p) => p.kind === 'bat')?.group).toEqual(['🦇'])
        expect(items.find((p) => p.kind === 'ghost')?.group).toEqual(['👻'])
        expect(items.find((p) => p.kind === 'pumpkin')?.group).toEqual(['🎃'])
    })

    it('has no flying grave and no flying vampire: no crosser of those kinds at all', () => {
        for (const seed of [1, 4, 8, 15, 23]) {
            const kinds = particlesFor('halloween', sequence(seed)).map((p) => p.kind as string)
            expect(kinds).not.toContain('vampire')
            expect(kinds).not.toContain('frankenstein')
            expect(kinds).not.toContain('zombie')
            // Every emoji of every particle is one of the allowed ones.
            const glyphs = particlesFor('halloween', sequence(seed)).flatMap((p) => p.group)
            expect(glyphs).not.toContain('🧛')
            expect(glyphs).not.toContain('🪦')
        }
    })

    it('adds one chase and one spider, and nothing else', () => {
        const items = particlesFor('halloween', MIDDLE)
        expect(items.filter((p) => p.kind === 'chase')).toHaveLength(1)
        expect(items.filter((p) => p.kind === 'spider')).toHaveLength(1)
        expect(new Set(items.map((p) => p.kind))).toEqual(new Set(['bat', 'ghost', 'pumpkin', 'chase', 'spider']))
    })

    it('draws the chase as the runner first and two zombies behind it, the runner leading', () => {
        const chase = particlesFor('halloween', sequence(4)).find((p) => p.kind === 'chase')!
        expect(chase.group).toHaveLength(3)
        expect(chase.group).toEqual(CHASE_GROUP)
        // The runner is the first, the leftmost span: it leads a right-to-left chase.
        expect(chase.group[0]).toBe('🏃')
        expect(chase.group.slice(1)).toEqual(['\u{1F9DF}', '\u{1F9DF}‍♂️'])
    })

    // 🏃 faces LEFT (Unicode 15.1 added 🏃‍➡️ because it does), so the chase must
    // run that way: going left to right, the runner ran backwards behind the
    // zombies (user, 2026-10-31).
    it('makes the chase always go right to left (dir -1), the way the runner faces, for any seed', () => {
        for (let seed = 1; seed <= 40; seed++) {
            const chase = particlesFor('halloween', sequence(seed)).find((p) => p.kind === 'chase')!
            expect(chase.dir, `seed ${seed}`).toBe(-1)
        }
    })

    it('keeps the chase as rare as the old zombie: same rhythm, same rarity factor', () => {
        // The lone zombie cycled 120-160 s, times CROSSER_RARITY (1.5).
        for (const seed of [3, 7, 11]) {
            const chase = particlesFor('halloween', sequence(seed)).find((p) => p.kind === 'chase')!
            expect(chase.delay).toBeGreaterThan(0)
            expect(chase.duration).toBeGreaterThanOrEqual(120 * 1.5)
            expect(chase.duration).toBeLessThanOrEqual(160 * 1.5)
        }
    })

    it('runs the chase on the ground lane, lifted above the player bar, never in the sky', () => {
        for (const seed of [3, 7, 11, 19]) {
            const chase = particlesFor('halloween', sequence(seed)).find((p) => p.kind === 'chase')!
            expect(chase.ground).toBe(true)
            expect(chase.lift).toBeGreaterThanOrEqual(2.5)
            expect(chase.lift).toBeLessThanOrEqual(6)
        }
    })

    it('makes the pumpkin rare: it waits longer than the others and cycles slowest', () => {
        const items = particlesFor('halloween', sequence(5))
        const pumpkin = items.find((p) => p.kind === 'pumpkin')!
        const bats = items.filter((p) => p.kind === 'bat')
        expect(pumpkin.delay).toBeGreaterThan(0)
        expect(pumpkin.duration).toBeGreaterThan(Math.max(...bats.map((b) => b.duration)))
    })

    it('puts the pumpkin on the ground lane too, above the bar', () => {
        for (const seed of [2, 6, 10]) {
            const pumpkin = particlesFor('halloween', sequence(seed)).find((p) => p.kind === 'pumpkin')!
            expect(pumpkin.ground).toBe(true)
            expect(pumpkin.lift).toBeGreaterThanOrEqual(4)
            expect(pumpkin.lift).toBeLessThanOrEqual(10)
        }
    })

    it('keeps the bats and ghosts in the sky, not on the ground', () => {
        for (const p of particlesFor('halloween', sequence(9)).filter((p) => p.kind === 'bat' || p.kind === 'ghost')) {
            expect(p.ground).toBe(false)
            expect(p.lift).toBe(0)
        }
    })

    it('makes bats cross occasionally: they wait before their first crossing', () => {
        for (const p of particlesFor('halloween', sequence(9)).filter((p) => p.kind === 'bat')) {
            expect(p.delay).toBeGreaterThanOrEqual(0)
            expect(p.duration).toBeGreaterThan(40)
        }
    })

    it('flies every bat right to left, so its head points where it goes', () => {
        for (const seed of [1, 5, 9, 13]) {
            const bats = particlesFor('halloween', sequence(seed)).filter((p) => p.kind === 'bat')
            expect(bats.length).toBeGreaterThan(0)
            for (const b of bats) expect(b.dir).toBe(-1)
        }
    })

    it('lets the pumpkin go both ways', () => {
        const dirs = new Set(
            [1, 5, 9, 13].flatMap((seed) =>
                particlesFor('halloween', sequence(seed))
                    .filter((p) => p.kind === 'pumpkin')
                    .map((p) => p.dir)
            )
        )
        expect(dirs).toEqual(new Set([1, -1]))
    })
})

describe('particlesFor: the spider on its thread', () => {
    it('is one spider, drawn with the spider emoji (U+1F577 with the emoji selector)', () => {
        const spiders = particlesFor('halloween', sequence(6)).filter((p) => p.kind === 'spider')
        expect(spiders).toHaveLength(1)
        expect(spiders[0].group).toEqual([SPIDER_GLYPH])
        expect(SPIDER_GLYPH).toBe('\u{1F577}️')
    })

    it('hangs from the top edge: no sky lane, and it lets itself down a part of the screen', () => {
        for (const seed of [2, 6, 10, 14]) {
            const spider = particlesFor('halloween', sequence(seed)).find((p) => p.kind === 'spider')!
            expect(spider.top).toBe(0)
            expect(spider.ground).toBe(false)
            expect(spider.drop).toBeGreaterThanOrEqual(25)
            expect(spider.drop).toBeLessThanOrEqual(55)
        }
    })

    it('is rare: it waits, and each cycle is longer than a crosser\'s', () => {
        for (const seed of [2, 6, 10]) {
            const spider = particlesFor('halloween', sequence(seed)).find((p) => p.kind === 'spider')!
            expect(spider.delay).toBeGreaterThan(0)
            expect(spider.duration).toBeGreaterThanOrEqual(80 * 1.5)
            expect(spider.duration).toBeLessThanOrEqual(100 * 1.5)
        }
    })

    it('sits somewhere across the width, for any seed', () => {
        for (let seed = 1; seed <= 20; seed++) {
            const spider = particlesFor('halloween', sequence(seed)).find((p) => p.kind === 'spider')!
            expect(spider.left).toBeGreaterThanOrEqual(5)
            expect(spider.left).toBeLessThanOrEqual(95)
        }
    })
})

describe('particlesFor: the sleigh crosses the upper sky, right to left', () => {
    const sleighOf = (seed: number) => particlesFor('christmas', sequence(seed)).find((p) => p.kind === 'sleigh')!

    it('is one sleigh: two reindeer in front, the sled, Santa at the back', () => {
        expect(SLEIGH_GROUP).toEqual(['🦌', '🦌', '🛷', '🎅'])
        expect(sleighOf(3).group).toEqual(SLEIGH_GROUP)
    })

    it('always flies right to left (dir -1), for any seed, so the reindeer lead', () => {
        for (let seed = 1; seed <= 40; seed++) {
            expect(sleighOf(seed).dir, `seed ${seed}`).toBe(-1)
        }
    })

    it('flies in the upper part of the screen, never on the ground lane', () => {
        for (let seed = 1; seed <= 40; seed++) {
            const sleigh = sleighOf(seed)
            expect(sleigh.ground, `seed ${seed}`).toBe(false)
            expect(sleigh.lift).toBe(0)
            expect(sleigh.top).toBeGreaterThanOrEqual(14)
            expect(sleigh.top).toBeLessThanOrEqual(32)
        }
    })

    it('is as rare as the chase: a long cycle, a crossing in a short part of it', () => {
        for (const seed of [3, 7, 11]) {
            const sleigh = sleighOf(seed)
            expect(sleigh.delay).toBeGreaterThan(0)
            expect(sleigh.duration).toBeGreaterThanOrEqual(120 * 1.5)
            expect(sleigh.duration).toBeLessThanOrEqual(160 * 1.5)
        }
    })

    it('crosses from fully off the right edge to fully off the left, measured from its own width', () => {
        const sleigh = sleighOf(5)
        expect(crossing(sleigh)).toEqual({ from: '100vw', to: 'calc(-100% - 1rem)' })
    })

    it('never uses the fixed 12 vw margin, which a wide group would stick out of', () => {
        expect(crossing(sleighOf(5)).to).not.toBe('-12vw')
        expect(crossing(sleighOf(5)).from).not.toBe('112vw')
    })

    it('keeps the single-glyph Halloween crossings as before', () => {
        const bat = particlesFor('halloween', sequence(4)).find((p) => p.kind === 'bat')!
        expect(crossing(bat)).toEqual({ from: '112vw', to: '-12vw' })
    })
})

// The chase is three glyphs wide (~115 px), more than 12 vw at a phone's width:
// with the fixed margin it appeared and vanished half way through the edge.
describe('crossing: a group starts and ends fully off screen', () => {
    it('measures the chase from its own width, right to left', () => {
        const chase = particlesFor('halloween', sequence(4)).find((p) => p.kind === 'chase')!
        expect(crossing(chase)).toEqual({ from: '100vw', to: 'calc(-100% - 1rem)' })
    })
})

describe('particlesFor: every value stays in its range', () => {
    it('keeps positions on the screen and times positive', () => {
        for (const season of ['christmas', 'halloween'] as const) {
            for (let seed = 1; seed <= 10; seed++) {
                for (const p of particlesFor(season, sequence(seed))) {
                    expect(p.left).toBeGreaterThanOrEqual(0)
                    expect(p.left).toBeLessThanOrEqual(100)
                    expect(p.top).toBeGreaterThanOrEqual(0)
                    expect(p.top).toBeLessThanOrEqual(100)
                    expect(p.duration).toBeGreaterThan(0)
                    expect(p.size).toBeGreaterThan(0)
                }
            }
        }
    })
})
