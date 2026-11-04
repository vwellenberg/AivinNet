/**
 * How far a glyph's drawn pixels (its "ink") stop above the bottom of its own
 * line box. An emoji font puts empty room under its pictures, and how much is up
 * to the font: Noto (Linux, Android) draws to the bottom of a `line-height: 1`
 * box and past it, other emoji fonts leave a band under the picture. So a figure
 * set with `bottom: 0` on an edge can float a few px above it on one system and
 * stand on it on another (the vampire peek, "schwebt etwas über der Kachel",
 * user, 2026-11-04). No CSS value fits every font, so the gap is measured where
 * the glyph is drawn:
 *
 *  - the BASELINE from the layout itself: a 0 x 0 inline-block in the element sits
 *    with its bottom on the baseline, wherever the fonts put it;
 *  - the INK below the baseline from a canvas: the glyph drawn in the element's
 *    font on the alphabetic baseline, and its lowest painted row.
 *
 * Checked against a screenshot of the real overlay in Chromium, for several
 * fonts and glyphs: the measured gap is the gap on screen, to the pixel.
 */

/** An alpha at or above this counts as ink; the soft edge of anti-aliasing below it does not. */
export const INK_ALPHA_MIN = 32

/**
 * The lowest row (0 = top) with any pixel at or above `alphaMin` in RGBA data,
 * or -1 when the data holds no ink at all.
 */
export function lowestInkRow(data: ArrayLike<number>, width: number, height: number, alphaMin = INK_ALPHA_MIN): number {
    for (let y = height - 1; y >= 0; y--) {
        for (let x = 0; x < width; x++) {
            if (data[(y * width + x) * 4 + 3] >= alphaMin) return y
        }
    }
    return -1
}

/**
 * The gap, in px, between the bottom of the ink and the bottom of the box:
 * the box's bottom below the baseline, less the ink's. Never negative (ink that
 * reaches past the box needs no correction), whole px.
 */
export function inkGap(boxBelowBaseline: number, inkBelowBaseline: number): number {
    return Math.max(0, Math.round(boxBelowBaseline - inkBelowBaseline))
}

const cache = new Map<string, number>()

/**
 * The px of empty room between the bottom of `el`'s text ink and the bottom of
 * its box. 0 when it cannot be measured (no canvas, no text): the figure then
 * stands where its box puts it, as before. Cached per text and font, since the
 * fonts decide it and not the moment.
 */
export function inkGapBelow(el: HTMLElement): number {
    const text = el.textContent ?? ''
    if (!text) return 0
    const cs = getComputedStyle(el)
    const size = parseFloat(cs.fontSize)
    if (!(size > 0)) return 0
    const font = `${cs.fontStyle} ${cs.fontWeight} ${size}px ${cs.fontFamily}`
    const key = `${text}|${font}|${cs.lineHeight}`
    const hit = cache.get(key)
    if (hit !== undefined) return hit

    const ctx = document.createElement('canvas').getContext('2d')
    if (!ctx) return 0

    // The baseline, from the layout. Any transform on `el` moves both rects alike.
    const marker = document.createElement('span')
    marker.style.cssText = 'display:inline-block;width:0;height:0'
    el.appendChild(marker)
    const boxBelowBaseline = el.getBoundingClientRect().bottom - marker.getBoundingClientRect().bottom
    marker.remove()

    // The ink, from a canvas with room around the glyph on every side.
    const w = Math.ceil(size * 3)
    const h = Math.ceil(size * 3)
    const base = Math.round(size * 2)
    ctx.canvas.width = w
    ctx.canvas.height = h
    ctx.font = font
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(text, size * 0.5, base)
    const row = lowestInkRow(ctx.getImageData(0, 0, w, h).data, w, h)
    if (row < 0) return 0

    const gap = inkGap(boxBelowBaseline, row + 1 - base)
    cache.set(key, gap)
    return gap
}
