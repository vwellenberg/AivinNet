// ---------------------------------------------------------------------------
// The numbers a stat tile counts up to their value.
//
// A tile's value is text, not a number: `408 track plays`, `12 hrs, 49 mins
// listened`. So the numbers inside it count, and the words around them stay.
// Ease-out, so the count arrives softly and the last step does not lag behind
// the figure. Each figure is a whole number: a fraction would flicker through
// the tile on every frame.
// ---------------------------------------------------------------------------

/** Integer shown `elapsed` ms into a count from `from` to `to` lasting `duration` ms. */
export function countUpAt(from: number, to: number, elapsed: number, duration: number): number {
    if (!(duration > 0) || elapsed >= duration) return Math.round(to)
    const t = Math.max(0, elapsed) / duration
    const eased = 1 - Math.pow(1 - t, 3)
    return Math.round(from + (to - from) * eased)
}

/** One number inside a stat's text: where it sits, what it counts to, how it is grouped. */
export interface CountToken {
    start: number
    end: number
    value: number
    separator: string
}

/**
 * The numbers in a stat's text that count up: `1,248 streams` counts 1248,
 * `12 hrs, 49 mins` counts 12 and 49.
 *
 * Left as written: a leading zero (a track number, `02.`), and a decimal
 * (`12.5`). Counting the two halves of a decimal separately shows a figure that
 * is neither the old nor the new value in between.
 */
export function countTokens(raw: string): CountToken[] {
    const pattern = /\d+(?:[.,\s]\d{3})*/g
    const tokens: CountToken[] = []
    let match: RegExpExecArray | null
    while ((match = pattern.exec(raw)) !== null) {
        const text = match[0]
        const start = match.index
        const end = start + text.length
        if (text.length > 1 && text.startsWith('0')) continue
        if (/^[.,]\d/.test(raw.slice(end))) continue
        if (start >= 2 && /[.,]/.test(raw[start - 1]) && /\d/.test(raw[start - 2])) continue
        tokens.push({
            start,
            end,
            value: Number(text.replace(/\D/g, '')),
            separator: text.match(/[.,\s]/)?.[0] ?? '',
        })
    }
    return tokens
}

/** Digits of `n`, grouped with `separator` the way the value arrived. */
export function formatCount(n: number, separator: string): string {
    const digits = String(n)
    return separator ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator) : digits
}

/** The text with each counted number replaced by its figure at this moment. */
export function renderCounts(raw: string, tokens: CountToken[], figures: number[]): string {
    let out = ''
    let cursor = 0
    tokens.forEach((token, i) => {
        out += raw.slice(cursor, token.start) + formatCount(figures[i], token.separator)
        cursor = token.end
    })
    return out + raw.slice(cursor)
}
