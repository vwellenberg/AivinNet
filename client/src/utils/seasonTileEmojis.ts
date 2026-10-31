/**
 * The Halloween emoji on the cover tiles (components/SeasonTileEmojis.vue).
 *
 * Each emoji STANDS ON the top edge of a cover, like a sprite on a platform in a
 * 2D game: its feet on the frame, at a horizontal spot along that edge. (Not on
 * the picture: user, 2026-10-31, "oben drüber quasi".) It appears one at a time,
 * every few seconds, on a visible cover that has none yet, and piles up to a cap
 * that grows with the number of visible covers. A scroll clears them all
 * (utils/seasonScrolled.ts); then they start again from zero.
 *
 * Two parts, kept apart on purpose:
 *  - the DRIVER: which cover gets which emoji, and where along its edge. The cover
 *    carries two data attributes (the emoji and its x, in % of the cover width).
 *    This part is pure (`pickTileX`, `freeSpans`) or reads only the cover's own
 *    rects, and the tests pin it.
 *  - the DRAWING: a fixed layer above the page (`layoutTiles`). A glyph cannot be
 *    a child of the cover, because `.card-art` clips with `overflow: hidden` and
 *    the glyph hangs above its top edge. So each tagged cover gets one `<span>` in
 *    that layer, placed from the cover's measured rect. A scroll fades the layer
 *    (`html.season-scrolled`) and the settle clears it.
 */

/** The attribute with the emoji the cover carries. */
export const ATTR_EMOJI = 'data-season-emoji'
/** The attribute with the emoji's x, in % of the cover's width (from the left). */
export const ATTR_X = 'data-season-x'

/**
 * Every cover tile in the app: the artwork box of a card (the shared anatomy,
 * Global/cards.scss) and the cover of Home's "Continue listening" card, which
 * draws its own cover box.
 */
export const COVER_SELECTOR = '.card-art, .continue-card .cover'

/**
 * The obstacles a glyph must not sit on: the type label above a cover (its
 * `.card-type-label`) and the stamp (`.card-stamp`) at its corner.
 */
export const TILE_OBSTACLE_SELECTOR = '.card-type-label, .card-stamp'

/**
 * The emoji of a tile, each with its weight: graves and pumpkins come up most
 * often ("zb gräber oder kürbisse", user, 2026-10-31); the rest now and then.
 *
 * No zombies and no bats: those are creatures that MOVE across the screen
 * (utils/seasonParticles.ts), and standing still on a tile they read as a
 * glitch of the crossing ("bitte keine fledermäuse und zombies auf den
 * kacheln", user, 2026-10-31).
 */
export const TILE_EMOJI_WEIGHTS: readonly { emoji: string; weight: number }[] = [
    { emoji: '🪦', weight: 3 },
    { emoji: '🎃', weight: 3 },
    { emoji: '👻', weight: 1 },
    { emoji: '💀', weight: 1 },
    { emoji: '\u{1F578}️', weight: 1 },
    { emoji: '\u{1F577}️', weight: 1 },
]

/** Every emoji a tile can carry, once each. */
export const TILE_EMOJIS: readonly string[] = TILE_EMOJI_WEIGHTS.map((e) => e.emoji)

/** Where along the top edge a glyph may stand, in % of the cover's width. */
export const TILE_X_MIN = 15
export const TILE_X_MAX = 85
/** A round cover (artist) curves away from its edge: only its top centre. */
export const TILE_X_ROUND_MIN = 42
export const TILE_X_ROUND_MAX = 58
/** The least free width, in %, a glyph needs to stand somewhere on the edge. */
export const TILE_MIN_FREE_PCT = 6
/** The glyph's height in px, the band above the cover's top edge it occupies (font 1.25 rem). */
export const TILE_GLYPH_PX = 28

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
    const free = TILE_EMOJI_WEIGHTS.filter((e) => !avoid.includes(e.emoji))
    const pool = free.length > 0 ? free : TILE_EMOJI_WEIGHTS
    // A weighted pick: each emoji takes as many slices as its weight.
    const total = pool.reduce((sum, e) => sum + e.weight, 0)
    let at = random() * total
    for (const e of pool) {
        at -= e.weight
        if (at < 0) return e.emoji
    }
    return pool[pool.length - 1].emoji
}

