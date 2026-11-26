/**
 * The URL query for a pick in a sort menu (Playlists, Albums, Artists).
 *
 * Picking the active key flips the direction on screen. Picking another key
 * starts it where it reads best: a text key (a name, a title) A to Z, every
 * other key descending (most tracks, newest, most played first).
 */
export function nextSortQuery(
    current: { sortby: string; reverse: boolean },
    key: string,
    textKeys: readonly string[],
): { sortby: string; reverse: '0' | '1' } {
    if (key === current.sortby) return { sortby: key, reverse: current.reverse ? '0' : '1' }
    return { sortby: key, reverse: textKeys.includes(key) ? '0' : '1' }
}
