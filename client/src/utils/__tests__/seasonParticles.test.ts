import { describe, expect, it } from 'vitest'

import {
    BELL_GLYPH,
    CHASE_BIG_SHARE,
    CHASE_ZOMBIES_MAX,
    CHASE_ZOMBIES_MIN,
    CHASE_ZOMBIES_TYPICAL_MAX,
    CROSSER_QUIET_START_S,
    DRIFT_SETTLE_S,
    GLITTER_COUNT,
    MAX_PARTICLES,
    PENGUIN_GLYPH,
    PRESENT_GLYPH,
    ROCKET_COUNT,
    ROCKET_DURATION_MAX_S,
    ROCKET_DURATION_MIN_S,
    SLEIGH_GROUP,
    SPARK_COLOURS,
    SPARK_MAX,
    SPARK_MIN,
    SPIDER_GLYPH,
    STAR_GLYPH,
    WADDLE_MAX,
    WADDLE_MIN,
    ZOMBIE_GLYPHS,
    chaseHorde,
    chaseZombieCount,
    crossing,
    hangs,
    particlesFor,
    sparkBurst,
    waddleGroup,
} from '@/utils/seasonParticles'

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
        expect(MAX_PARTICLES).toBe(45)
        for (const season of ['christmas', 'halloween', 'newyear'] as const) {
            for (let seed = 1; seed <= 20; seed++) {
                expect(particlesFor(season, sequence(seed)).length).toBeLessThanOrEqual(MAX_PARTICLES)
            }
        }
    })

    it('a season with a few particles keeps every one of them', () => {
        expect(particlesFor('halloween', MIDDLE)).toHaveLength(8)
        // 36 snowflakes, and one each of the sleigh, the bell, the present, the waddle and the star.
        expect(particlesFor('christmas', MIDDLE)).toHaveLength(41)
    })

    it('the whole horde is one particle: the cap counts the chase once', () => {
        for (let seed = 1; seed <= 50; seed++) {
            expect(particlesFor('halloween', sequence(seed)).filter((p) => p.kind === 'chase')).toHaveLength(1)
        }
    })
})

