/**
 * The accents the Stats plates hand out to their rows and cards, in turn: a
 * device bar, a record's label. Ink reads on every one of them in both themes
 * (paletteSchemes.test.ts checks the same roles on the tiles).
 */
export const STAT_ACCENTS = ['teal', 'coral', 'lavender', 'yellow', 'pink', 'blue', 'gold', 'sea'] as const

/** The accent of the row or card at `index`, as a CSS colour. */
export function accentAt(index: number): string {
    const n = STAT_ACCENTS.length
    return `var(--mem-${STAT_ACCENTS[((index % n) + n) % n]})`
}
