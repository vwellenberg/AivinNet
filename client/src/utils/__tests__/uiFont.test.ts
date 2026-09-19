import { describe, expect, it } from 'vitest'

import { normalizeUiFont } from '../uiFont'

describe('normalizeUiFont', () => {
    it('keeps Figtree on for a browser that chose it before the rename', () => {
        // Stand-in for the pre-rename value: the second option was the only
        // non-default one there ever was.
        expect(normalizeUiFont('pre-rename-value')).toBe('figtree')
    })

    it('passes current values through', () => {
        expect(normalizeUiFont('figtree')).toBe('figtree')
        expect(normalizeUiFont('default')).toBe('default')
    })

    it('falls back to the default for a missing or broken value', () => {
        expect(normalizeUiFont(undefined)).toBe('default')
        expect(normalizeUiFont(null)).toBe('default')
        expect(normalizeUiFont('')).toBe('default')
        expect(normalizeUiFont(42)).toBe('default')
    })
})
