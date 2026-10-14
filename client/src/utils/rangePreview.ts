// ---------------------------------------------------------------------------
// The hover preview of a slider — shared by the seek bar (LeftSidebar/NP/
// Progress.vue) and the volume bar (BottomBar/Volume.vue).
//
// Both show where a click would land before it happens: a yellow span between
// the current value and the pointer, the sprinkle texture over everything
// painted, and a pill naming the value under the pointer. The arithmetic lives
// here once, so the two bars cannot drift apart (the seek bar had it alone
// until the volume bar wanted the same preview).
// ---------------------------------------------------------------------------

export interface RangeSpan {
    /** Left edge, percent of the bar. */
    from: number
    /** Right edge, percent of the bar. */
    to: number
}

/**
 * Pointer X (px) -> the 0..1 position across the input's OWN box, clamped.
 *
 * Full width on purpose: a native range maps a click over a track inset by half
 * the thumb, which puts the landing value a few percent off the pill near the
 * ends. Callers therefore use this for the click as well, so pill, span and the
 * value set are one position. Null when the input has no box (not laid out).
 */
export function ratioAt(clientX: number, rect: { left: number; width: number }): number | null {
    if (!rect.width) return null
    const ratio = (clientX - rect.left) / rect.width
    return ratio < 0 ? 0 : ratio > 1 ? 1 : ratio
}

/**
 * The stretch a click would add or take away: current value <-> pointer, in
 * percent. Painting the preview from zero instead covered the filled part
 * whenever the pointer was ahead of it, which hid where the value stands now.
 */
export function previewSpan(current: number, hover: number | null): RangeSpan | null {
    if (hover === null) return null
    return { from: Math.min(current, hover) * 100, to: Math.max(current, hover) * 100 }
}

/**
 * How much of the bar wears the sprinkle texture, 0..1: everything painted, so
 * the yellow span is textured like the fill instead of reading as a flat patch.
 */
export function paintedFrac(current: number, hover: number | null): number {
    return hover === null ? current : Math.max(current, hover)
}

/**
 * The span as the TOP background layer of the input (trailing comma included,
 * so it prefixes the other layers). A background layer, not an overlay: the
 * thumb is a pseudo-element of the input, so anything stacked over the input
 * would cover its ink ring. Hard stops place it — background-position
 * percentages are measured against the leftover width.
 */
export function spanLayer(span: RangeSpan | null, colour: string): string {
    if (!span) return ''
    return (
        `linear-gradient(to right, transparent ${span.from}%, ${colour} ${span.from}%, ` +
        `${colour} ${span.to}%, transparent ${span.to}%) left center / 100% 100% no-repeat, `
    )
}
