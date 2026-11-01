import { describe, expect, it } from 'vitest'

import {
    STATS_PERIODS,
    STATS_TABS,
    isStatsPeriod,
    isStatsTab,
    normalizeStatsPeriod,
    statsPeriodLabel,
    statsPeriodPhrase,
} from '../statsPeriod'

describe('statsPeriodPhrase', () => {
    it('names every period the chart tabs offer', () => {
        expect(STATS_PERIODS.map(statsPeriodPhrase)).toEqual([
            'for today',
            'for this week',
            'for this month',
            'for this year',
            'of all time',
            'for last week',
            'for last month',
        ])
    })

    it('names the previous week and month the way the recap card does', () => {
        expect(statsPeriodPhrase('lastweek')).toBe('for last week')
        expect(statsPeriodPhrase('lastmonth')).toBe('for last month')
    })

    it('falls back to the week, like the server', () => {
        // A period persisted by an older build must not leave the caption empty.
        expect(statsPeriodPhrase('decade')).toBe('for this week')
    })
})

describe('isStatsPeriod', () => {
    it('knows the periods the server accepts and nothing else', () => {
        expect(isStatsPeriod('alltime')).toBe(true)
        expect(isStatsPeriod('lastmonth')).toBe(true)
        expect(isStatsPeriod('all time')).toBe(false)
    })
})

describe('the tab row', () => {
    it('keeps the five tabs; last week and last month are not among them', () => {
        expect([...STATS_TABS]).toEqual(['day', 'week', 'month', 'year', 'alltime'])
        expect(isStatsTab('lastweek')).toBe(false)
        expect(isStatsTab('lastmonth')).toBe(false)
        expect(isStatsTab('month')).toBe(true)
    })

    it('words the previous periods for their tabs, and the rest as before', () => {
        expect(statsPeriodLabel('lastweek')).toBe('Last week')
        expect(statsPeriodLabel('lastmonth')).toBe('Last month')
        expect(statsPeriodLabel('week')).toBe('week')
        expect(statsPeriodLabel('alltime')).toBe('alltime')
    })
})

describe('normalizeStatsPeriod', () => {
    it('keeps a period the server accepts', () => {
        expect(STATS_PERIODS.map(normalizeStatsPeriod)).toEqual([...STATS_PERIODS])
        expect(normalizeStatsPeriod('lastweek')).toBe('lastweek')
        expect(normalizeStatsPeriod('lastmonth')).toBe('lastmonth')
    })

    it('turns anything else into the week, so tiles and caption agree', () => {
        expect(normalizeStatsPeriod('decade')).toBe('week')
        expect(statsPeriodPhrase('decade')).toBe(statsPeriodPhrase(normalizeStatsPeriod('decade')))
    })
})
