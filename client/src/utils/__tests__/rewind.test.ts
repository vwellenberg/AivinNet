import { describe, expect, it } from 'vitest'

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
} from '../rewind'

describe('listenerText', () => {
    it('names every kind the server sends', () => {
        // lib/rewind.py::source_kind, minus "other" (never the listener).
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
