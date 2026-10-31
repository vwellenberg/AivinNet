/**
 * The seasonal emoji on the cover tiles (components/SeasonTileEmojis.vue): Halloween
 * graves and pumpkins, and now and then a skull; Christmas presents and snowmen
 * (`tileEmojiWeightsFor`).
 *
 * Each emoji STANDS ON the top edge of a cover, like a sprite on a platform in a
 * 2D game: its feet on the frame, at a horizontal spot along that edge. (Not on
 * the picture: user, 2026-10-31, "oben drüber quasi".) One appears at a time, at
 * irregular intervals, on a visible cover that has room for it. A cover can carry
 * up to TILE_PER_COVER_MAX of them, side by side, each at a random spot along the
 * edge that does not touch the others. The page piles up to a cap that grows with
 * the number of visible covers. A scroll clears them all (utils/seasonScrolled.ts);
 * then they start again from zero.
 *
 * Two parts, kept apart on purpose:
 *  - the DRIVER: which cover gets which emoji, and where along its edge. The cover
 *    carries two data attributes, each a space-separated list with one entry per
 *    glyph: the emoji, and its x in % of the cover width (`readTiles`, `writeTiles`).
 *    This part is pure (`pickTileX`, `freeSpans`) or reads only the cover's own
 *    rects, and the tests pin it.
 *  - the DRAWING: a fixed layer above the page (`layoutTiles`). A glyph cannot be
 *    a child of the cover, because `.card-art` clips with `overflow: hidden` and
 *    the glyph hangs above its top edge. So each glyph of a cover gets one `<span>`
 *    in that layer, placed from the cover's measured rect. A scroll fades the layer
 *    (`html.season-scrolled`) and the settle clears it.
 */

import type { Season } from './seasons'

/** The attribute with the emoji the cover carries, space-separated for several. */
export const ATTR_EMOJI = 'data-season-emoji'
/** The attribute with the emoji's x, in % of the cover's width (from the left), space-separated like ATTR_EMOJI. */
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

/** An emoji a tile can carry, with its weight in the random pick. */
export interface TileEmoji {
    emoji: string
    weight: number
}

/** One glyph on a cover: its emoji, and its x along the top edge (% of the cover's width). */
export interface TileGlyph {
    emoji: string
    x: number
}

/**
 * Halloween: graves and pumpkins come up most often ("zb gräber oder kürbisse",
 * user, 2026-10-31); the rest of the set, each once in a while, weight 1.
 *
 * No ghosts, spiders or cobwebs on the tiles ("bitte keine gespenster,
 * spinnenweben, spinnen auf den kacheln", user, 2026-10-31): they stay in the
 * sky and on the crossings (utils/seasonParticles.ts).
 *
 * No zombies and no bats either: those are creatures that MOVE across the screen,
 * and standing still on a tile they read as a glitch of the crossing ("bitte keine
 * fledermäuse und zombies auf den kacheln", user, 2026-10-31).
 */
const HALLOWEEN_TILE_EMOJI: readonly TileEmoji[] = [
    { emoji: '🪦', weight: 3 },
    { emoji: '🎃', weight: 3 },
    { emoji: '💀', weight: 1 },
    { emoji: '\u{1F56F}️', weight: 1 },
    { emoji: '🍬', weight: 1 },
    { emoji: '⚰️', weight: 1 },
    { emoji: '🦴', weight: 1 },
    { emoji: '\u{1F408}‍⬛', weight: 1 },
    { emoji: '🔮', weight: 1 },
]

/**
 * Christmas: presents, cookies, stars and the tree most often; the snowman and a
 * little snow now and then (the snowman also peeks, components/SeasonVampire.vue).
 */
const CHRISTMAS_TILE_EMOJI: readonly TileEmoji[] = [
    { emoji: '🎁', weight: 3 },
    { emoji: '🍪', weight: 3 },
    { emoji: '⭐', weight: 2 },
    { emoji: '🎄', weight: 2 },
    { emoji: '⛄', weight: 2 },
    { emoji: '❄️', weight: 1 },
    { emoji: '\u{1F328}️', weight: 1 },
]

const TILE_EMOJI_BY_SEASON: Record<Season, readonly TileEmoji[]> = {
    halloween: HALLOWEEN_TILE_EMOJI,
    christmas: CHRISTMAS_TILE_EMOJI,
}

/** The weighted emoji of one season's tiles. */
export function tileEmojiWeightsFor(season: Season): readonly TileEmoji[] {
    return TILE_EMOJI_BY_SEASON[season]
}

/** The Halloween weights, under the name the first version used. */
export const TILE_EMOJI_WEIGHTS: readonly TileEmoji[] = HALLOWEEN_TILE_EMOJI

