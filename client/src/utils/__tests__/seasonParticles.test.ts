import { describe, expect, it } from 'vitest'

import { MAX_PARTICLES, particlesFor } from '@/utils/seasonParticles'

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
        expect(particlesFor('halloween', MIDDLE)).toHaveLength(6)
        expect(particlesFor('christmas', MIDDLE)).toHaveLength(18)
    })
})

describe('particlesFor: Christmas is snow', () => {
    it('makes only snowflakes, with a few sizes', () => {
        const flakes = particlesFor('christmas', sequence(7))
        expect(flakes.every((p) => p.kind === 'flake')).toBe(true)
        expect(flakes.every((p) => p.glyph === '')).toBe(true)

        const sizes = new Set(flakes.map((p) => Math.round(p.size)))
        expect(sizes.size).toBeGreaterThan(2)
    })

    it('starts the flakes part-way through their fall, so the screen is not empty at first', () => {
        for (const p of particlesFor('christmas', sequence(3))) {
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

        expect(items.find((p) => p.kind === 'bat')?.glyph).toBe('🦇')
        expect(items.find((p) => p.kind === 'ghost')?.glyph).toBe('👻')
        expect(items.find((p) => p.kind === 'pumpkin')?.glyph).toBe('🎃')
    })

    it('makes the pumpkin rare: it waits longer than the others and cycles slowest', () => {
        const items = particlesFor('halloween', sequence(5))
        const pumpkin = items.find((p) => p.kind === 'pumpkin')!
        const bats = items.filter((p) => p.kind === 'bat')
        expect(pumpkin.delay).toBeGreaterThan(0)
        expect(pumpkin.duration).toBeGreaterThan(Math.max(...bats.map((b) => b.duration)))
    })

    it('makes bats cross occasionally: they wait before their first crossing', () => {
        for (const p of particlesFor('halloween', sequence(9)).filter((p) => p.kind === 'bat')) {
            expect(p.delay).toBeGreaterThanOrEqual(0)
            expect(p.duration).toBeGreaterThan(40)
        }
    })

    it('gives each flying particle a travel direction, both ways', () => {
        const dirs = new Set(particlesFor('halloween', sequence(13)).map((p) => p.dir))
        expect(dirs).toEqual(new Set([1, -1]))
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
