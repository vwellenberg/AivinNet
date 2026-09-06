import { readLocalStorage, writeLocalStorage } from './useLocalStorage'

const KEY = 'recentPlaylists'
const MAX = 10

/**
 * Returns the playlist IDs a track/item was most recently added to,
 * newest first. Persisted in localStorage so it survives reloads.
 */
export function getRecentPlaylistIds(): number[] {
    const ids = readLocalStorage(KEY)
    return Array.isArray(ids) ? ids : []
}

/**
 * Records a playlist as most-recently-used (an item was just added to it):
 * dedupes, moves it to the front, and caps the list length.
 */
export function recordRecentPlaylist(id: number) {
    const ids = getRecentPlaylistIds().filter(existing => existing !== id)
    ids.unshift(id)
    writeLocalStorage(KEY, ids.slice(0, MAX))
}