describe('particlesFor: Christmas is snow, and now and then a sleigh', () => {
    it('makes snowflakes with a few sizes, and one sleigh among them', () => {
        const all = particlesFor('christmas', sequence(7))
        const flakes = all.filter((p) => p.kind === 'flake')
        expect(flakes).toHaveLength(36)
        expect(flakes.every((p) => p.group.length === 0)).toBe(true)
        expect(all.filter((p) => p.kind !== 'flake').map((p) => p.kind)).toEqual([
            'sleigh',
            'bell',
            'present',
            'waddle',
            'star',
        ])

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

describe('chaseZombieCount: a horde of 8 to 10, and in one chase of three a bigger one', () => {
    it('has the documented bounds: 8 to 10 typical, up to 16', () => {
        expect(CHASE_ZOMBIES_MIN).toBe(8)
        expect(CHASE_ZOMBIES_TYPICAL_MAX).toBe(10)
        expect(CHASE_ZOMBIES_MAX).toBe(16)
        expect(CHASE_BIG_SHARE).toBeCloseTo(1 / 3, 10)
    })

    it('is 8 to 10 in about two chases of three, and 11 to 16 in the rest', () => {
        const counts: number[] = []
        for (let seed = 1; seed <= 3000; seed++) counts.push(chaseZombieCount(sequence(seed)))
        for (const n of counts) {
            expect(n).toBeGreaterThanOrEqual(CHASE_ZOMBIES_MIN)
            expect(n).toBeLessThanOrEqual(CHASE_ZOMBIES_MAX)
        }
        const typical = counts.filter((n) => n <= CHASE_ZOMBIES_TYPICAL_MAX).length / counts.length
        expect(Math.abs(typical - 2 / 3)).toBeLessThan(0.03)
        // Each side of the split reaches all of its own sizes, and the bigger hordes come by.
        expect(new Set(counts.filter((n) => n <= 10))).toEqual(new Set([8, 9, 10]))
        expect(new Set(counts.filter((n) => n > 10))).toEqual(new Set([11, 12, 13, 14, 15, 16]))
    })

    it('splits at one third of the random source: below it the bigger horde, from it the typical one', () => {
        // A constant source takes the same branch on every draw, so these pin each branch's ends.
        // Typical (random >= 1/3): 8 at the low end, 10 at the high end.
        expect(chaseZombieCount(() => 1 / 3)).toBe(9)
        expect(chaseZombieCount(() => 0.999999)).toBe(10)
        // Bigger (random < 1/3): 11 at the low end, 16 at the high end.
        expect(chaseZombieCount(() => 0)).toBe(11)
        expect(chaseZombieCount(() => 0.2)).toBe(12)
        expect(chaseZombieCount(() => 0.333)).toBe(12)
    })
})

describe('chaseHorde: the runner first, then the zombies clustered behind it', () => {
    it('is the runner first, then 8 to 16 zombies, all from the three zombie glyphs', () => {
        for (let seed = 1; seed <= 200; seed++) {
            const { group } = chaseHorde(sequence(seed))
            expect(group[0], `seed ${seed}`).toBe('🏃')
            const zombies = group.slice(1)
            expect(zombies.length, `seed ${seed}`).toBeGreaterThanOrEqual(CHASE_ZOMBIES_MIN)
            expect(zombies.length, `seed ${seed}`).toBeLessThanOrEqual(CHASE_ZOMBIES_MAX)
            for (const z of zombies) expect(ZOMBIE_GLYPHS, `seed ${seed}`).toContain(z)
        }
    })

    it('mixes the three zombie glyphs across the horde', () => {
        const seen = new Set<string>()
        for (let seed = 1; seed <= 40; seed++) for (const z of chaseHorde(sequence(seed)).group.slice(1)) seen.add(z)
        expect(seen).toEqual(new Set(ZOMBIE_GLYPHS))
    })

    it('has one offset per glyph, parallel to the group', () => {
        for (let seed = 1; seed <= 200; seed++) {
            const { group, offsets } = chaseHorde(sequence(seed))
            expect(offsets, `seed ${seed}`).toHaveLength(group.length)
        }
    })

    it('puts the runner at (0, 0), the leftmost spot, and every zombie to its right', () => {
        for (let seed = 1; seed <= 200; seed++) {
            const { offsets } = chaseHorde(sequence(seed))
            expect(offsets[0]).toEqual({ x: 0, y: 0 })
            for (const o of offsets.slice(1)) expect(o.x, `seed ${seed}`).toBeGreaterThan(0)
        }
    })

    it('keeps every glyph on or above the ground lane: no y is positive', () => {
        for (let seed = 1; seed <= 200; seed++) {
            for (const o of chaseHorde(sequence(seed)).offsets) expect(o.y, `seed ${seed}`).toBeLessThanOrEqual(0)
        }
    })

    it('is a cluster, not a line: at least two rows once there are eight zombies or more', () => {
        for (let seed = 1; seed <= 200; seed++) {
            const { offsets } = chaseHorde(sequence(seed))
            const zombies = offsets.slice(1)
            expect(zombies.length).toBeGreaterThanOrEqual(8)
            // Rows are 0.45 glyph sizes apart; the jitter is well inside half of that.
            const rows = new Set(zombies.map((o) => Math.round(-o.y / 0.45)))
            expect(rows.size, `seed ${seed}`).toBeGreaterThanOrEqual(2)
        }
    })

    it('draws the back rows behind the front row in height: they sit higher than the ground', () => {
        const { offsets } = chaseHorde(sequence(4))
        expect(Math.min(...offsets.map((o) => o.y))).toBeLessThan(-0.5)
    })

    it('reports the box the cluster needs: its width past the runner and its height above the ground', () => {
        for (let seed = 1; seed <= 100; seed++) {
            const { offsets, extent } = chaseHorde(sequence(seed))
            // Every glyph is one glyph size; the box covers all of them.
            expect(extent.w, `seed ${seed}`).toBeCloseTo(Math.max(...offsets.map((o) => o.x)) + 1, 10)
            expect(extent.h, `seed ${seed}`).toBeCloseTo(-Math.min(...offsets.map((o) => o.y)) + 1, 10)
        }
    })

    it('is the same cluster for the same random source', () => {
        expect(chaseHorde(sequence(42))).toEqual(chaseHorde(sequence(42)))
    })

    it('gives each chase a different horde', () => {
        const sizes = new Set<number>()
        for (let seed = 1; seed <= 60; seed++) sizes.add(chaseHorde(sequence(seed)).group.length)
        expect(sizes.size).toBeGreaterThan(3)
    })
})

describe('particlesFor: the chase carries its horde', () => {
    it('gives the chase its group, its offsets and its box, and a glyph size of 30', () => {
        for (let seed = 1; seed <= 30; seed++) {
            const chase = particlesFor('halloween', sequence(seed)).find((p) => p.kind === 'chase')!
            expect(chase.size).toBe(30)
            expect(chase.group[0]).toBe('🏃')
            expect(chase.offsets).toHaveLength(chase.group.length)
            expect(chase.extent.w).toBeGreaterThan(1)
            expect(chase.extent.h).toBeGreaterThan(1)
        }
    })

    it('leaves the other groups as a plain row: no offsets for the sleigh or the bats', () => {
        for (const p of particlesFor('christmas', sequence(3)).filter((p) => p.kind === 'sleigh')) {
            expect(p.offsets).toEqual([])
        }
        for (const p of particlesFor('halloween', sequence(9)).filter((p) => p.kind === 'bat')) {
            expect(p.offsets).toEqual([])
        }
    })

    it('makes the chase always go right to left (dir -1) and keeps it on the ground lane, whatever the horde', () => {
        for (let seed = 1; seed <= 40; seed++) {
            const chase = particlesFor('halloween', sequence(seed)).find((p) => p.kind === 'chase')!
            expect(chase.dir).toBe(-1)
            expect(chase.ground).toBe(true)
        }
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

// The chase is a cluster, wider than 12 vw at a phone's width: with the fixed
// margin it appeared and vanished half way through the edge.
describe('crossing: a group starts and ends fully off screen', () => {
    it('measures the chase from its own width, right to left', () => {
        const chase = particlesFor('halloween', sequence(4)).find((p) => p.kind === 'chase')!
        expect(crossing(chase)).toEqual({ from: '100vw', to: 'calc(-100% - 1rem)' })
    })
})

describe('particlesFor: every value stays in its range', () => {
    it('keeps positions on the screen and times positive', () => {
        for (const season of ['christmas', 'halloween', 'newyear'] as const) {
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

// "die, die über das bild huschen bitte nur im schnitt alle 15 sekunden" (user,
// 2026-11-02). Each crosser comes by once per cycle, so the page sees, on
// average, sum(1 / duration) of them per second. And the first minute after a
// load must not be busier than any other: every crosser used to have an early
// fixed window (ghosts were even mid-rise at once), and a fresh page saw seven
// or eight of them in its first minute.
describe('crossers: about one every 15 s, from the first minute on', () => {
    // The rockets (#674) are crossers too: they come by on their own cycle, one at a time.
    const CROSSERS = new Set([
        'bat',
        'ghost',
        'pumpkin',
        'chase',
        'spider',
        'sleigh',
        'bell',
        'present',
        'waddle',
        'star',
        'rocket',
    ])
    const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1)
    const SEASONS = ['halloween', 'christmas', 'newyear'] as const

    it('comes by once every 15 s or less often, on average, in every season', () => {
        for (const season of SEASONS) {
            let rate = 0
            for (const seed of SEEDS) {
                for (const p of particlesFor(season, sequence(seed))) {
                    if (CROSSERS.has(p.kind)) rate += 1 / p.duration
                }
            }
            const meanGap = 1 / (rate / SEEDS.length)
            expect(meanGap, season).toBeGreaterThanOrEqual(15)
        }
    })

    it('starts every crosser somewhere in its own cycle, after a quiet start, never mid-way', () => {
        for (const seed of SEEDS) {
            for (const season of ['halloween', 'christmas'] as const) {
                for (const p of particlesFor(season, sequence(seed)).filter((p) => CROSSERS.has(p.kind))) {
                    expect(p.delay, `${season} ${p.kind} seed ${seed}`).toBeGreaterThanOrEqual(CROSSER_QUIET_START_S)
                    expect(p.delay, `${season} ${p.kind} seed ${seed}`).toBeLessThanOrEqual(p.duration)
                }
            }
        }
    })

    it('keeps the first minute after a load as calm as any other, in every season', () => {
        for (const season of SEASONS) {
            let firstMinute = 0
            let rate = 0
            for (const seed of SEEDS) {
                for (const p of particlesFor(season, sequence(seed)).filter((p) => CROSSERS.has(p.kind))) {
                    if (p.delay < 60) firstMinute++
                    rate += 1 / p.duration
                }
            }
            // Steady state brings 60 * rate per minute; the first minute may not bring
            // more than that plus a little sampling slack.
            expect(firstMinute / SEEDS.length, season).toBeLessThanOrEqual((60 * rate) / SEEDS.length + 0.5)
        }
    })
})

describe('particlesFor: Christmas hangs a bell on a ribbon, as the spider hangs', () => {
    const bellOf = (seed: number) => particlesFor('christmas', sequence(seed)).find((p) => p.kind === 'bell')!

    it('is one bell, drawn with the bell emoji', () => {
        for (let seed = 1; seed <= 20; seed++) {
            const bells = particlesFor('christmas', sequence(seed)).filter((p) => p.kind === 'bell')
            expect(bells).toHaveLength(1)
            expect(bells[0].group).toEqual([BELL_GLYPH])
        }
        expect(BELL_GLYPH).toBe('🔔')
    })

    it('hangs from the top edge like the spider: no sky lane, a drop within the spider\'s range', () => {
        for (const seed of [2, 6, 10, 14]) {
            const bell = bellOf(seed)
            expect(bell.top).toBe(0)
            expect(bell.ground).toBe(false)
            expect(bell.lift).toBe(0)
            expect(bell.drop).toBeGreaterThanOrEqual(25)
            expect(bell.drop).toBeLessThanOrEqual(55)
        }
    })

    it('is a hanger, and so is the spider, and nothing else is', () => {
        expect(hangs(bellOf(2))).toBe(true)
        for (const seed of [2, 6]) {
            const spider = particlesFor('halloween', sequence(seed)).find((p) => p.kind === 'spider')!
            expect(hangs(spider)).toBe(true)
        }
        for (const p of [...particlesFor('christmas', sequence(4)), ...particlesFor('halloween', sequence(4))]) {
            if (p.kind !== 'spider' && p.kind !== 'bell') expect(hangs(p), p.kind).toBe(false)
        }
    })

    it('is as rare as the spider: a long cycle, a crossing in a short part of it, and it waits first', () => {
        for (const seed of [2, 6, 10]) {
            const bell = bellOf(seed)
            expect(bell.delay).toBeGreaterThan(0)
            expect(bell.duration).toBeGreaterThanOrEqual(80 * 1.5)
            expect(bell.duration).toBeLessThanOrEqual(100 * 1.5)
        }
    })

    it('sits somewhere across the width, for any seed', () => {
        for (let seed = 1; seed <= 20; seed++) {
            const bell = bellOf(seed)
            expect(bell.left).toBeGreaterThanOrEqual(5)
            expect(bell.left).toBeLessThanOrEqual(95)
        }
    })

    it('has a ribbon that is gold or red, never the line colour, and both turn up', () => {
        const ribbons = new Set<string>()
        for (let seed = 1; seed <= 60; seed++) ribbons.add(bellOf(seed).ribbon)
        expect(ribbons).toEqual(new Set(['gold', 'red']))
    })

    it('gives the spider the line colour as its thread', () => {
        const spider = particlesFor('halloween', sequence(6)).find((p) => p.kind === 'spider')!
        expect(spider.ribbon).toBe('line')
    })
})

describe('particlesFor: Christmas presents tumble along the ground lane, as the pumpkin rolls', () => {
    const presentOf = (seed: number) => particlesFor('christmas', sequence(seed)).find((p) => p.kind === 'present')!

    it('is one present, drawn with the gift emoji', () => {
        for (let seed = 1; seed <= 20; seed++) {
            const presents = particlesFor('christmas', sequence(seed)).filter((p) => p.kind === 'present')
            expect(presents).toHaveLength(1)
            expect(presents[0].group).toEqual([PRESENT_GLYPH])
        }
        expect(PRESENT_GLYPH).toBe('🎁')
    })

    it('stands on the ground lane above the bar, like the pumpkin', () => {
        for (const seed of [2, 6, 10, 14]) {
            const present = presentOf(seed)
            expect(present.ground).toBe(true)
            expect(present.lift).toBeGreaterThanOrEqual(4)
            expect(present.lift).toBeLessThanOrEqual(10)
        }
    })

    it('is rare like the pumpkin: it waits, and its cycle is the pumpkin\'s', () => {
        for (const seed of [2, 6, 10]) {
            const present = presentOf(seed)
            expect(present.delay).toBeGreaterThan(0)
            expect(present.duration).toBeGreaterThanOrEqual(150 * 1.5)
            expect(present.duration).toBeLessThanOrEqual(200 * 1.5)
        }
    })

    it('goes both ways, like the pumpkin', () => {
        const dirs = new Set([1, 5, 9, 13, 17, 21].map((seed) => presentOf(seed).dir))
        expect(dirs).toEqual(new Set([1, -1]))
    })

    it('turns a full turn every 2.5 to 3.5 s: a tumble, not a bob', () => {
        for (let seed = 1; seed <= 20; seed++) {
            const present = presentOf(seed)
            expect(present.wobble).toBeGreaterThanOrEqual(2.5)
            expect(present.wobble).toBeLessThanOrEqual(3.5)
        }
    })

    it('is not a hanger and not a group: no thread, no offsets', () => {
        const present = presentOf(3)
        expect(hangs(present)).toBe(false)
        expect(present.offsets).toEqual([])
    })
})

describe('waddleGroup: 3 to 5 penguins in one loose row, the leader first', () => {
    it('has 3 to 5 penguins, all of them the penguin glyph', () => {
        const counts = new Set<number>()
        for (let seed = 1; seed <= 200; seed++) {
            const { group } = waddleGroup(sequence(seed))
            expect(group.length, `seed ${seed}`).toBeGreaterThanOrEqual(WADDLE_MIN)
            expect(group.length, `seed ${seed}`).toBeLessThanOrEqual(WADDLE_MAX)
            for (const g of group) expect(g).toBe(PENGUIN_GLYPH)
            counts.add(group.length)
        }
        expect(counts).toEqual(new Set([3, 4, 5]))
        expect(WADDLE_MIN).toBe(3)
        expect(WADDLE_MAX).toBe(5)
        expect(PENGUIN_GLYPH).toBe('🐧')
    })

    it('puts the leader at (0, 0), the leftmost spot, and the rest to its right', () => {
        for (let seed = 1; seed <= 200; seed++) {
            const { offsets } = waddleGroup(sequence(seed))
            expect(offsets[0]).toEqual({ x: 0, y: 0 })
            for (const o of offsets.slice(1)) expect(o.x, `seed ${seed}`).toBeGreaterThan(0)
        }
    })

    it('has one offset per penguin, and no penguin drops below the ground lane', () => {
        for (let seed = 1; seed <= 200; seed++) {
            const { group, offsets } = waddleGroup(sequence(seed))
            expect(offsets, `seed ${seed}`).toHaveLength(group.length)
            for (const o of offsets) expect(o.y, `seed ${seed}`).toBeLessThanOrEqual(0)
        }
    })

    it('is one loose row: the penguins step along the ground with no two on top of each other', () => {
        for (let seed = 1; seed <= 200; seed++) {
            const xs = waddleGroup(sequence(seed)).offsets.map((o) => o.x)
            for (let j = 1; j < xs.length; j++) {
                expect(xs[j] - xs[j - 1], `seed ${seed}`).toBeGreaterThan(0.5)
            }
        }
    })

    it('reports the box it needs, as the chase does', () => {
        for (let seed = 1; seed <= 100; seed++) {
            const { offsets, extent } = waddleGroup(sequence(seed))
            expect(extent.w, `seed ${seed}`).toBeCloseTo(Math.max(...offsets.map((o) => o.x)) + 1, 10)
            expect(extent.h, `seed ${seed}`).toBeCloseTo(-Math.min(...offsets.map((o) => o.y)) + 1, 10)
        }
    })
})

describe('particlesFor: Christmas penguins waddle right to left, as the chase runs', () => {
    const waddleOf = (seed: number) => particlesFor('christmas', sequence(seed)).find((p) => p.kind === 'waddle')!

    it('is one waddle, carrying its penguins, offsets and box', () => {
        for (let seed = 1; seed <= 30; seed++) {
            const items = particlesFor('christmas', sequence(seed)).filter((p) => p.kind === 'waddle')
            expect(items).toHaveLength(1)
            const waddle = items[0]
            expect(waddle.group.length).toBeGreaterThanOrEqual(WADDLE_MIN)
            expect(waddle.offsets).toHaveLength(waddle.group.length)
            expect(waddle.size).toBe(24)
            expect(waddle.extent.w).toBeGreaterThan(1)
            expect(waddle.extent.h).toBeGreaterThan(1)
        }
    })

    it('always goes right to left (dir -1), whatever the group, so the leader leads', () => {
        for (let seed = 1; seed <= 40; seed++) {
            expect(waddleOf(seed).dir, `seed ${seed}`).toBe(-1)
        }
    })

    it('waddles on the ground lane, lifted above the player bar, never in the sky', () => {
        for (const seed of [3, 7, 11, 19]) {
            const waddle = waddleOf(seed)
            expect(waddle.ground).toBe(true)
            expect(waddle.lift).toBeGreaterThanOrEqual(2.5)
            expect(waddle.lift).toBeLessThanOrEqual(6)
            expect(hangs(waddle)).toBe(false)
        }
    })

    it('is as rare as the chase: the chase rhythm and rarity factor', () => {
        for (const seed of [3, 7, 11]) {
            const waddle = waddleOf(seed)
            expect(waddle.delay).toBeGreaterThan(0)
            expect(waddle.duration).toBeGreaterThanOrEqual(120 * 1.5)
            expect(waddle.duration).toBeLessThanOrEqual(160 * 1.5)
        }
    })

    it('crosses from fully off the right edge to fully off the left, measured from its own width', () => {
        expect(crossing(waddleOf(4))).toEqual({ from: '100vw', to: 'calc(-100% - 1rem)' })
    })

    it('has no fixed-margin crossing that a cluster of penguins would stick out of', () => {
        expect(crossing(waddleOf(4)).to).not.toBe('-12vw')
        expect(crossing(waddleOf(4)).from).not.toBe('112vw')
    })
})

describe('Christmas crossers: the lanes and the sky, and nothing behind the bar', () => {
    it('keeps the bell in the sky, the present and the penguins on the ground lane', () => {
        for (const seed of [1, 5, 9, 13]) {
            const items = particlesFor('christmas', sequence(seed))
            for (const p of items.filter((p) => p.kind === 'bell')) expect(p.ground).toBe(false)
            for (const p of items.filter((p) => p.kind === 'present' || p.kind === 'waddle')) {
                expect(p.ground).toBe(true)
                expect(p.lift).toBeGreaterThan(0)
            }
        }
    })

    it('never puts a ground crosser under the bar: its lift is above zero, its glyphs never rise above the lane', () => {
        for (const seed of [1, 5, 9, 13]) {
            for (const p of particlesFor('christmas', sequence(seed))) {
                if (!p.ground) continue
                expect(p.lift).toBeGreaterThan(0)
                for (const o of p.offsets) expect(o.y).toBeLessThanOrEqual(0)
            }
        }
    })
})

describe('particlesFor: Christmas shooting star, across the upper sky', () => {
    const starOf = (seed: number) => particlesFor('christmas', sequence(seed)).find((p) => p.kind === 'star')!

    it('is one star, drawn with the star emoji', () => {
        for (let seed = 1; seed <= 20; seed++) {
            const stars = particlesFor('christmas', sequence(seed)).filter((p) => p.kind === 'star')
            expect(stars).toHaveLength(1)
            expect(stars[0].group).toEqual([STAR_GLYPH])
        }
        expect(STAR_GLYPH).toBe('⭐')
    })

    it('always goes right to left, so its trail streams behind it, for any seed', () => {
        for (let seed = 1; seed <= 40; seed++) {
            expect(starOf(seed).dir, `seed ${seed}`).toBe(-1)
        }
    })

    it('flies in the upper sky, never on the ground lane, and is no hanger', () => {
        for (let seed = 1; seed <= 40; seed++) {
            const star = starOf(seed)
            expect(star.ground, `seed ${seed}`).toBe(false)
            expect(star.lift).toBe(0)
            expect(star.top, `seed ${seed}`).toBeGreaterThanOrEqual(8)
            expect(star.top, `seed ${seed}`).toBeLessThanOrEqual(30)
            expect(hangs(star)).toBe(false)
        }
    })

    it('is rare: it waits first, and its cycle is a long one (100 to 140 s, times the rarity factor)', () => {
        for (const seed of [3, 7, 11]) {
            const star = starOf(seed)
            expect(star.delay).toBeGreaterThan(0)
            expect(star.duration).toBeGreaterThanOrEqual(100 * 1.5)
            expect(star.duration).toBeLessThanOrEqual(140 * 1.5)
        }
    })

    it('crosses fully off screen, from the right edge to the left, as one glyph does', () => {
        expect(crossing(starOf(4))).toEqual({ from: '112vw', to: '-12vw' })
    })
})

describe('the snow drift on the player bar: settles over a few minutes', () => {
    it('settles in over 2 to 5 minutes', () => {
        expect(DRIFT_SETTLE_S).toBeGreaterThanOrEqual(120)
        expect(DRIFT_SETTLE_S).toBeLessThanOrEqual(300)
    })
})

describe('particlesFor: New Year\'s Eve is fireworks and a few sparkles (#674)', () => {
    it('makes the rockets and the sparkles, and nothing else', () => {
        const kinds = particlesFor('newyear', MIDDLE).map((p) => p.kind)
        expect(kinds.filter((k) => k === 'rocket')).toHaveLength(ROCKET_COUNT)
        expect(kinds.filter((k) => k === 'glitter')).toHaveLength(GLITTER_COUNT)
        expect(kinds).toHaveLength(ROCKET_COUNT + GLITTER_COUNT)
    })

    it('has three or four rockets, and sparse sparkles: four of each at most', () => {
        expect(ROCKET_COUNT).toBeGreaterThanOrEqual(3)
        expect(ROCKET_COUNT).toBeLessThanOrEqual(4)
        expect(GLITTER_COUNT).toBeLessThanOrEqual(4)
    })

    it('launches each rocket from the ground lane, just above the player bar, never in the sky', () => {
        for (const seed of Array.from({ length: 30 }, (_, i) => i + 1)) {
            for (const p of particlesFor('newyear', sequence(seed)).filter((p) => p.kind === 'rocket')) {
                expect(p.ground).toBe(true)
                expect(p.lift).toBeGreaterThanOrEqual(2)
                expect(p.lift).toBeLessThanOrEqual(3.5)
                expect(p.left).toBeGreaterThanOrEqual(0)
                expect(p.left).toBeLessThanOrEqual(100)
            }
        }
    })

    it('gives every rocket its own cycle of 64 to 80 s, long enough for the 15 s rule', () => {
        expect(ROCKET_DURATION_MIN_S).toBeGreaterThanOrEqual(ROCKET_COUNT * 15)
        for (const seed of Array.from({ length: 30 }, (_, i) => i + 1)) {
            for (const p of particlesFor('newyear', sequence(seed)).filter((p) => p.kind === 'rocket')) {
                expect(p.duration).toBeGreaterThanOrEqual(ROCKET_DURATION_MIN_S)
                expect(p.duration).toBeLessThanOrEqual(ROCKET_DURATION_MAX_S)
            }
        }
    })

    it('spreads the rockets\' first appearances over their cycles, after the quiet start', () => {
        const delays = particlesFor('newyear', sequence(7)).filter((p) => p.kind === 'rocket').map((p) => p.delay)
        expect(new Set(delays).size).toBe(ROCKET_COUNT)
        for (const seed of Array.from({ length: 30 }, (_, i) => i + 1)) {
            for (const p of particlesFor('newyear', sequence(seed)).filter((p) => p.kind === 'rocket')) {
                expect(p.delay).toBeGreaterThanOrEqual(CROSSER_QUIET_START_S)
                expect(p.delay).toBeLessThanOrEqual(p.duration)
            }
        }
    })

    it('bursts each rocket into 8 to 12 sparks, for every seed', () => {
        for (const seed of Array.from({ length: 50 }, (_, i) => i + 1)) {
            for (const p of particlesFor('newyear', sequence(seed)).filter((p) => p.kind === 'rocket')) {
                expect(p.sparks.length).toBeGreaterThanOrEqual(SPARK_MIN)
                expect(p.sparks.length).toBeLessThanOrEqual(SPARK_MAX)
            }
        }
        expect(SPARK_MIN).toBe(12)
        expect(SPARK_MAX).toBe(18)
    })

    it('colours the sparks in gold, silver, red and teal only', () => {
        expect([...SPARK_COLOURS].sort()).toEqual(['#1FB5A8', '#C9D0DC', '#F2B233', '#FF284E'].sort())
        for (const seed of Array.from({ length: 20 }, (_, i) => i + 1)) {
            for (const s of sparkBurst(sequence(seed))) {
                expect(SPARK_COLOURS).toContain(s.colour)
            }
        }
    })

    it('spreads a burst evenly round the circle, each spark off its own slot by a few degrees at most', () => {
        const sparks = sparkBurst(MIDDLE)
        const n = sparks.length
        sparks.forEach((s, k) => {
            const slot = (360 / n) * k
            expect(Math.abs(s.angle - slot)).toBeLessThanOrEqual(8)
        })
    })

    // The first cut (50–92 px, 3–5 px dots) read as specks of dust in the preview.
    it('gives the sparks a flight of 70 to 130 px, a size of 5 to 8 px, and a sag of 8 to 22 px', () => {
        for (const seed of Array.from({ length: 40 }, (_, i) => i + 1)) {
            for (const s of sparkBurst(sequence(seed))) {
                expect(s.dist).toBeGreaterThanOrEqual(70)
                expect(s.dist).toBeLessThanOrEqual(130)
                expect(s.size).toBeGreaterThanOrEqual(5)
                expect(s.size).toBeLessThanOrEqual(8)
                expect(s.sag).toBeGreaterThanOrEqual(8)
                expect(s.sag).toBeLessThanOrEqual(22)
            }
        }
    })

    it('draws the sparkles as ✨ glyphs that drift down like the snow, from the top edge', () => {
        const glitter = particlesFor('newyear', sequence(3)).filter((p) => p.kind === 'glitter')
        expect(glitter).toHaveLength(GLITTER_COUNT)
        for (const p of glitter) {
            expect(p.group).toEqual(['✨'])
            expect(p.top).toBe(0)
            expect(p.size).toBeGreaterThanOrEqual(12)
            expect(p.size).toBeLessThanOrEqual(18)
            expect(p.duration).toBeGreaterThan(0)
            expect(p.sparks).toEqual([])
        }
    })

    it('makes no rockets or sparkles at Christmas or Halloween', () => {
        for (const season of ['christmas', 'halloween'] as const) {
            for (const p of particlesFor(season, MIDDLE)) {
                expect(p.kind).not.toBe('rocket')
                expect(p.kind).not.toBe('glitter')
            }
        }
    })

    it('keeps the rockets and the sparkles within the cap', () => {
        expect(ROCKET_COUNT + GLITTER_COUNT).toBeLessThanOrEqual(MAX_PARTICLES)
    })
})