/**
 * The parts of `[min, max]` (in %) that no blocked span covers. A blocked span is
 * [from, to] in the same %; spans may overlap or stick out of the range.
 */
export function freeSpans(min: number, max: number, blocked: readonly (readonly [number, number])[]): [number, number][] {
    let free: [number, number][] = [[min, max]]
    for (const [from, to] of blocked) {
        const next: [number, number][] = []
        for (const [a, b] of free) {
            if (to <= a || from >= b) {
                next.push([a, b])
                continue
            }
            if (from > a) next.push([a, from])
            if (to < b) next.push([to, b])
        }
        free = next
    }
    return free.filter(([a, b]) => b > a)
}

/**
 * The x (in % of the cover's width) where a glyph stands on the top edge: a
 * random spot in the range, away from the blocked spans. Null when less than
 * TILE_MIN_FREE_PCT is free (the cover has no room for a glyph).
 */
export function pickTileX(
    random: () => number,
    blocked: readonly (readonly [number, number])[] = [],
    range: readonly [number, number] = [TILE_X_MIN, TILE_X_MAX]
): number | null {
    const free = freeSpans(range[0], range[1], blocked)
    const total = free.reduce((sum, [a, b]) => sum + (b - a), 0)
    if (total < TILE_MIN_FREE_PCT) return null
    let at = random() * total
    for (const [a, b] of free) {
        if (at < b - a) return Math.round((a + at) * 10) / 10
        at -= b - a
    }
    const last = free[free.length - 1]
    return Math.round(last[1] * 10) / 10
}

// ---------------------------------------------------------------------------
// The DOM part.
// ---------------------------------------------------------------------------

export interface ViewportSize {
    width: number
    height: number
}

/**
 * Where the page content starts and where the player bar starts (viewport y, px).
 * A glyph must stand inside the content (not under the top nav) and above the bar.
 */
export interface TileBounds {
    contentTop: number
    barTop: number
}

export function tileBounds(root: Document | Element = document): TileBounds {
    const content = root.querySelector<HTMLElement>('#acontent')
    const bar = root.querySelector<HTMLElement>('.b-bar')
    return {
        contentTop: content ? content.getBoundingClientRect().top : 0,
        barTop: bar ? bar.getBoundingClientRect().top : window.innerHeight,
    }
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

/** Room for a glyph above the cover: its band fits under the content top, and the cover's edge is above the bar. */
export function glyphRoom(rect: Pick<DOMRect, 'top' | 'width' | 'height'>, bounds: TileBounds): boolean {
    if (rect.width <= 0 || rect.height <= 0) return false
    return rect.top - TILE_GLYPH_PX >= bounds.contentTop && rect.top <= bounds.barTop - 2
}

/** The blocked spans of a cover's top edge, in its own %: the label above it and the stamp at its corner. */
export function blockedSpans(cover: HTMLElement): [number, number][] {
    const rect = cover.getBoundingClientRect()
    const card = cover.parentElement
    if (!card || rect.width <= 0) return []
    const spans: [number, number][] = []
    for (const el of Array.from(card.querySelectorAll<HTMLElement>(TILE_OBSTACLE_SELECTOR))) {
        const r = el.getBoundingClientRect()
        // Only an obstacle in the band the glyph would occupy blocks it: one that
        // reaches above the cover's top edge. A stamp inside the cover sits below it.
        if (r.bottom < rect.top - TILE_GLYPH_PX || r.top > rect.top + 2) continue
        const from = ((r.left - rect.left) / rect.width) * 100 - 2
        const to = ((r.right - rect.left) / rect.width) * 100 + 2
        spans.push([from, to])
    }
    return spans
}

export function tileCovers(root: Document | Element): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(COVER_SELECTOR))
}

