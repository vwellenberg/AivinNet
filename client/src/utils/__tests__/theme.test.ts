import { describe, expect, it } from 'vitest'

import { LOOKS, fixedMode, lookHasModes, normalizeLook, themeBodyClasses } from '../theme'

describe('themeBodyClasses', () => {
    it('Memphis light carries no theme class', () => {
        expect(themeBodyClasses('memphis', 'light')).toEqual({ 'theme-dark': false, 'theme-stream': false, 'theme-desktop98': false, 'theme-virtualgrid': false })
    })

    it('Memphis dark is the dark class alone', () => {
        expect(themeBodyClasses('memphis', 'dark')).toEqual({ 'theme-dark': true, 'theme-stream': false, 'theme-desktop98': false, 'theme-virtualgrid': false })
    })

    it('Stream is dark whatever the stored mode says', () => {
        // Every component's dark-ground answer lives under body.theme-dark;
        // Stream reshapes that, it does not re-answer it.
        const stream = { 'theme-dark': true, 'theme-stream': true, 'theme-desktop98': false, 'theme-virtualgrid': false }
        expect(themeBodyClasses('stream', 'light')).toEqual(stream)
        expect(themeBodyClasses('stream', 'dark')).toEqual(stream)
    })

    it('Desktop 98 is light whatever the stored mode says (#241)', () => {
        const light = { 'theme-dark': false, 'theme-stream': false, 'theme-desktop98': true, 'theme-virtualgrid': false }
        expect(themeBodyClasses('desktop98', 'light')).toEqual(light)
        expect(themeBodyClasses('desktop98', 'dark')).toEqual(light)
    })

    it('Virtual Grid is dark whatever the stored mode says (#259)', () => {
        // Built on the dark classes like Stream, but without Stream's own.
        const dark = { 'theme-dark': true, 'theme-stream': false, 'theme-desktop98': false, 'theme-virtualgrid': true }
        expect(themeBodyClasses('virtualgrid', 'light')).toEqual(dark)
        expect(themeBodyClasses('virtualgrid', 'dark')).toEqual(dark)
    })

    it('lists every class for every combination, so switching away clears them', () => {
        const modes = ['light', 'dark'] as const
        const keys = LOOKS.flatMap((l) => modes.map((m) => Object.keys(themeBodyClasses(l, m)).sort().join()))
        expect(new Set(keys).size).toBe(1)
    })
})

describe('lookHasModes', () => {
    it('Memphis has light and dark, Stream and Virtual Grid only dark, Desktop 98 only light', () => {
        expect(lookHasModes('memphis')).toBe(true)
        expect(lookHasModes('stream')).toBe(false)
        expect(lookHasModes('desktop98')).toBe(false)
        expect(fixedMode('stream')).toBe('dark')
        expect(fixedMode('desktop98')).toBe('light')
        expect(lookHasModes('virtualgrid')).toBe(false)
        expect(fixedMode('virtualgrid')).toBe('dark')
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
