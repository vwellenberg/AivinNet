import { ref } from 'vue'

/**
 * The cover-tile size (Settings → Appearance → Tile size): the MINIMUM column
 * width of every card grid, in px. The grids are
 * `repeat(auto-fill, minmax(<size>, 1fr))`, so the size decides how many tiles
 * fit a row; the tiles then stretch to share the rest.
 *
 * One number, two places that must agree:
 *  - CSS reads it as `--tile-min` / `--tile-min-phone` (`$cardwidth`,
 *    `$cardwidth-phone` in _variables.scss), written by `applyTileSize`.
 *  - JS counts the columns CSS will build (utils/cardColumns.ts) so a one-row
 *    scroller renders exactly as many cards as fit — it reads `tileSize`.
 *
 * The default is the old fixed `$cardwidth: 12rem`; at the default NO property
 * is written, so an untouched install renders byte-for-byte what it did before.
 */
export const TILE_MIN = 128
export const TILE_MAX = 288
export const TILE_STEP = 8
export const TILE_DEFAULT = 192

/** Phones get a fixed share of the chosen size (default: 192 → 144 = the old 9rem). */
const PHONE_SHARE = 0.75

export function phoneTileSize(size: number): number {
    return Math.round(size * PHONE_SHARE)
}

/**
 * Map a persisted value onto a valid one. The settings store is restored from
 * localStorage, so a hand-edited, truncated or older value must not reach CSS
 * as `NaNpx` (which the browser drops, leaving grids with no minimum at all).
 */
export function normalizeTileSize(value: unknown): number {
    const n = typeof value === 'number' ? value : Number.NaN
    if (!Number.isFinite(n)) return TILE_DEFAULT

    const snapped = Math.round(n / TILE_STEP) * TILE_STEP
    return Math.min(TILE_MAX, Math.max(TILE_MIN, snapped))
}

/** The live value JS-side column maths read. Kept in step by `applyTileSize`. */
export const tileSize = ref(TILE_DEFAULT)

export function applyTileSize(value: unknown, root: HTMLElement = document.documentElement) {
    const size = normalizeTileSize(value)
    tileSize.value = size

    if (size === TILE_DEFAULT) {
        root.style.removeProperty('--tile-min')
        root.style.removeProperty('--tile-min-phone')
        return
    }

    root.style.setProperty('--tile-min', `${size}px`)
    root.style.setProperty('--tile-min-phone', `${phoneTileSize(size)}px`)
}
