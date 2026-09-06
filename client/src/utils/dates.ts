/**
 * Formats a timestamp into a date string of the format "Month day, year"
 * @returns formatted date
 */
export function formatDate(timestamp: number, yearOnly = false, month: 'long' | 'short' = 'long') {
    // format date as Month day, year
    const date = new Date(timestamp * 1000)

    const options: Intl.DateTimeFormatOptions = { year: 'numeric', month, day: 'numeric' }

    if (yearOnly) {
        return date.getFullYear()
    }

    return date.toLocaleDateString('en-US', options)
}

/**
 * Formats a "date added" timestamp like Spotify: relative for recent
 * dates ("3 days ago"), absolute from ~4 weeks on ("Jan 5, 2026").
 * @param timestamp unix timestamp in seconds
 */
export function formatDateAdded(timestamp: number) {
    const seconds = Math.floor(Date.now() / 1000) - timestamp

    // Future timestamps (clock skew) are treated as "just now".
    if (seconds < 60) return 'just now'

    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`

    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`

    const days = Math.floor(hours / 24)
    if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`

    const weeks = Math.floor(days / 7)
    if (weeks < 4) return `${weeks} week${weeks === 1 ? '' : 's'} ago`

    return formatDate(timestamp, false, 'short') as string
}
