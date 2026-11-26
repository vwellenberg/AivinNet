import type { Playlist, SmartPlaylist } from '@/interfaces'
import { nextSortQuery } from '@/utils/sortMenu'

/** The name and the columns of a playlist row. */
export const PLAYLIST_SORT_KEYS = [
    { key: 'name', displayName: 'Name' },
    { key: 'count', displayName: 'No. of tracks' },
    { key: 'duration', displayName: 'Duration' },
    { key: 'last_updated', displayName: 'Last updated' },
    { key: 'lastplayed', displayName: 'Last played' },
] as const

/** Play counts from the listening history. */
export const PLAYLIST_STAT_SORT_KEYS = [
    { key: 'playcount', displayName: 'Plays' },
    { key: 'playduration', displayName: 'Play duration' },
] as const

export type PlaylistSortKey =
    | (typeof PLAYLIST_SORT_KEYS)[number]['key']
    | (typeof PLAYLIST_STAT_SORT_KEYS)[number]['key']

const KNOWN_KEYS: readonly string[] = [
    ...PLAYLIST_SORT_KEYS.map(k => k.key),
    ...PLAYLIST_STAT_SORT_KEYS.map(k => k.key),
]

/** Any key the page does not know sorts by name. */
export function normalizeSortKey(sortby: unknown): PlaylistSortKey {
    return typeof sortby === 'string' && KNOWN_KEYS.includes(sortby)
        ? (sortby as PlaylistSortKey)
        : 'name'
}

/**
 * The sort state from the route query. Without a `sortby` the page is name,
 * ascending — `reverse` alone does not turn that around.
 */
export function readPlaylistSortQuery(query: Record<string, unknown>): {
    sortby: PlaylistSortKey
    reverse: boolean
} {
    const hasSort = typeof query.sortby === 'string'
    return {
        sortby: hasSort ? normalizeSortKey(query.sortby) : 'name',
        reverse: hasSort && query.reverse === '1',
    }
}

/** The URL query for a pick in the sort menu: name starts A to Z (utils/sortMenu). */
export function nextPlaylistSortQuery(
    current: { sortby: PlaylistSortKey; reverse: boolean },
    key: PlaylistSortKey,
): Record<string, string> {
    return nextSortQuery(current, key, ['name'])
}

/** Accent- and case-insensitive: "Café" matches "cafe" and "CAFÉ". */
function fold(text: string): string {
    return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

/**
 * Substring match on the playlist name. A blank (or all-space) term matches
 * everything, so an empty search field shows the whole list.
 */
export function matchesPlaylistSearch(name: string, term: string): boolean {
    const needle = fold(term.trim())
    if (!needle) return true
    return fold(name).includes(needle)
}

function compareNames(a: { name: string }, b: { name: string }): number {
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}

function finite(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * `last_updated` arrives as a "YYYY-MM-DD HH:MM:SS" string or as unix seconds.
 * Both become unix seconds; anything unreadable counts as 0 (never updated).
 */
export function lastUpdatedSeconds(playlist: Pick<Playlist, 'last_updated'>): number {
    const value = playlist.last_updated
    if (typeof value === 'number') return finite(value)
    if (typeof value === 'string') {
        const ms = Date.parse(value.replace(' ', 'T'))
        return Number.isNaN(ms) ? 0 : ms / 1000
    }
    return 0
}

function sortValue(playlist: Playlist, key: Exclude<PlaylistSortKey, 'name'>): number {
    switch (key) {
        case 'count':
            return finite(playlist.count)
        case 'duration':
            return finite(playlist.duration)
        case 'last_updated':
            return lastUpdatedSeconds(playlist)
        case 'lastplayed':
            return finite(playlist.lastplayed)
        case 'playcount':
            return finite(playlist.playcount)
        case 'playduration':
            return finite(playlist.playduration)
    }
}

/**
 * Sorts a copy of the list. The store's array is shared with the library
 * sidebar, so it is never changed here. Ties on the key fall back to the name,
 * ascending, whatever the direction.
 */
export function sortPlaylists<T extends Playlist>(
    list: readonly T[],
    sortby: unknown,
    reverse: boolean,
): T[] {
    const key = normalizeSortKey(sortby)
    const direction = reverse ? -1 : 1

    return [...list].sort((a, b) => {
        if (key === 'name') return compareNames(a, b) * direction

        const diff = sortValue(a, key) - sortValue(b, key)
        if (diff !== 0) return diff * direction
        return compareNames(a, b)
    })
}

/**
 * Smart playlists have no counts, so they are always sorted by name: ascending,
 * or descending only when the chip is the name chip and `reverse` is set.
 */
export function sortSmartPlaylists<T extends Pick<SmartPlaylist, 'name'>>(
    list: readonly T[],
    sortby: unknown,
    reverse: boolean,
): T[] {
    const descending = normalizeSortKey(sortby) === 'name' && reverse
    const direction = descending ? -1 : 1
    return [...list].sort((a, b) => compareNames(a, b) * direction)
}
