/**
 * The vampire that peeks over a cover (components/SeasonVampire.vue): when it
 * comes, which cover it takes, and how long the whole peek lasts. Pure: the
 * random source is passed in, so a test can pin it. The motion is CSS.
 */
import type { ViewportSize } from './seasonTileEmojis'

/** Gap between two peeks, in ms: random in [MIN, MAX). */
export const PEEK_DELAY_MIN_MS = 40000
export const PEEK_DELAY_MAX_MS = 80000

/** The emoji's size, in px. The peek needs this much room above a cover. */
export const PEEK_SIZE_PX = 56

/**
 * One whole peek, in ms. The CSS keyframes are percentages of this, so it is
 * the one number the animation needs: rise (first ~18 %), a pause of about a
 * second, the puff, and the bat leaving.
 */
export const PEEK_DURATION_MS = 3200

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
