import { describe, expect, it } from 'vitest'

import { LOOKS, lookHasModes, themeBodyClasses } from '../theme'

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
        expect(themeBodyClasses('stream', 'light')).toEqual({ 'theme-dark': true, 'theme-stream': true })
        expect(themeBodyClasses('stream', 'dark')).toEqual({ 'theme-dark': true, 'theme-stream': true })
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
    })
})