/**
 * Remove every emoji from the covers, and its drawing from the layer, if one is
 * given. Covers keep nothing else.
 */
export function clearTiles(root: Document | Element, layer?: HTMLElement): void {
    for (const el of Array.from(root.querySelectorAll<HTMLElement>(`[${ATTR_EMOJI}]`))) {
        el.removeAttribute(ATTR_EMOJI)
        el.removeAttribute(ATTR_X)
    }
    layer?.replaceChildren()
}

/**
 * One step: adds an emoji to one visible cover without one, if the cap allows and
 * a cover has room for a glyph on its top edge. Returns the cover it decorated, or null.
 */
export function addOneTile(
    root: Document | Element,
    random: () => number,
    vp: ViewportSize = { width: window.innerWidth, height: window.innerHeight },
    bounds: TileBounds = tileBounds(root)
): HTMLElement | null {
    const covers = tileCovers(root)
    const visible = covers.filter((el) => mostlyInView(el.getBoundingClientRect(), vp))
    const tagged = covers.filter((el) => el.hasAttribute(ATTR_EMOJI)).length
    if (tagged >= tileCap(visible.length)) return null

    // Only a cover with an empty top edge can take a glyph, and a place on it.
    const placed = new Map<HTMLElement, number>()
    for (const el of visible) {
        if (el.hasAttribute(ATTR_EMOJI)) continue
        if (!glyphRoom(el.getBoundingClientRect(), bounds)) continue
        const range: [number, number] = el.classList.contains('is-round')
            ? [TILE_X_ROUND_MIN, TILE_X_ROUND_MAX]
            : [TILE_X_MIN, TILE_X_MAX]
        const x = pickTileX(random, blockedSpans(el), range)
        if (x !== null) placed.set(el, x)
    }
    const target = pickTileTarget(
        Array.from(placed.keys()).map((el) => ({ el, hasEmoji: false })),
        random
    )
    if (!target) return null

    // The neighbours in DOM order, across the whole list, not just the visible ones.
    const at = covers.indexOf(target.el)
    const avoid = [covers[at - 1], covers[at + 1]]
        .map((el) => el?.getAttribute(ATTR_EMOJI))
        .filter((e): e is string => !!e)

    target.el.setAttribute(ATTR_EMOJI, pickTileEmoji(avoid, random))
    target.el.setAttribute(ATTR_X, String(placed.get(target.el)))
    return target.el
}

/** Where a glyph stands for a cover: the x along its top edge, and the edge itself (viewport px). */
export function tileAnchor(rect: Pick<DOMRect, 'top' | 'left' | 'width'>, xPct: number): { x: number; y: number } {
    return { x: rect.left + (rect.width * xPct) / 100, y: rect.top }
}

/** The drawing: one span per tagged cover in the layer, placed on its top edge; the rest are removed. */
const glyphs = new WeakMap<HTMLElement, HTMLElement>()

export function layoutTiles(root: Document | Element, layer: HTMLElement): void {
    const doc = layer.ownerDocument
    const live = new Set<HTMLElement>()
    for (const cover of tileCovers(root)) {
        const emoji = cover.getAttribute(ATTR_EMOJI)
        const xPct = Number(cover.getAttribute(ATTR_X))
        if (!emoji || Number.isNaN(xPct)) continue
        let el = glyphs.get(cover)
        if (!el) {
            el = doc.createElement('span')
            el.className = 'season-tile-emoji'
            el.setAttribute('aria-hidden', 'true')
            glyphs.set(cover, el)
        }
        // A glyph that was taken out (its cover lost the tag) comes back into the layer.
        if (el.parentNode !== layer) layer.appendChild(el)
        if (el.textContent !== emoji) el.textContent = emoji
        const at = tileAnchor(cover.getBoundingClientRect(), xPct)
        el.style.left = `${at.x}px`
        el.style.top = `${at.y}px`
        live.add(el)
    }
    for (const child of Array.from(layer.children)) {
        if (!live.has(child as HTMLElement)) child.remove()
    }
}
