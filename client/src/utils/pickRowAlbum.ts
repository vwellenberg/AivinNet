/**
 * One album card of a Home row, at random — "Play one" on "Never played".
 *
 * Only album items count: a row can hold other card types, and a playlist or
 * a track would need another way to be played.
 */
export function pickRowAlbum(
    items: { type: string; item?: { albumhash?: string; title?: string } }[],
    random: () => number = Math.random
): { albumhash: string; title: string } | null {
    const albums = items.filter(i => i.type === 'album' && i.item?.albumhash)
    if (!albums.length) return null

    const pick = albums[Math.min(Math.floor(random() * albums.length), albums.length - 1)].item!
    return { albumhash: pick.albumhash!, title: pick.title ?? '' }
}
