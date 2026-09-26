import { describe, expect, it } from 'vitest'

import { LOOKS, fixedMode, lookHasModes, normalizeLook, themeBodyClasses } from '../theme'

describe('themeBodyClasses', () => {
    it('Memphis light carries no theme class', () => {
        expect(themeBodyClasses('memphis', 'light')).toEqual({ 'theme-dark': false, 'theme-stream': false, 'theme-desktop98': false })
    })

    it('Memphis dark is the dark class alone', () => {
        expect(themeBodyClasses('memphis', 'dark')).toEqual({ 'theme-dark': true, 'theme-stream': false, 'theme-desktop98': false })
    })

    it('Stream is dark whatever the stored mode says', () => {
        // Every component's dark-ground answer lives under body.theme-dark;
        // Stream reshapes that, it does not re-answer it.
        expect(themeBodyClasses('stream', 'light')).toEqual({ 'theme-dark': true, 'theme-stream': true, 'theme-desktop98': false })
        expect(themeBodyClasses('stream', 'dark')).toEqual({ 'theme-dark': true, 'theme-stream': true, 'theme-desktop98': false })
    })

    it('Desktop 98 is light whatever the stored mode says (#241)', () => {
        const light = { 'theme-dark': false, 'theme-stream': false, 'theme-desktop98': true }
        expect(themeBodyClasses('desktop98', 'light')).toEqual(light)
        expect(themeBodyClasses('desktop98', 'dark')).toEqual(light)
    })

    it('lists every class for every combination, so switching away clears them', () => {
        const modes = ['light', 'dark'] as const
        const keys = LOOKS.flatMap((l) => modes.map((m) => Object.keys(themeBodyClasses(l, m)).sort().join()))
        expect(new Set(keys).size).toBe(1)
    })
})

describe('lookHasModes', () => {
    it('Memphis has light and dark, Stream only dark, Desktop 98 only light', () => {
        expect(lookHasModes('memphis')).toBe(true)
        expect(lookHasModes('stream')).toBe(false)
        expect(lookHasModes('desktop98')).toBe(false)
        expect(fixedMode('stream')).toBe('dark')
        expect(fixedMode('desktop98')).toBe('light')
    })
})

describe('normalizeLook', () => {
    it('keeps every look this build knows', () => {
        for (const look of LOOKS) expect(normalizeLook(look)).toBe(look)
    })

    it('falls back to Memphis for a look it does not know', () => {
        // Stored by a newer build, or removed since: the body would carry no
        // look class at all.
        expect(normalizeLook('vaporwave')).toBe('memphis')
        expect(normalizeLook(undefined)).toBe('memphis')
        expect(normalizeLook(42)).toBe('memphis')
    })
})
