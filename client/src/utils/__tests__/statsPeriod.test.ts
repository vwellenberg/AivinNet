import { describe, expect, it } from 'vitest'

import { STATS_PERIODS, isStatsPeriod, normalizeStatsPeriod, statsPeriodPhrase } from '../statsPeriod'

describe('statsPeriodPhrase', () => {
    it('names every period the chart tabs offer', () => {
        expect(STATS_PERIODS.map(statsPeriodPhrase)).toEqual([
            'for today',
            'for this week',
            'for this month',
            'for this year',
            'of all time',
        ])
    })

    it('falls back to the week, like the server', () => {
        // A period persisted by an older build must not leave the caption empty.
        expect(statsPeriodPhrase('decade')).toBe('for this week')
    })
})

describe('isStatsPeriod', () => {
    it('knows the periods the server accepts and nothing else', () => {
        expect(isStatsPeriod('alltime')).toBe(true)
        expect(isStatsPeriod('all time')).toBe(false)
    })
})

describe('normalizeStatsPeriod', () => {
    it('keeps a period the server accepts', () => {
        expect(STATS_PERIODS.map(normalizeStatsPeriod)).toEqual([...STATS_PERIODS])
    })

    it('turns anything else into the week, so tiles and caption agree', () => {
        expect(normalizeStatsPeriod('decade')).toBe('week')
        expect(statsPeriodPhrase('decade')).toBe(statsPeriodPhrase(normalizeStatsPeriod('decade')))
    })
})
