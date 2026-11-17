import { Track } from '@/interfaces'

/**
 * The orders the artist's "all tracks" page offers. `plays` is the order the
 * server sends (`GET /artist/<hash>/tracks` sorts by playcount, most first),
 * so it is the list as it came, not a second sort.
 */
export type ArtistTrackSort = 'plays' | 'title' | 'album' | 'year'

export const ARTIST_TRACK_SORTS: { key: ArtistTrackSort; title: string }[] = [
    { key: 'plays', title: 'Most played' },
    { key: 'title', title: 'Title' },
    { key: 'album', title: 'Album' },
    { key: 'year', title: 'Newest' },
]

const text = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

/** Album order: the album, then disc and track number as tagged. */
function byAlbum(a: Track, b: Track) {
    return text.compare(a.album ?? '', b.album ?? '') || (a.disc ?? 0) - (b.disc ?? 0) || (a.track ?? 0) - (b.track ?? 0)
}

/**
 * The tracks in the chosen order, as a new list (the input stays as it is:
 * it is the server's playcount order, which `plays` hands back unchanged).
 *
 * `year` puts the newest release first and the tracks without a year tag
 * last; within one year the album order holds, so an album stays together.
 */
export function sortArtistTracks(tracks: Track[], sort: ArtistTrackSort): Track[] {
    const list = [...tracks]
    switch (sort) {
        case 'title':
            return list.sort((a, b) => text.compare(a.title ?? '', b.title ?? '') || byAlbum(a, b))
        case 'album':
            return list.sort(byAlbum)
        case 'year':
            return list.sort((a, b) => {
                const ya = a.year ?? -Infinity
                const yb = b.year ?? -Infinity
                if (ya !== yb) return ya < yb ? 1 : -1
                return byAlbum(a, b)
            })
        default:
            return list
    }
}

/** The tracks' summed length in seconds; a track without a duration counts as 0. */
export function totalSeconds(tracks: Track[]): number {
    return tracks.reduce((sum, t) => sum + (t.duration ?? 0), 0)
}