/** Every Halloween emoji a tile can carry, once each. */
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
/** Most glyphs one cover carries at once, side by side along its top edge. */
export const TILE_PER_COVER_MAX = 3

/** Never more than this many glyphs on the page at once, however many covers are visible. */
export const TILE_CAP_MAX = 10
/**
 * Glyphs per visible cover: one, on average. Side by side still happens (any
 * cover with room may get the next one), but the page no longer fills up.
 *
 * ⚠️ Rarity is the point: "bitte seltener, dass emojis auftauchen. es soll
 * 'besonders' bleiben" (user, 2026-10-31). The round before had 1.5 per cover,
 * up to 24, one every 1.2–7 s, and a Home page was covered within a minute.
 */
export const TILE_CAP_SHARE = 1

/**
 * Gap between two new glyphs, in ms: random in [MIN, MAX). Irregular on purpose,
 * and long: on average one every ~22 s, so a glyph turns up now and then rather
 * than the page filling while one looks at it (see TILE_CAP_SHARE).
 */
export const TILE_DELAY_MIN_MS = 10000
export const TILE_DELAY_MAX_MS = 35000

/** How many glyphs may be on screen, given how many covers are visible. */
export function tileCap(visibleCount: number): number {
    if (visibleCount <= 0) return 0
    return Math.min(TILE_CAP_MAX, Math.ceil(visibleCount * TILE_CAP_SHARE))
}

/** Milliseconds until the next emoji, from the random source. */
export function nextTileDelayMs(random: () => number): number {
    return TILE_DELAY_MIN_MS + random() * (TILE_DELAY_MAX_MS - TILE_DELAY_MIN_MS)
}

/**
 * A cover that can take one more glyph, picked at random. A cover flagged `full`
 * is never picked. Null when every cover is full (or there are none).
 */
export function pickTileTarget<T extends { full: boolean }>(covers: T[], random: () => number): T | null {
    const free = covers.filter((c) => !c.full)
    if (free.length === 0) return null
    return free[Math.min(free.length - 1, Math.floor(random() * free.length))]
}

/**
 * A random emoji that is not one of `avoid` (the neighbours' emoji, and the cover's
 * own), so two next-door glyphs rarely match. If the avoid list covers every emoji,
 * any one is returned: a repeat beats none.
 */
export function pickTileEmoji(
    avoid: readonly string[],
    random: () => number,
    weights: readonly TileEmoji[] = TILE_EMOJI_WEIGHTS
): string {
    const free = weights.filter((e) => !avoid.includes(e.emoji))
    const pool = free.length > 0 ? free : weights
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

/**
 * Half the room a glyph takes on each side of its centre along the edge, in % of
 * the cover's width: half its width (TILE_GLYPH_PX) and a 3 px gap. Two glyph
 * centres must be twice this apart so the glyphs stand next to each other without
 * overlapping.
 */
export function tileHalfPct(coverWidthPx: number): number {
    return ((TILE_GLYPH_PX / 2 + 3) / coverWidthPx) * 100
}

// ---------------------------------------------------------------------------
// The DOM part.
// ---------------------------------------------------------------------------

/** The glyphs of a cover, from its two attributes: the emoji and its x, paired by position. */
export function readTiles(cover: Element): TileGlyph[] {
    const emojis = (cover.getAttribute(ATTR_EMOJI) ?? '').split(' ').filter(Boolean)
    const xs = (cover.getAttribute(ATTR_X) ?? '').split(' ').filter(Boolean).map(Number)
    const out: TileGlyph[] = []
    for (let i = 0; i < Math.min(emojis.length, xs.length); i++) {
        if (!Number.isNaN(xs[i])) out.push({ emoji: emojis[i], x: xs[i] })
    }
    return out
}

/** Writes the glyphs of a cover into its two attributes; no glyphs removes both. */
export function writeTiles(cover: Element, tiles: readonly TileGlyph[]): void {
    if (tiles.length === 0) {
        cover.removeAttribute(ATTR_EMOJI)
        cover.removeAttribute(ATTR_X)
        return
    }
    cover.setAttribute(ATTR_EMOJI, tiles.map((t) => t.emoji).join(' '))
    cover.setAttribute(ATTR_X, tiles.map((t) => String(t.x)).join(' '))
}

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
    for (const el of Array.from(root.querySelectorAll<HTMLElement>(`[${ATTR_EMOJI}]`))) writeTiles(el, [])
    layer?.replaceChildren()
}

/** The x range a cover's glyphs may stand in: the top centre of a round cover, the whole edge of the rest. */
function coverRange(cover: Element): [number, number] {
    return cover.classList.contains('is-round') ? [TILE_X_ROUND_MIN, TILE_X_ROUND_MAX] : [TILE_X_MIN, TILE_X_MAX]
}

