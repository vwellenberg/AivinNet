import { Track } from '@/interfaces'

// The sort and filter a playlist page shows. It shapes the DISPLAY only: the
// stored order is the server's, and a drag or Edit always works on it, which
// is why the view itself refuses both while it is shaped (PlaylistView).
export type PlaylistSortKey = '' | 'title' | 'artist' | 'album' | 'added' | 'duration' | 'playcount'

export interface PlaylistFilters {
    unplayed: boolean
    favorites: boolean
    topRated: boolean
}

export function noFilters(): PlaylistFilters {
    return { unplayed: false, favorites: false, topRated: false }
}

// The direction a key starts in when it is picked: the questions people ask of
// these two keys ("what did I add lately", "what do I play most") start from
// the top, the rest read A→Z and short→long.
export const SORT_DEFAULT_REVERSE: Record<Exclude<PlaylistSortKey, ''>, boolean> = {
    title: false,
    artist: false,
    album: false,
    added: true,
    duration: false,
    playcount: true,
}

function passes(track: Track, filters: PlaylistFilters): boolean {
    // A missing play count is a track that was never played, not an unknown one.
    if (filters.unplayed && (track.playcount ?? 0) !== 0) return false
    if (filters.favorites && !track.is_favorite) return false
    if (filters.topRated && (track.rating ?? 0) < 4) return false
    return true
}

// numeric: "Track 2" sorts before "Track 10"; base sensitivity: "a" and "A" tie,
// so the stable sort keeps their incoming order instead of splitting on case.
const compareText = (a: string, b: string) =>
    a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })

/**
 * The tracks as the view shows them: filtered (AND across the active chips),
 * then sorted. Returns a new array and never touches the input.
 *
 * Ties keep the incoming order, which is the playlist's own order, because
 * Array.prototype.sort is stable and `reverse` flips the comparator rather than
 * the array. Tracks without an `added_at` go last in BOTH directions: a flip
 * would otherwise float the ones we know nothing about to the top.
 */
export function shapeTracks<T extends Track>(
    tracks: T[],
    sortBy: PlaylistSortKey,
    reverse: boolean,
    filters: PlaylistFilters
): T[] {
    const kept = tracks.filter(track => passes(track, filters))
    if (!sortBy) return kept

    const dir = reverse ? -1 : 1

    return kept.sort((a, b) => {
        switch (sortBy) {
            case 'title':
                return dir * compareText(a.title ?? '', b.title ?? '')
            case 'artist':
                return dir * compareText(a.artists?.[0]?.name ?? '', b.artists?.[0]?.name ?? '')
            case 'album':
                return dir * compareText(a.album ?? '', b.album ?? '')
            case 'duration':
                return dir * ((a.duration ?? 0) - (b.duration ?? 0))
            case 'playcount':
                return dir * ((a.playcount ?? 0) - (b.playcount ?? 0))
            case 'added': {
                const av = a.added_at ?? null
                const bv = b.added_at ?? null
                if (av === null || bv === null) {
                    if (av === bv) return 0
                    return av === null ? 1 : -1
                }
                return dir * (av - bv)
            }
            default:
                return 0
        }
    })
}

export function isViewShaped(sortBy: PlaylistSortKey, filters: PlaylistFilters): boolean {
    return sortBy !== '' || filters.unplayed || filters.favorites || filters.topRated
}
