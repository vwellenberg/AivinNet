import { describe, expect, it } from 'vitest'

import { CARD_GAP, CARD_MIN, CARD_MIN_PHONE, cardColumns } from '../cardColumns'

/**
 * The CSS truth this util must mirror: `repeat(auto-fill, minmax(min, 1fr))`
 * with a column gap creates the largest N with N*min + (N-1)*gap <= width.
 * (css-grid-2 §7.2.3 — auto-fill takes as many tracks as fit.)
 */
function cssAutoFillColumns(width: number, min: number, gap: number): number {
    let n = 1
    while ((n + 1) * min + n * gap <= width) n++
    return n
}

describe('cardColumns', () => {
    it('matches the CSS auto-fill column count for every desktop width', () => {
        // One-row scrollers render exactly `cardColumns` cards: one card more
        // than the CSS column count and the surplus wraps into a second row.
        for (let width = 200; width <= 2400; width++) {
            expect(cardColumns(width, 1920), `grid width ${width}px`).toBe(
                cssAutoFillColumns(width, CARD_MIN, CARD_GAP)
            )
        }
    })

    it('matches the CSS auto-fill column count on medium phones (9rem cards)', () => {
        for (let width = 150; width <= 460; width++) {
            expect(cardColumns(width, 400), `grid width ${width}px`).toBe(
                cssAutoFillColumns(width, CARD_MIN_PHONE, CARD_GAP)
            )
        }
    })

    it('regression: half-width screens get one row, not two', () => {
        // 864px of content fits exactly 4 columns (4*192 + 3*32 = 864). The
        // old `Math.round(width / cardWidth)` heuristic said 5 cards here —
        // round(864/192) = 5, and 5 with the unmeasured 161.6px default —
        // which wrapped "Recently played" into a second row.
        expect(cardColumns(864, 1920)).toBe(4)
        expect(Math.round(864 / CARD_MIN)).toBe(5) // what the old formula did
    })

    it('never drops below one column', () => {
        expect(cardColumns(0, 1920)).toBe(1)
        expect(cardColumns(120, 1920)).toBe(1)
    })

    it('switches the card minimum on the mediumPhones viewport breakpoint', () => {
        // Same grid width, different viewport: ≤460px viewports use the 9rem
        // minimum from the mediumPhones media query override.
        expect(cardColumns(358, 460)).toBe(2)
        expect(cardColumns(358, 461)).toBe(1)
    })
})
