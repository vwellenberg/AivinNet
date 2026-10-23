import { describe, expect, it, vi } from 'vitest'

import {
    LISTENERS,
    albumLine,
    bandPhrase,
    dayLabel,
    listened,
    listenerText,
    minutes,
    names,
    percent,
    playCount,
    trackLine,
    announcedOnHome,
    newYearBurst,
    rewindDoor,
} from '../rewind'

describe('listenerText', () => {
    it('names every kind the server sends', () => {
        // lib/listening_sources.py::source_kind, minus "other" (never the listener).
        for (const kind of ['album', 'playlist', 'artist', 'folder', 'search', 'favorites', 'home']) {
            expect(LISTENERS[kind], kind).toBeDefined()
        }
    })

    it('turns the share into a percentage', () => {
        expect(listenerText({ kind: 'album', share: 0.75 })).toMatchObject({ title: 'The album listener', share: '75%' })
    })

    it('says nothing for a kind it does not know, inherited names included', () => {
        expect(listenerText({ kind: 'constructor', share: 1 })).toBeNull()
        expect(listenerText(null)).toBeNull()
    })
})

describe('words', () => {
    it('reads the time of day', () => {
        expect(bandPhrase('evenings')).toBe('in the evening')
        expect(bandPhrase('toString')).toBe('')
    })

    it('reads the numbers', () => {
        expect(minutes(740_700)).toBe('12,345')
        expect(listened(38 * 3600 + 12 * 60)).toBe('38 h 12 min')
        expect(listened(45 * 60)).toBe('45 min')
        expect(percent(0.333)).toBe('33%')
        expect(playCount(1)).toBe('1 play')
        expect(playCount(1234)).toBe('1,234 plays')
    })

    it('leaves no dangling separator when an album names no artist', () => {
        expect(albumLine({ albumartists: [{ name: 'RHCP', artisthash: 'a' }], seconds: 7200 })).toBe('RHCP · 2 h')
        expect(albumLine({ albumartists: [], seconds: 7200 })).toBe('2 h')
    })

    it('reads a server date in UTC', () => {
        // A browser west of UTC would otherwise show Friday, May 3.
        expect(dayLabel('2026-05-02')).toBe('Saturday, May 2')
    })

    it('names a track and a list of artists', () => {
        expect(trackLine({ title: 'Blue', artists: [{ name: 'The Artist', artisthash: 'a' }] })).toBe('Blue — The Artist')
        expect(names([{ name: 'RHCP' }, { name: 'Primus' }, { name: 'Tool' }])).toBe('RHCP, Primus and Tool')
        expect(names([{ name: 'RHCP' }])).toBe('RHCP')
        expect(names([])).toBe('')
    })
})

describe('rewindDoor (#572)', () => {
    it('opens the year that ended on January 1, if it has a Rewind', () => {
        expect(rewindDoor('2026-01-01', [2024, 2025])).toBe(2025)
        expect(rewindDoor('2026-01-01', [2024])).toBeNull()
        expect(rewindDoor('2026-01-02', [2025])).toBeNull()
        expect(rewindDoor('2025-12-01', [2024])).toBeNull()
    })
})

describe('announcedOnHome (#572)', () => {
    it('announces a fresh Rewind in January only', () => {
        expect(announcedOnHome(2025, new Date(2026, 0, 1))).toBe(2025)
        expect(announcedOnHome(2025, new Date(2026, 0, 31, 23))).toBe(2025)
        expect(announcedOnHome(2025, new Date(2026, 1, 1))).toBeNull()
        // Seen, or nothing to announce.
        expect(announcedOnHome(null, new Date(2026, 0, 5))).toBeNull()
        expect(announcedOnHome(undefined, new Date(2026, 0, 5))).toBeNull()
    })
})

describe('newYearBurst (#572)', () => {
    it('is due once per year on a device', () => {
        localStorage.clear()
        expect(newYearBurst(2025)).toBe(true)
        expect(newYearBurst(2025)).toBe(false)
        expect(newYearBurst(2026)).toBe(true)
        localStorage.clear()
    })

    it('is never due when storage is blocked — better none than one on every visit', () => {
        const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked')
        })
        expect(newYearBurst(2025)).toBe(false)
        get.mockRestore()
    })
})
