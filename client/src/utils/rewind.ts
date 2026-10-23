/**
 * AivinNet Rewind (#527): the words around `GET /logger/rewind`.
 *
 * The server sends hashes, cards and numbers; what a listener type is called,
 * how an hour reads and which day a date is are decided here, once.
 */

export interface RewindCard {
    name?: string
    title?: string
    image?: string
    trackhash?: string
    albumhash?: string
    artisthash?: string
    artists?: { name: string; artisthash: string }[]
    albumartists?: { name: string; artisthash: string }[]
    seconds?: number
    plays?: number
}

export interface RewindPayload {
    year: number
    years: number[]
    plays: number
    seconds: number
    days: number
    top_artists: RewindCard[]
    top_albums: RewindCard[]
    top_tracks: RewindCard[]
    summer_track: { track: RewindCard; plays: number } | null
    first_track: { track: RewindCard; timestamp: number } | null
    busiest_day: { date: string; seconds: number } | null
    new_artists: number
    new_artists_top: RewindCard[]
    listener: { kind: string; share: number } | null
    time_of_day: { band: string; share: number } | null
}

/** Where most plays were started from, as a kind of listener. */
export const LISTENERS: Record<string, { title: string; line: string }> = {
    album: { title: 'The album listener', line: 'You hear records the way they were made: front to back.' },
    playlist: { title: 'The curator', line: 'Your own playlists carried your year.' },
    artist: { title: 'The devotee', line: 'You go straight to an artist and stay there.' },
    folder: { title: 'The crate digger', line: 'You know your folders like a record crate.' },
    search: { title: 'The seeker', line: 'You know what you want, and you type it in.' },
    favorites: { title: 'The loyal one', line: 'Your favorites played on and on.' },
    home: { title: 'The explorer', line: 'You let Home pick: mixes, On repeat, Rediscover.' },
}

const BANDS: Record<string, string> = {
    mornings: 'in the morning',
    afternoons: 'in the afternoon',
    evenings: 'in the evening',
    nights: 'at night',
}

function own<T>(table: Record<string, T>, key: string | undefined): T | undefined {
    // Own keys only: a kind is server data, and `constructor` is no listener.
    return key !== undefined && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined
}

export function listenerText(listener: RewindPayload['listener']) {
    const known = own(LISTENERS, listener?.kind)
    if (!listener || !known) return null
    return { ...known, share: percent(listener.share) }
}

export function bandPhrase(band: string | undefined): string {
    return own(BANDS, band) ?? ''
}

export function percent(share: number): string {
    return `${Math.round(share * 100)}%`
}

/** "12,345" — the big number of the year. */
export function minutes(seconds: number): string {
    return Math.round(seconds / 60).toLocaleString('en')
}

/** "38 h 12 min", "45 min". */
export function listened(seconds: number): string {
    const total = Math.max(1, Math.round(seconds / 60))
    if (total < 60) return `${total} min`
    const hours = Math.floor(total / 60)
    const rest = total % 60
    return rest ? `${hours} h ${rest} min` : `${hours} h`
}

/** "Saturday, May 4" — a server date ("2026-05-04"), read in UTC so no zone moves it. */
export function dayLabel(day: string): string {
    const [y, m, d] = day.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d)).toLocaleString('en', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC',
    })
}

/** "January 1, 00:14" — a play's moment, in the viewer's clock. */
export function momentLabel(timestamp: number): string {
    return new Date(timestamp * 1000).toLocaleString('en', {
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    })
}

/** "1 play", "12 plays" */
export function playCount(plays: number): string {
    return `${plays.toLocaleString('en')} ${plays === 1 ? 'play' : 'plays'}`
}

/** "Red Hot Chili Peppers · 2 h", or just the time when the album names no artist. */
export function albumLine(album: RewindCard): string {
    return [album.albumartists?.[0]?.name, listened(album.seconds ?? 0)].filter(Boolean).join(' · ')
}

/** "Blue — The Artist" */
export function trackLine(track: RewindCard): string {
    const artist = track.artists?.[0]?.name
    return artist ? `${track.title} — ${artist}` : track.title ?? ''
}

/** "Red Hot Chili Peppers, Primus and Tool" */
export function names(cards: RewindCard[]): string {
    const all = cards.map(c => c.name ?? '').filter(Boolean)
    if (all.length < 2) return all[0] ?? ''
    return `${all.slice(0, -1).join(', ')} and ${all[all.length - 1]}`
}

/**
 * The hidden door to Rewind (#572): the square of January 1 in the listening
 * calendar opens the year that ended the night before — once that year has a
 * Rewind. Any other day, or a year without one, is no door.
 */
export function rewindDoor(date: string, years: readonly number[]): number | null {
    if (!date.endsWith('-01-01')) return null
    const year = Number(date.slice(0, 4)) - 1
    return years.includes(year) ? year : null
}

/** Home announces a fresh Rewind only in January (#572); the stats page does all year. */
export function announcedOnHome(fresh: number | null | undefined, now: Date = new Date()): number | null {
    return fresh && now.getMonth() === 0 ? fresh : null
}

const BURST_KEY = 'rewind-confetti'

/**
 * Whether the New Year's burst on Home's Rewind card is still due for `year`
 * on this device (#572), and remember that it is not any more. A per-device
 * convenience in `localStorage`: blocked storage means no burst rather than a
 * burst on every visit.
 */
export function newYearBurst(year: number): boolean {
    try {
        if (localStorage.getItem(BURST_KEY) === String(year)) return false
        localStorage.setItem(BURST_KEY, String(year))
        return true
    } catch {
        return false
    }
}
