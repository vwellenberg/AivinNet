import { describe, expect, it } from 'vitest'

import { normalizeUiFont } from '../uiFont'

describe('normalizeUiFont', () => {
    it('keeps Figtree on for a browser that chose it before the rename', () => {
        expect(normalizeUiFont('spotify')).toBe('figtree')
    })

    it('passes current values through', () => {
        expect(normalizeUiFont('figtree')).toBe('figtree')
        expect(normalizeUiFont('default')).toBe('default')
    })

    it('falls back to the default for anything unknown', () => {
        expect(normalizeUiFont(undefined)).toBe('default')
        expect(normalizeUiFont('comic-sans')).toBe('default')
    })
})
