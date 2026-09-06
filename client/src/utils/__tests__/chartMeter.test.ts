import { describe, expect, it } from 'vitest'

import { CHART_METER_MIN_PCT, chartItemDuration, meterPercent, rankBadgeClass } from '../chartMeter'

describe('meterPercent', () => {
    it('scales a duration against the chart maximum', () => {
        expect(meterPercent(64_764, 64_764)).toBe(100)
        expect(meterPercent(32_382, 64_764)).toBe(50)
        expect(meterPercent(45_966, 64_764)).toBe(71)
    })

    it('keeps a charted row visible with the minimum sliver', () => {
        expect(meterPercent(30, 64_764)).toBe(CHART_METER_MIN_PCT)
    })

    it('clamps to 100 when rounding overshoots', () => {
        // 99.6% rounds to 100; a duration above max (defensive) stays capped.
        expect(meterPercent(996, 1000)).toBe(100)
        expect(meterPercent(1200, 1000)).toBe(100)
    })

    it('returns null (no meter) for missing or degenerate data', () => {
        // Old backend: no fields at all.
        expect(meterPercent(undefined, undefined)).toBeNull()
        expect(meterPercent(null, 1000)).toBeNull()
        expect(meterPercent(1000, null)).toBeNull()
        // Zero-duration item or empty period must not draw a "0%" frame.
        expect(meterPercent(0, 1000)).toBeNull()
        expect(meterPercent(1000, 0)).toBeNull()
        expect(meterPercent(NaN, 1000)).toBeNull()
        expect(meterPercent(1000, NaN)).toBeNull()
    })
})

describe('rankBadgeClass', () => {
    it('gives the podium ranks their accent class', () => {
        expect(rankBadgeClass(1)).toBe('r1')
        expect(rankBadgeClass(2)).toBe('r2')
        expect(rankBadgeClass(3)).toBe('r3')
    })

    it('leaves every other rank neutral — including page 2 of a paged chart', () => {
        expect(rankBadgeClass(4)).toBe('')
        expect(rankBadgeClass(11)).toBe('')
        expect(rankBadgeClass(0)).toBe('')
    })
})

describe('chartItemDuration', () => {
    it('reads the additive extra.playduration field', () => {
        expect(chartItemDuration({ extra: { playduration: 64_764 } })).toBe(64_764)
    })

    it('returns null for an old backend payload without the field', () => {
        // Realistic shapes: artists/playlists carry extra with playcount only,
        // albums/tracks carried no extra at all before the field was added.
        expect(chartItemDuration({ extra: { playcount: 354 } as any })).toBeNull()
        expect(chartItemDuration({})).toBeNull()
    })

    it('rejects non-numeric or non-positive values', () => {
        expect(chartItemDuration({ extra: { playduration: '3600' } })).toBeNull()
        expect(chartItemDuration({ extra: { playduration: 0 } })).toBeNull()
        expect(chartItemDuration({ extra: { playduration: NaN } })).toBeNull()
    })
})
