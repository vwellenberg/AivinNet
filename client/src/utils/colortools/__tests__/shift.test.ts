import { describe, expect, it } from 'vitest'
import { brightness } from '@nextcss/color-tools'

import { colorShift, getShift } from '../shift'
import { getTypeColor } from '../index'

// Expected values were produced by @nextcss/color-tools 1.0.7 (master) and
// must stay identical on 2.x. The threshold `brightness > 50` decides which
// multiplier applies, so the mid-grey cases pin both sides of it.

describe('brightness (perceived luminance, 0–100)', () => {
    it.each([
        ['#aabbcc', 72],
        ['#1d9e75', 50],
        ['#808080', 50],
        ['#777777', 47],
        ['#7a7a7a', 48],
        ['#3a3a3a', 23],
        ['#ff284e', 35],
        ['#ffff00', 93],
    ])('%s -> %i', (hex, expected) => {
        expect(brightness(hex)).toBe(expected)
    })
})

describe('colorShift (positive darkens, negative lightens)', () => {
    it.each([
        ['#aabbcc', 20, '#8896a3'],
        ['#aabbcc', -20, '#bbc9d6'],
        ['#aabbcc', -50, '#d5dde6'],
        ['#1d9e75', 20, '#177e5e'],
        ['#1d9e75', -20, '#4ab191'],
        ['#ff284e', 20, '#cc203e'],
        ['#ff284e', -20, '#ff5371'],
        ['#ffffff', 50, '#808080'],
        ['#ffff00', -20, '#ffff33'],
        // 3-digit and alpha forms keep their shape, as in v1
        ['#abc', 20, '#8896a3'],
        ['#aabbcc80', 20, '#8896a380'],
    ])('%s by %i -> %s', (hex, amount, expected) => {
        expect(colorShift(hex, amount)).toBe(expected)
    })

    it('returns undefined for anything unparseable, as v1 did', () => {
        expect(colorShift('#zzzzzz', 20)).toBeUndefined()
        expect(colorShift('', 20)).toBeUndefined()
        expect(colorShift('rgb(1,2,3)', 20)).toBeUndefined()
    })
})

describe('getShift', () => {
    it('lightens dark colours and darkens light ones', () => {
        // light (72): multiplier[0] = -50 -> lighter
        expect(getShift('#aabbcc', [-50, 50])).toBe('#d5dde6')
        // dark (23): multiplier[1] = 50 -> darker
        expect(getShift('#3a3a3a', [-50, 50])).toBe('#1d1d1d')
        // exactly 50 is not light
        expect(getShift('#808080', [-50, 50])).toBe('#404040')
    })

    it('accepts rgb() input', () => {
        expect(getShift('rgb(170, 187, 204)', [-50, 50])).toBe('#d5dde6')
    })

    it('returns an empty string for an empty colour', () => {
        expect(getShift('', [-50, 50])).toBe('')
    })
})

describe('getTypeColor', () => {
    it('picks the light or dark type colour by brightness', () => {
        expect(getTypeColor('#ffff00')).toBe('rgb(109, 69, 16)')
        expect(getTypeColor('#3a3a3a')).toBe('#ac8e68')
    })

    it('falls back to the dark colour when brightness is unknown', () => {
        expect(getTypeColor('')).toBe('#ac8e68')
    })
})
