import { describe, expect, it } from 'vitest'

import {
    SHORTCUTS,
    chordText,
    chordTokens,
    platformOf,
    quickPlayHint,
    shortcutText,
    withKey,
} from '../shortcuts'

describe('platformOf', () => {
    it('reads the Mac from the platform string', () => {
        expect(platformOf({ platform: 'MacIntel' })).toBe('mac')
    })

    it('treats iPad and iPhone as Mac, since they use the command key', () => {
        expect(platformOf({ platform: 'iPad' })).toBe('mac')
        expect(platformOf({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' })).toBe('mac')
    })

    it('is everything else otherwise', () => {
        expect(platformOf({ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0)' })).toBe('other')
        expect(platformOf({ platform: 'Linux x86_64' })).toBe('other')
        expect(platformOf(null)).toBe('other')
    })
})

describe('formatter on Mac and elsewhere', () => {
    it('shows the command glyph for Mod shortcuts on Mac, Ctrl elsewhere', () => {
        expect(chordTokens(['Mod', 'P'], 'mac')).toEqual(['⌘', 'P'])
        expect(chordTokens(['Mod', 'P'], 'other')).toEqual(['Ctrl', 'P'])
        expect(chordText(['Mod', 'F'], 'mac')).toBe('⌘F')
        expect(chordText(['Mod', 'F'], 'other')).toBe('Ctrl+F')
    })

    it('keeps Ctrl literal on Mac for shortcuts that only accept ctrlKey', () => {
        expect(chordText(['Ctrl', 'B'], 'mac')).toBe('Ctrl+B')
        expect(chordText(['Ctrl', '←'], 'mac')).toBe('Ctrl+←')
    })

    it('joins other keys with +', () => {
        expect(chordText(['Shift', 'Enter'], 'mac')).toBe('Shift+Enter')
        expect(chordText(['Shift', 'Enter'], 'other')).toBe('Shift+Enter')
    })

    it('puts the key in brackets on a tooltip label', () => {
        expect(withKey('Previous', 'prev', 'other')).toBe('Previous (←)')
        expect(withKey('Next', 'next', 'other')).toBe('Next (→)')
        expect(withKey('Play', 'playPause', 'other')).toBe('Play (Space)')
        expect(withKey('Pause', 'playPause', 'mac')).toBe('Pause (Space)')
    })

    it('gives the sidebar toggle the same text its setting description always had', () => {
        expect(shortcutText('sidebar', 'other')).toBe('Ctrl+B')
        expect(shortcutText('find', 'mac')).toBe('⌘F')
    })
})

describe('the list itself', () => {
    it('has unique ids and at least one chord per entry', () => {
        const ids = SHORTCUTS.map(s => s.id)
        expect(new Set(ids).size).toBe(ids.length)
        for (const s of SHORTCUTS) {
            expect(s.chords.length).toBeGreaterThan(0)
            expect(s.description.length).toBeGreaterThan(0)
        }
    })

    it('shows the quick play box keys in the footer line, in list order', () => {
        expect(quickPlayHint('other')).toBe('Enter play · Shift+Enter play next · Esc close')
    })
})
