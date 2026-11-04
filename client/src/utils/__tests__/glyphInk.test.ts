import { afterEach, describe, expect, it, vi } from 'vitest'

import { inkGap, inkGapBelow, lowestInkRow } from '@/utils/glyphInk'

// The vampire floated a few px above the cover ("schwebt etwas über der Kachel",
// user, 2026-11-04): its emoji font leaves empty room under the picture. The gap is
// measured: the baseline from the layout, the ink from a canvas. The canvas part
// is pinned here with a stub (jsdom draws nothing); the numbers were checked
// against a screenshot of the real overlay in Chromium.

/** RGBA data of `width` x `height`, with ink (alpha 255) in the given rows. */
function rgba(width: number, height: number, inkRows: number[], alpha = 255): Uint8ClampedArray {
    const data = new Uint8ClampedArray(width * height * 4)
    for (const y of inkRows) data[(y * width + Math.floor(width / 2)) * 4 + 3] = alpha
    return data
}

describe('lowestInkRow', () => {
    it('finds the lowest painted row', () => {
        expect(lowestInkRow(rgba(4, 10, [2, 3, 6]), 4, 10)).toBe(6)
    })

    it('is -1 for an empty canvas', () => {
        expect(lowestInkRow(rgba(4, 10, []), 4, 10)).toBe(-1)
    })

    it('does not count the faint edge of anti-aliasing as ink', () => {
        const data = rgba(4, 10, [3])
        data[(8 * 4 + 1) * 4 + 3] = 10
        expect(lowestInkRow(data, 4, 10)).toBe(3)
    })
})

describe('inkGap', () => {
    it('is the room between the ink and the bottom of the box', () => {
        // The box ends 9 px below the baseline, the ink 3 px above it.
        expect(inkGap(9, -3)).toBe(12)
    })

    it('is 0 when the ink reaches the box bottom or past it (Noto: it does)', () => {
        expect(inkGap(9, 9)).toBe(0)
        expect(inkGap(9, 12)).toBe(0)
    })
})

describe('inkGapBelow', () => {
    afterEach(() => {
        vi.restoreAllMocks()
        document.body.innerHTML = ''
    })

    /** A figure whose box bottom is 9 px below the baseline marker's. */
    function figure(text: string): HTMLElement {
        const el = document.createElement('span')
        el.textContent = text
        el.style.fontSize = '56px'
        document.body.appendChild(el)
        const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
        spy.mockImplementation(function (this: HTMLElement) {
            return { bottom: this === el ? 109 : 100 } as DOMRect
        })
        return el
    }

    /** A canvas whose glyph ink ends `inkBelow` px under the baseline the code draws on. */
    function stubCanvas(inkBelow: number) {
        const ctx = {
            canvas: { width: 0, height: 0 },
            font: '',
            textBaseline: '',
            fillText: vi.fn(),
            getImageData: (_x: number, _y: number, w: number, h: number) => {
                const base = Math.round(56 * 2)
                return { data: rgba(w, h, [base + inkBelow - 1]) }
            },
        }
        return vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
    }

    it('measures the gap a font leaves under its emoji, and leaves no marker behind', () => {
        stubCanvas(-4)
        const el = figure('🧛')
        expect(inkGapBelow(el)).toBe(13)
        expect(el.childNodes).toHaveLength(1)
    })

    it('is 0 without a canvas (the figure stays where its box puts it)', () => {
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
        expect(inkGapBelow(figure('⛄'))).toBe(0)
    })

    it('is 0 for an element without text', () => {
        expect(inkGapBelow(figure(''))).toBe(0)
    })
})
