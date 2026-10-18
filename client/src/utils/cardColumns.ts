import { phoneTileSize, TILE_DEFAULT } from '@/utils/tileSize'

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
 * `$cardwidth` (12rem by default, the user's tile size otherwise — see
 * utils/tileSize.ts) and the `$card-col-gap: 2rem` column gap every card
 * grid reads (_variables.scss), `$cardwidth-phone` under `mediumPhones`
 * (≤460px, _mixins.scss). The pair is tied together by
 * components/__tests__/cardGridGap.test.ts.
 */
export const CARD_MIN = TILE_DEFAULT
export const CARD_MIN_PHONE = phoneTileSize(TILE_DEFAULT)
export const CARD_GAP = 32
export const MEDIUM_PHONE_MAX = 460

/** The column minimum CSS uses at this viewport width for this tile size. */
export function cardMin(viewportWidth: number, tile: number = TILE_DEFAULT): number {
    return viewportWidth <= MEDIUM_PHONE_MAX ? phoneTileSize(tile) : tile
}

export function cardColumns(gridWidth: number, viewportWidth: number, tile: number = TILE_DEFAULT): number {
    const min = cardMin(viewportWidth, tile)
    return Math.max(1, Math.floor((gridWidth + CARD_GAP) / (min + CARD_GAP)))
}
