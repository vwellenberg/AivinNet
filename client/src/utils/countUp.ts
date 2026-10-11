// ---------------------------------------------------------------------------
// The number a stat tile shows while it counts up to its value.
//
// Ease-out, so the count arrives softly and the last step does not lag behind
// the figure. The result is always a whole number: a tile shows counts, and a
// fraction would flicker through the tile on every frame.
// ---------------------------------------------------------------------------

/** Integer shown `elapsed` ms into a count from `from` to `to` lasting `duration` ms. */
export function countUpAt(from: number, to: number, elapsed: number, duration: number): number {
    if (!(duration > 0) || elapsed >= duration) return Math.round(to)
    const t = Math.max(0, elapsed) / duration
    const eased = 1 - Math.pow(1 - t, 3)
    return Math.round(from + (to - from) * eased)
}

/**
 * A value the tile may count: plain digits, optionally grouped by one separator
 * (`1248`, `1,248`, `1.248`, `1 248`). Anything else — a unit, a date, a
 * decimal — is shown as it arrives.
 */
export function countSeparator(raw: string): string | null {
    if (!/^\d+$/.test(raw) && !/^\d{1,3}([.,\s]\d{3})+$/.test(raw)) return null
    const match = raw.match(/[.,\s]/)
    return match ? match[0] : ''
}

/** Digits of `n`, grouped with `separator` the way the value arrived. */
export function formatCount(n: number, separator: string): string {
    const digits = String(n)
    return separator ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator) : digits
}
