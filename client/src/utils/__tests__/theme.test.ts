import { describe, expect, it } from 'vitest'

import { LOOKS, fixedMode, lookHasModes, normalizeLook, themeBodyClasses } from '../theme'
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
