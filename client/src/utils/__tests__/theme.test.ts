import { describe, expect, it } from 'vitest'

import {
    LOOKS,
    PALETTES,
    fixedMode,
    lookHasModes,
    lookHasPalettes,
    normalizeLook,
    normalizePalette,
    paletteHtmlClasses,
    themeBodyClasses,
} from '../theme'
import appearance from '../../settings/general/theme'

describe('themeBodyClasses', () => {
    it('Memphis light carries no theme class', () => {
        expect(themeBodyClasses('memphis', 'light')).toEqual({ 'theme-dark': false, 'theme-stream': false })
    })

    it('Memphis dark is the dark class alone', () => {
        expect(themeBodyClasses('memphis', 'dark')).toEqual({ 'theme-dark': true, 'theme-stream': false })
    })

    it('Stream is dark whatever the stored mode says', () => {
        // Every component's dark-ground answer lives under body.theme-dark;
        // Stream reshapes that, it does not re-answer it.
        const stream = { 'theme-dark': true, 'theme-stream': true }
        expect(themeBodyClasses('stream', 'light')).toEqual(stream)
        expect(themeBodyClasses('stream', 'dark')).toEqual(stream)
    })

    it('lists every class for every combination, so switching away clears them', () => {
        const modes = ['light', 'dark'] as const
        const keys = LOOKS.flatMap((l) => modes.map((m) => Object.keys(themeBodyClasses(l, m)).sort().join()))
        expect(new Set(keys).size).toBe(1)
    })
})

describe('lookHasModes', () => {
    it('Memphis has light and dark, Stream only dark', () => {
        expect(lookHasModes('memphis')).toBe(true)
        expect(lookHasModes('stream')).toBe(false)
        expect(fixedMode('memphis')).toBe(null)
        expect(fixedMode('stream')).toBe('dark')
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

    it('brings a parked look back to Memphis (#241, #259)', () => {
        // Desktop 98 and Virtual Grid were live for a few days; whoever picked
        // one has it stored, and would otherwise get a body with no look class.
        expect(normalizeLook('desktop98')).toBe('memphis')
        expect(normalizeLook('virtualgrid')).toBe('memphis')
    })
})

describe('the Theme setting', () => {
    const options = appearance.find((s) => s.title === 'Theme')?.options ?? []

    it('offers exactly the looks this build knows', () => {
        // An option whose value normalizeLook does not know would be stored
        // and then silently turned back into Memphis on the next load.
        expect(options.map((o) => o.value).sort()).toEqual([...LOOKS].sort())
    })

    it('shows Stream as "Boring" but still stores `stream`', () => {
        // The rename is the label only: every saved choice says `stream`, and
        // a value renamed to match the label would drop those users to Memphis.
        expect(options.find((o) => o.title === 'Boring')?.value).toBe('stream')
    })
})

describe('colour schemes (#395)', () => {
    it('Memphis carries no palette class, every other scheme exactly its own', () => {
        expect(Object.values(paletteHtmlClasses('memphis', 'memphis')).some(Boolean)).toBe(false)
        for (const palette of PALETTES.filter((p) => p !== 'memphis')) {
            const on = Object.entries(paletteHtmlClasses('memphis', palette)).filter(([, v]) => v)
            expect(on).toEqual([[`palette-${palette}`, true]])
        }
    })

    it('lists every class for every scheme, so switching clears the last one', () => {
        const keys = PALETTES.map((p) => Object.keys(paletteHtmlClasses('memphis', p)).sort().join())
        expect(new Set(keys).size).toBe(1)
        expect(keys[0].split(',')).toHaveLength(PALETTES.length - 1)
    })

    it('Boring wears no scheme, and the stored one waits for Memphis', () => {
        // Boring has its own ground; a scheme block would outrank it.
        expect(lookHasPalettes('stream')).toBe(false)
        for (const palette of PALETTES) {
            expect(Object.values(paletteHtmlClasses('stream', palette)).some(Boolean)).toBe(false)
        }
        expect(lookHasPalettes('memphis')).toBe(true)
    })

    it('normalizePalette keeps known schemes and falls back to Memphis', () => {
        for (const palette of PALETTES) expect(normalizePalette(palette)).toBe(palette)
        expect(normalizePalette('neon')).toBe('memphis')
        expect(normalizePalette(undefined)).toBe('memphis')
    })
})

describe('the Colour scheme setting', () => {
    const setting = appearance.find((s) => s.title === 'Colour scheme')

    it('sits right after Theme', () => {
        const titles = appearance.map((s) => s.title)
        expect(titles.indexOf('Colour scheme')).toBe(titles.indexOf('Theme') + 1)
    })

    it('offers exactly the schemes this build knows', () => {
        // Same reason as for the looks: an unknown stored value would quietly
        // turn back into Memphis on the next load.
        expect((setting?.options ?? []).map((o) => o.value)).toEqual([...PALETTES])
    })
})
