import { describe, expect, it } from 'vitest'

import { FADE_MS, fadeGain, formatRemaining, stopsBeforeTrack } from '@/utils/sleepTimer'

const t = (albumhash: string): any => ({ trackhash: albumhash, albumhash })

describe('sleep timer: fade curve', () => {
    it('starts at full level, is silent at the end, and is linear between', () => {
        expect(fadeGain(0)).toBe(1)
        expect(fadeGain(FADE_MS / 2)).toBeCloseTo(0.5, 6)
        expect(fadeGain(FADE_MS)).toBe(0)
        expect(fadeGain(FADE_MS * 3)).toBe(0)
    })

    it('treats a bad elapsed time as the start, never as silence', () => {
        expect(fadeGain(Number.NaN)).toBe(1)
        expect(fadeGain(-5)).toBe(1)
    })
})

describe('sleep timer: where playback stops', () => {
    it('end of song stops at any boundary', () => {
        expect(stopsBeforeTrack({ kind: 'song' }, t('A'), t('A'))).toBe(true)
        expect(stopsBeforeTrack({ kind: 'song' }, t('A'), t('B'))).toBe(true)
    })

    it('end of album stops only when the album changes', () => {
        expect(stopsBeforeTrack({ kind: 'album' }, t('A'), t('A'))).toBe(false)
        expect(stopsBeforeTrack({ kind: 'album' }, t('A'), t('B'))).toBe(true)
        expect(stopsBeforeTrack({ kind: 'album' }, t('A'), undefined)).toBe(false)
    })

    it('minute timers and no timer never stop at a boundary', () => {
        expect(stopsBeforeTrack({ kind: 'minutes', minutes: 30 }, t('A'), t('B'))).toBe(false)
        expect(stopsBeforeTrack(null, t('A'), t('B'))).toBe(false)
    })
})

describe('sleep timer: indicator label', () => {
    it('rounds up to whole minutes and never shows 0', () => {
        expect(formatRemaining(15 * 60_000)).toBe('15 min')
        expect(formatRemaining(14 * 60_000 + 1)).toBe('15 min')
        expect(formatRemaining(1)).toBe('1 min')
        expect(formatRemaining(0)).toBe('1 min')
    })
})
