/** The search that opens the server's calling card (#547). */
export const SERVER_CARD_QUERY = 'aivin'

/** Case-insensitive, trimmed: " Aivin " opens the card, "aivin music" does not. */
export function isServerCardQuery(query: string | null | undefined): boolean {
    return (query ?? '').trim().toLowerCase() === SERVER_CARD_QUERY
}

/** Uptime as one short line: "3 d 5 h", "5 h 12 min", "42 min", "30 s". */
export function formatUptime(seconds: number): string {
    const total = Math.max(0, Math.floor(seconds))
    const days = Math.floor(total / 86400)
    const hours = Math.floor((total % 86400) / 3600)
    const minutes = Math.floor((total % 3600) / 60)

    if (days) return `${days} d ${hours} h`
    if (hours) return `${hours} h ${minutes} min`
    if (minutes) return `${minutes} min`
    return `${total} s`
}

/** The oldest play as a date ("March 3, 2025"), or null while the server has not counted it. */
export function formatSince(unixSeconds: number | null): string | null {
    if (unixSeconds === null) return null
    return new Date(unixSeconds * 1000).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    })
}
