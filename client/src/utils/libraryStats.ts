/**
 * The library tiles (#536): how the server's numbers read on the stats page.
 */

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** A share as the tiles say it: "34 %". No library, nothing to share. */
export function percentText(share: number | null | undefined): string {
    return share == null ? '—' : `${Math.round(share * 100)} %`
}

/** The nonstop length of the library: "23 days", "5 hrs 12 mins", "40 mins". */
export function nonstopText(seconds: number): string {
    const total = Math.max(0, Math.floor(seconds))
    const days = Math.floor(total / 86400)
    const hours = Math.floor((total % 86400) / 3600)
    const minutes = Math.floor((total % 3600) / 60)

    if (days) return plural(days, 'day')
    if (hours) return `${plural(hours, 'hr')} ${plural(minutes, 'min')}`
    return plural(minutes, 'min')
}

/** Every format with its share, in the order given: "FLAC 45 % · MP3 40 %". */
export function formatsText(formats: { format: string; share: number }[]): string {
    return formats.map(row => `${row.format} ${percentText(row.share)}`).join(' · ')
}
