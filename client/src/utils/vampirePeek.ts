/**
 * The figure that peeks over a cover (components/SeasonVampire.vue): when it
 * comes, which cover it takes, and how long the whole peek lasts. Pure: the
 * random source is passed in, so a test can pin it. The motion is CSS.
 *
 * One peek per season (`PEEK_SPECS`): the Halloween vampire puffs into a bat that
 * flies off; the Christmas snowman just rises and sinks back down.
 */
import type { ViewportSize } from './seasonTileEmojis'
import type { Season } from './seasons'

/** Gap between two peeks, in ms: random in [MIN, MAX). */
export const PEEK_DELAY_MIN_MS = 40000
export const PEEK_DELAY_MAX_MS = 80000

/** The emoji's size, in px. The peek needs this much room above a cover. */
export const PEEK_SIZE_PX = 56

/**
 * One whole peek, in ms. The CSS keyframes are percentages of this, so it is
 * the one number the animation needs: rise (first ~18 %), a pause of about a
 * second, the puff, and the bat leaving.
 *
 * 4000, up from 3200: the bat flew off too fast ("bisserl langsamer", user,
 * 2026-10-31). Only the flight got the extra time — the vampire's rise, pause
 * and the puff keep their milliseconds, so the keyframes in SeasonVampire.vue
 * are the old percentages times 0.8 (= 3200 / 4000). The flight now takes
 * 2.4 s instead of 1.6 s.
 */
export const PEEK_DURATION_MS = 4000

/**
 * The snowman's peek, in ms: it rises, waits, and sinks back down, with no puff
 * and no bat, so it is shorter than the vampire's.
 */
export const SNOWMAN_PEEK_DURATION_MS = 2400

/** What one season's peek shows and how it ends. */
export interface PeekSpec {
    /** The figure that rises from behind the cover. */
    figure: string
    /** Whether it puffs into a bat that flies off (the Halloween peek only). */
    launches: boolean
    /** The whole peek, in ms (the CSS keyframes are percentages of it). */
    durationMs: number
}

export const PEEK_SPECS: Record<Season, PeekSpec> = {
    halloween: { figure: '🧛', launches: true, durationMs: PEEK_DURATION_MS },
    christmas: { figure: '⛄', launches: false, durationMs: SNOWMAN_PEEK_DURATION_MS },
}

/** Milliseconds until the next peek, from the random source. */
export function nextPeekDelayMs(random: () => number): number {
    return PEEK_DELAY_MIN_MS + random() * (PEEK_DELAY_MAX_MS - PEEK_DELAY_MIN_MS)
}

export interface PeekRect {
    top: number
    left: number
    width: number
    height: number
    bottom: number
    right: number
}

/**
 * The index of a cover the vampire can peek over: fully inside the viewport,
 * with room above its top edge for the emoji to rise into. Null when none
 * qualifies (the peek is skipped, not forced).
 */
export function pickPeekTarget(rects: readonly PeekRect[], vp: ViewportSize, random: () => number): number | null {
    const fits: number[] = []
    rects.forEach((r, i) => {
        const inside = r.width > 0 && r.height > 0 && r.top >= PEEK_SIZE_PX && r.left >= 0 && r.bottom <= vp.height && r.right <= vp.width
        if (inside) fits.push(i)
    })
    if (fits.length === 0) return null
    return fits[Math.min(fits.length - 1, Math.floor(random() * fits.length))]
}

/** Where the peek is anchored: the middle of the cover's top edge. */
export function peekAnchor(r: Pick<PeekRect, 'top' | 'left' | 'width'>): { x: number; y: number } {
    return { x: r.left + r.width / 2, y: r.top }
}

/**
 * The fraction of one peek at which the bat takes off (the puff is done): from
 * here on it flies, and a scroll no longer takes the peek away.
 */
export const PEEK_LAUNCH_FRACTION = 0.4

/**
 * Where the bat flies to, relative to the anchor, in px: past BOTH viewport
 * edges on the top-left, with a glyph's width to spare, whatever the anchor.
 * The bat keeps full opacity all the way, so it must leave the screen rather
 * than fade (SeasonVampire.vue, `--peek-exit-x` / `--peek-exit-y`).
 */
export function peekExit(anchor: { x: number; y: number }): { x: number; y: number } {
    return { x: -(anchor.x + PEEK_SIZE_PX), y: -(anchor.y + PEEK_SIZE_PX) }
}
