import { describe, expect, it } from 'vitest'

import { crateFan } from '../crateFan'

// Desktop card: 12rem tall. Cover size = round(200 x 0.62) = 124.
const H = 200
const SIZE = 124
const X0 = -0.15 * SIZE
const x1 = (w: number) => w - 0.85 * SIZE

describe('crateFan', () => {
    it('sizes the sleeves from the card height', () => {
        expect(crateFan(1, 300, H).size).toBe(SIZE)
        // Phone card: 9rem = 144px tall.
        expect(crateFan(1, 300, 144).size).toBe(89)
    })

    it('shows more pictures the wider the card', () => {
        const counts = [400, 600, 800, 1000, 1200, 1400].map(w => crateFan(16, w, H).slots.length)
        for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1])
        expect(counts[counts.length - 1]).toBeGreaterThan(counts[0])
    })

    it('never starts a sleeve left of x0 or past x1', () => {
        for (let available = 1; available <= 16; available++) {
            for (let w = 150; w <= 1400; w += 50) {
                const { slots } = crateFan(available, w, H)
                for (const s of slots) {
                    expect(s.left).toBeGreaterThanOrEqual(X0 - 1e-6)
                    // The sleeve ends at left + size, which must not pass x1 + size.
                    expect(s.left + SIZE).toBeLessThanOrEqual(x1(w) + SIZE + 1e-6)
                }
            }
        }
    })

    it('fills the row to the right edge when there are enough pictures', () => {
        const w = 900
        const { slots } = crateFan(16, w, H)
        const step = 0.5 * SIZE
        expect(slots[slots.length - 1].left).toBeGreaterThanOrEqual(x1(w) - step - 1e-6)
    })

    it('rotations are symmetric around 0', () => {
        for (const n of [2, 3, 4, 5, 7]) {
            const { slots } = crateFan(n, 900, H)
            slots.forEach((s, i) => {
                expect(s.rotate + slots[slots.length - 1 - i].rotate).toBeCloseTo(0, 6)
            })
        }
        const { slots } = crateFan(5, 900, H)
        expect(slots[0].rotate).toBeCloseTo(-14, 6)
        expect(slots[4].rotate).toBeCloseTo(14, 6)
    })

    it('the middle sleeve is lifted the most, the outer ones lowest', () => {
        for (const n of [3, 5, 7]) {
            const { slots } = crateFan(n, 900, H)
            const mid = Math.floor(n / 2)
            const lifts = slots.map(s => s.lift)
            expect(lifts[mid]).toBe(Math.max(...lifts))
            expect(lifts[0]).toBeCloseTo(0, 6)
            expect(lifts[n - 1]).toBeCloseTo(0, 6)
        }
    })

    it('a few pictures widen the step to 0.9 x size and anchor the row at the right', () => {
        const w = 800
        const { slots } = crateFan(2, w, H)
        expect(slots).toHaveLength(2)
        expect(slots[1].left).toBeCloseTo(x1(w), 6)
        expect(slots[1].left - slots[0].left).toBeCloseTo(0.9 * SIZE, 6)
    })

    it('a width of 0 renders every picture (not measured yet)', () => {
        expect(crateFan(7, 0, 0).slots).toHaveLength(7)
        expect(crateFan(7, 0, H).slots).toHaveLength(7)
        expect(crateFan(7, 500, 0).slots).toHaveLength(7)
        expect(crateFan(7, 0, 0).size).toBe(0)
    })

    it('renders nothing for no pictures', () => {
        expect(crateFan(0, 900, H).slots).toEqual([])
    })
})
