import { describe, expect, it } from 'vitest'

import { paintedFrac, previewSpan, ratioAt, spanLayer } from '@/utils/rangePreview'

describe('rangePreview', () => {
    it('maps the pointer over the full width of the input, clamped', () => {
        const rect = { left: 100, width: 200 }
        expect(ratioAt(150, rect)).toBeCloseTo(0.25)
        expect(ratioAt(50, rect)).toBe(0)
        expect(ratioAt(400, rect)).toBe(1)
        expect(ratioAt(150, { left: 0, width: 0 })).toBeNull()
    })

    it('spans from the current value to the pointer, either way round', () => {
        expect(previewSpan(0.4, 0.7)).toEqual({ from: 40, to: 70 })
        expect(previewSpan(0.4, 0.1)).toEqual({ from: 10, to: 40 })
        expect(previewSpan(0.4, null)).toBeNull()
    })

    it('textures everything painted: the fill, and the span ahead of it', () => {
        expect(paintedFrac(0.4, 0.7)).toBe(0.7)
        expect(paintedFrac(0.4, 0.1)).toBe(0.4)
        expect(paintedFrac(0.4, null)).toBe(0.4)
    })

    it('writes the span as a leading background layer, nothing without one', () => {
        expect(spanLayer(null, 'yellow')).toBe('')
        const layer = spanLayer({ from: 40, to: 70 }, 'yellow')
        expect(layer).toContain('transparent 40%, yellow 40%, yellow 70%, transparent 70%')
        expect(layer.endsWith(', ')).toBe(true)
    })
})
