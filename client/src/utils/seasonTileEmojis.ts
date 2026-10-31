/**
 * The Halloween emoji on the cover tiles (components/SeasonTileEmojis.vue).
 *
 * They appear one at a time, every few seconds, on a visible cover that has none
 * yet, and pile up to a cap that grows with the number of visible covers. A
 * scroll clears them all (utils/seasonScrolled.ts); then they start again from
 * zero.
 *
 * The emoji is NOT a child element and NOT a Vue-rendered thing: the cover gets
 * two data attributes, and the `::after` of `.card-art` draws the glyph from
 * them (Global/_seasons.scss). The card lists never re-render for it, and a
 * virtual scroller that recycles a cover carries the attribute along, which the
 * scroll reset clears anyway.
 *
 * The pure part (cap, timing, picks) takes its random source as an argument so
 * the tests can pin it. The DOM part is three small functions at the bottom.
 */

/** The attribute the CSS reads as the glyph (`content: attr(...)`). */
export const ATTR_EMOJI = 'data-season-emoji'
/** The attribute that picks the corner. */
export const ATTR_CORNER = 'data-season-corner'

/** Every cover of a card, in any list (the anatomy's artwork box). */
export const COVER_SELECTOR = '.card-art'

/** Spider web, spider, pumpkin, bat, ghost, skull. */
export const TILE_EMOJIS = [
    '\u{1F578}️',
    '\u{1F577}️',
    '🎃',
    '🦇',
    '👻',
    '💀',
] as const

/**
 * The left corners only: the top-right one is the CardStamp's, the bottom-right
 * one is the play button that fades in on hover.
 */
export const TILE_CORNERS = ['tl', 'bl'] as const
export type TileCorner = (typeof TILE_CORNERS)[number]

/** Never more than this many on the page at once, however many covers are visible. */
export const TILE_CAP_MAX = 16
/**
 * Share of the visible covers that may carry one, rounded up: three in four, so
 * the page fills up noticeably ("may get quite a lot", user, 2026-10-31).
 */
export const TILE_CAP_SHARE = 0.75

/** Gap between two new emoji, in ms: random in [MIN, MAX). */
export const TILE_DELAY_MIN_MS = 2000
export const TILE_DELAY_MAX_MS = 6000

/** How many emoji may be on screen, given how many covers are visible. */
export function tileCap(visibleCount: number): number {
    if (visibleCount <= 0) return 0
    return Math.min(TILE_CAP_MAX, Math.ceil(visibleCount * TILE_CAP_SHARE))
}

/** Milliseconds until the next emoji, from the random source. */
export function nextTileDelayMs(random: () => number): number {
    return TILE_DELAY_MIN_MS + random() * (TILE_DELAY_MAX_MS - TILE_DELAY_MIN_MS)
}

/** A card without an emoji, picked at random. Null when every card has one (or there are none). */
export function pickTileTarget<T extends { hasEmoji: boolean }>(cards: T[], random: () => number): T | null {
    const free = cards.filter((c) => !c.hasEmoji)
    if (free.length === 0) return null
    return free[Math.min(free.length - 1, Math.floor(random() * free.length))]
}

/**
 * A random emoji that is not one of `avoid` (the neighbours' emoji), so two
 * next-door covers rarely match. If the avoid list covers every emoji, any one
 * is returned: a repeat beats none.
 */
export function pickTileEmoji(avoid: readonly string[], random: () => number): string {
    const free = TILE_EMOJIS.filter((e) => !avoid.includes(e))
    const pool = free.length > 0 ? free : TILE_EMOJIS
    return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]
}

export function pickTileCorner(random: () => number): TileCorner {
    return TILE_CORNERS[Math.min(TILE_CORNERS.length - 1, Math.floor(random() * TILE_CORNERS.length))]
}

// ---------------------------------------------------------------------------
// The DOM part.
// ---------------------------------------------------------------------------

export interface ViewportSize {
    width: number
    height: number
}

/**
 * A rect with at least half its area inside the viewport. "Entirely inside" was
 * the first rule and left four covers on a 1280×800 playlists page, so a single
 * emoji: a row cut by the top bar or the player bar still counts.
 */
export function mostlyInView(rect: Pick<DOMRect, 'top' | 'left' | 'bottom' | 'right' | 'width' | 'height'>, vp: ViewportSize): boolean {
    if (rect.width <= 0 || rect.height <= 0) return false
    const w = Math.max(0, Math.min(rect.right, vp.width) - Math.max(rect.left, 0))
    const h = Math.max(0, Math.min(rect.bottom, vp.height) - Math.max(rect.top, 0))
    return w * h >= (rect.width * rect.height) / 2
}

export function tileCovers(root: Document | Element): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(COVER_SELECTOR))
}

/** Remove every emoji and corner from the page. */
export function clearTiles(root: Document | Element): void {
    for (const el of Array.from(root.querySelectorAll<HTMLElement>(`[${ATTR_EMOJI}]`))) {
        el.removeAttribute(ATTR_EMOJI)
        el.removeAttribute(ATTR_CORNER)
    }
}

/**
 * One step: adds an emoji to one visible cover without one, if the cap
 * allows. Returns the cover it decorated, or null.
 */
export function addOneTile(
    root: Document | Element,
    random: () => number,
    vp: ViewportSize = { width: window.innerWidth, height: window.innerHeight }
): HTMLElement | null {
    const covers = tileCovers(root)
    const visible = covers.filter((el) => mostlyInView(el.getBoundingClientRect(), vp))
    const tagged = covers.filter((el) => el.hasAttribute(ATTR_EMOJI)).length
    if (tagged >= tileCap(visible.length)) return null

    const target = pickTileTarget(
        visible.map((el) => ({ el, hasEmoji: el.hasAttribute(ATTR_EMOJI) })),
        random
    )
    if (!target) return null

    // The neighbours in DOM order, across the whole list, not just the visible ones.
    const at = covers.indexOf(target.el)
    const avoid = [covers[at - 1], covers[at + 1]]
        .map((el) => el?.getAttribute(ATTR_EMOJI))
        .filter((e): e is string => !!e)

    target.el.setAttribute(ATTR_EMOJI, pickTileEmoji(avoid, random))
    target.el.setAttribute(ATTR_CORNER, pickTileCorner(random))
    return target.el
}
