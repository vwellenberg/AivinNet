import type { SignalFind } from '@/requests/home'

/** What the plate draws of a find (#828), the same for an album and a track. */
export interface FindView {
    reason: string
    title: string
    artist: string
    image: string
    /** The title opens this album: the album itself, or the track's album. */
    albumhash: string
}

function names(artists: { name: string }[] | undefined): string {
    return (artists ?? []).map(a => a.name).join(', ')
}

export function findView(find: SignalFind): FindView {
    if (find.type === 'album') {
        const album = find.item
        return {
            reason: find.reason,
            title: album.title,
            artist: names(album.albumartists),
            image: album.image,
            albumhash: album.albumhash,
        }
    }

    const track = find.item
    return {
        reason: find.reason,
        title: track.title,
        artist: names(track.artists),
        image: track.image,
        albumhash: track.albumhash ?? '',
    }
}
