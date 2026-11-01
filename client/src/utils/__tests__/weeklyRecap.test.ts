import { describe, expect, it } from 'vitest'

import type { WeeklyRecap } from '@/requests/home'
import { recapLines, recapStatsPeriod } from '@/utils/weeklyRecap'

// As GET /nothome/recap sends it (#530).
const week: WeeklyRecap = {
    key: 'week:2026-10-19',
    kind: 'week',
    plays: 6,
    listened: '24 mins',
    top_artist: { artisthash: 'a1', name: 'Dream.Corp' },
    new_albums: 3,
    top_track: { trackhash: 't1', title: 'Stoned', artist: 'Dream.Corp', image: null },
}

describe('recapLines (#530)', () => {
    it('says the week in the server’s words: time, mostly, new albums, top track', () => {
        expect(recapLines(week)).toEqual({
            kicker: 'Last week',
            headline: '24 mins',
            detail: 'mostly Dream.Corp · 3 new albums · top track Stoned',
        })
    })

    it('names the month for a monthly recap', () => {
        expect(recapLines({ ...week, kind: 'month', key: 'month:2026-10' }).kicker).toBe('Last month')
    })

    it('reads one new album in the singular', () => {
        expect(recapLines({ ...week, new_albums: 1 }).detail).toContain('1 new album ·')
    })

    it('leaves out what it has not got, instead of writing a 0', () => {
        const lines = recapLines({ ...week, new_albums: 0, top_artist: null, top_track: null })

        expect(lines.detail).toBe('')
        expect(lines.headline).toBe('24 mins')
    })

    it('keeps the top track when there is no artist', () => {
        expect(recapLines({ ...week, top_artist: null }).detail).toBe('3 new albums · top track Stoned')
    })
})

// The card names the PREVIOUS period, so it opens the previous one. Opening the
// current one showed an empty Stats page on a Monday or the 1st (#530).
describe('recapStatsPeriod', () => {
    it('opens last week for a weekly card', () => {
        expect(recapStatsPeriod('week')).toBe('lastweek')
    })

    it('opens last month for a monthly card', () => {
        expect(recapStatsPeriod('month')).toBe('lastmonth')
    })
})
