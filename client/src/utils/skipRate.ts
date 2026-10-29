/**
 * The skip quote on the stats page (#537): the server's numbers as words.
 * Shares are rounded to whole percent; a missing rate reads as a dash.
 */

import type { SkipRow } from '@/requests/stats'

export function percent(share: number | null): string {
    if (share === null || !Number.isFinite(share)) return '—'
    return `${Math.round(share * 100)} %`
}

export function artistNames(row: Pick<SkipRow, 'track'>): string {
    return row.track.artists.map(artist => artist.name).join(', ')
}

/** "3 of 5 plays" with the counted kind: skipped plays, or finished ones. */
export function countOf(row: SkipRow, kind: 'skipped' | 'finished'): string {
    const count = row[kind] ?? 0
    return `${count} of ${row.plays} plays`
}
