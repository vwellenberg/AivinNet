import { describe, expect, it } from 'vitest'

import { formatsText, nonstopText, percentText } from '@/utils/libraryStats'

describe('percentText', () => {
    it('rounds a share to a whole percent', () => {
        expect(percentText(0.34)).toBe('34 %')
        expect(percentText(0.999)).toBe('100 %')
        expect(percentText(0)).toBe('0 %')
    })

    it('has nothing to say without a library', () => {
        expect(percentText(null)).toBe('—')
        expect(percentText(undefined)).toBe('—')
    })
})

describe('nonstopText', () => {
    it('counts whole days once there are days', () => {
        expect(nonstopText(23 * 86400 + 4000)).toBe('23 days')
        expect(nonstopText(86400)).toBe('1 day')
    })

    it('shows hours and minutes below a day', () => {
        expect(nonstopText(5 * 3600 + 12 * 60)).toBe('5 hrs 12 mins')
        expect(nonstopText(3600 + 60)).toBe('1 hr 1 min')
    })

    it('shows minutes below an hour, and zero as zero minutes', () => {
        expect(nonstopText(40 * 60)).toBe('40 mins')
        expect(nonstopText(60)).toBe('1 min')
        expect(nonstopText(0)).toBe('0 mins')
    })

    it('reads a negative or fractional length as a whole, non-negative one', () => {
        expect(nonstopText(-5)).toBe('0 mins')
        expect(nonstopText(59.9)).toBe('0 mins')
    })
})

describe('formatsText', () => {
    it('lists each format with its share, in the order given', () => {
        expect(
            formatsText([
                { format: 'FLAC', share: 0.45 },
                { format: 'MP3', share: 0.4 },
            ])
        ).toBe('FLAC 45 % · MP3 40 %')
    })

    it('is empty for an empty library', () => {
        expect(formatsText([])).toBe('')
    })
})