/**
 * The spans of a cover's top edge a NEW glyph may not take: the label and the stamp,
 * and around every glyph already there, two halves (its own half on top of its
 * neighbour's), so the new centre stands a full glyph away.
 */
function blockedFor(cover: HTMLElement, tiles: readonly TileGlyph[]): [number, number][] {
    const half = tileHalfPct(cover.getBoundingClientRect().width)
    return [...blockedSpans(cover), ...tiles.map((t): [number, number] => [t.x - 2 * half, t.x + 2 * half])]
}

/**
 * One step: adds an emoji to one visible cover, if the cap allows and a cover has
 * room for a glyph on its top edge. The cover is picked at random from all visible
 * covers with room, and it may already carry glyphs (up to TILE_PER_COVER_MAX).
 * Returns the cover it decorated, or null.
 */
export function addOneTile(
    root: Document | Element,
    random: () => number,
    vp: ViewportSize = { width: window.innerWidth, height: window.innerHeight },
    bounds: TileBounds = tileBounds(root),
    weights: readonly TileEmoji[] = TILE_EMOJI_WEIGHTS
): HTMLElement | null {
    const covers = tileCovers(root)
    const visible = covers.filter((el) => mostlyInView(el.getBoundingClientRect(), vp))
    const placed = covers.reduce((n, el) => n + readTiles(el).length, 0)
    if (placed >= tileCap(visible.length)) return null

    // Every visible cover with room for a glyph on its top edge is a candidate. Its x
    // is free of the label, the stamp and the glyphs it has already; a cover with no
    // free spot, or with TILE_PER_COVER_MAX glyphs, is `full` and is not picked.
    const candidates: { el: HTMLElement; tiles: TileGlyph[]; x: number | null; full: boolean }[] = []
    for (const el of visible) {
        if (!glyphRoom(el.getBoundingClientRect(), bounds)) continue
        const tiles = readTiles(el)
        const x = tiles.length >= TILE_PER_COVER_MAX ? null : pickTileX(random, blockedFor(el, tiles), coverRange(el))
        candidates.push({ el, tiles, x, full: x === null })
    }
    const target = pickTileTarget(candidates, random)
    if (!target || target.x === null) return null

    // The neighbours in DOM order, across the whole list, not just the visible ones,
    // and the cover itself: none of their emoji is picked again.
    const at = covers.indexOf(target.el)
    const around: (HTMLElement | undefined)[] = [covers[at - 1], covers[at + 1], target.el]
    const avoid = around.flatMap((el) => (el ? readTiles(el).map((t) => t.emoji) : []))

    writeTiles(target.el, [...target.tiles, { emoji: pickTileEmoji(avoid, random, weights), x: target.x }])
    return target.el
}

/** Where a glyph stands for a cover: the x along its top edge, and the edge itself (viewport px). */
export function tileAnchor(rect: Pick<DOMRect, 'top' | 'left' | 'width'>, xPct: number): { x: number; y: number } {
    return { x: rect.left + (rect.width * xPct) / 100, y: rect.top }
}

/** The drawing: the spans of each cover's glyphs, one per glyph, reused from one layout to the next. */
const drawn = new WeakMap<HTMLElement, HTMLElement[]>()

/** Draws one span per glyph of every cover in the layer, on its top edge; spans that no glyph needs any more are removed. */
export function layoutTiles(root: Document | Element, layer: HTMLElement): void {
    const doc = layer.ownerDocument
    const live = new Set<HTMLElement>()
    for (const cover of tileCovers(root)) {
        const tiles = readTiles(cover)
        const spans = drawn.get(cover) ?? []
        drawn.set(cover, spans)
        // A cover that lost glyphs gives its spare spans up.
        for (const spare of spans.splice(tiles.length)) spare.remove()
        if (tiles.length === 0) continue
        const rect = cover.getBoundingClientRect()
        tiles.forEach((tile, i) => {
            let el = spans[i]
            if (!el) {
                el = doc.createElement('span')
                el.className = 'season-tile-emoji'
                el.setAttribute('aria-hidden', 'true')
                spans[i] = el
            }
            // A glyph that was taken out of the layer (its cover was cleared) comes back into it.
            if (el.parentNode !== layer) layer.appendChild(el)
            if (el.textContent !== tile.emoji) el.textContent = tile.emoji
            const at = tileAnchor(rect, tile.x)
            el.style.left = `${at.x}px`
            el.style.top = `${at.y}px`
            live.add(el)
        })
    }
    for (const child of Array.from(layer.children)) {
        if (!live.has(child as HTMLElement)) child.remove()
    }
}
