import { paths } from '@/config'
import useAxios from './useAxios'

export type ItemType = 'albums' | 'artists'

/**
 * One page of the whole album or artist list.
 *
 * Returns what `useAxios` returns — `{ status, data, error }` — instead of
 * unwrapping it. Both callers have to tell a failure from an empty page
 * themselves, and reading one as the other has already cost two bugs: a
 * dropped request that left the album list unable to load anything again, and
 * a 500 that cached a truncated artist list for the whole TTL.
 */
export async function getAllItems(
    itemtype: ItemType,
    options: { start: number; limit: number; sortby: string; reverse: string; artwork?: boolean }
) {
    const query = new URLSearchParams({
        start: String(options.start),
        limit: String(options.limit),
        sortby: options.sortby,
        reverse: options.reverse,
    })
    // `has_artwork` per item: whether the medium image is real artwork, not the
    // placeholder. Only Home's record crates ask; it costs the server a look
    // into the folder of every album without artwork.
    if (options.artwork) query.set('artwork', 'true')

    return await useAxios({
        url: `${paths.api.getall.base}/${itemtype}?${query}`,
        method: 'GET',
    })
}
