/**
 * Where the record sleeves of a Browse crate stand (HomeView/Browse.vue).
 *
 * The fan spans the FULL card width, under the name sticker on the left as
 * well as the right. All numbers are CSS pixels, relative to the card's left
 * edge; `left` is the slot's left edge, `lift` its bottom offset, `rotate` in
 * degrees. Later slots paint above earlier ones (DOM order).
 *
 * - size: round(height x 0.62), so the sleeves follow the card (12rem on
 *   desktop, 9rem on phones).
 * - The row runs from x0 = -0.15 x size (a little off the left edge) to
 *   x1 = width - 0.85 x size (a little off the right edge).
 * - Step = 0.5 x size. Count = as many as fit, capped by what is available.
 * - If those pictures do not reach x1 at that step, the step widens (up to
 *   0.9 x size) and the row anchors at x1, so a few pictures still look
 *   deliberate.
 * - Tilt goes from -14 to +14 degrees across the row; lift is a sine arch,
 *   highest in the middle.
 *
 * Not measured yet (width or height 0, e.g. jsdom or before the first layout):
 * every picture still gets a slot, at left 0, so nothing disappears.
 */

export interface CrateSlot {
    left: number
    rotate: number
    lift: number
}

export interface CrateFan {
    size: number
    slots: CrateSlot[]
}

const SIZE_RATIO = 0.62
const LEFT_BLEED = 0.15
const RIGHT_BLEED = 0.85
const STEP_RATIO = 0.5
const WIDE_STEP_RATIO = 0.9
const MIN_PICTURES = 3
const TILT_DEG = 14
const LIFT_RATIO = 0.18

const finite = (v: number) => (Number.isFinite(v) ? v : 0)

function slotAt(i: number, n: number, left: number, size: number): CrateSlot {
    const t = n > 1 ? i / (n - 1) : 0.5
    return {
        left,
        rotate: -TILT_DEG + 2 * TILT_DEG * t,
        lift: Math.sin(Math.PI * t) * LIFT_RATIO * size,
    }
}

export function crateFan(available: number, width: number, height: number): CrateFan {
    const count = Math.max(0, Math.floor(finite(available)))
    const w = finite(width)
    const h = finite(height)
    const size = Math.max(0, Math.round(h * SIZE_RATIO))

    if (count === 0) return { size, slots: [] }
    if (w <= 0 || h <= 0) {
        return { size, slots: Array.from({ length: count }, (_, i) => slotAt(i, count, 0, size)) }
    }

    const x0 = -LEFT_BLEED * size
    const x1 = w - RIGHT_BLEED * size
    const span = x1 - x0
    const step = STEP_RATIO * size
    const fit = span >= 0 ? Math.floor(span / step) + 1 : 0
    const n = Math.max(Math.min(count, fit), Math.min(count, MIN_PICTURES))

    // Do the pictures reach x1 at the default step? If not, widen the step
    // and anchor the row at the right edge.
    const last = x0 + (n - 1) * step
    const fills = last >= x1 - step && last <= x1
    const stretch = n > 1 ? Math.min(WIDE_STEP_RATIO * size, Math.max(span, 0) / (n - 1)) : 0

    return {
        size,
        slots: Array.from({ length: n }, (_, i) => {
            const left = fills ? x0 + i * step : x1 - (n - 1 - i) * stretch
            return slotAt(i, n, left, size)
        }),
    }
}
