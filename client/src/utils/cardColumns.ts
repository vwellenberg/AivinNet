/**
 * The column count CSS will actually produce for a one-row card grid
 * (`repeat(auto-fill, minmax($cardwidth, 1fr))` with a 2rem column gap).
 *
 * A one-row scroller must render EXACTLY as many cards as the grid has
 * columns: one more and the surplus card wraps into a second row. auto-fill
 * fits the largest N with `N*min + (N-1)*gap <= width`, which is
 * `floor((width + gap) / (min + gap))` — anything derived from a measured
 * card width instead (the old `Math.round(width / cardWidth)`) overshoots
 * near the minimum (e.g. 864px content: 4 columns, but round(864/192) = 5,
 * so "Recently played" broke into two rows on half-width screens).
 *
 * The constants mirror the SCSS and must move with it:
 * `$cardwidth: 12rem` and the `$card-col-gap: 2rem` column gap every card
 * grid reads (_variables.scss), 9rem under `mediumPhones` (≤460px,
 * _mixins.scss). The pair is tied together by
 * components/__tests__/cardGridGap.test.ts.
 */
export const CARD_MIN = 192
export const CARD_MIN_PHONE = 144
export const CARD_GAP = 32
export const MEDIUM_PHONE_MAX = 460

export function cardColumns(gridWidth: number, viewportWidth: number): number {
    const min = viewportWidth <= MEDIUM_PHONE_MAX ? CARD_MIN_PHONE : CARD_MIN
    return Math.max(1, Math.floor((gridWidth + CARD_GAP) / (min + CARD_GAP)))
}
