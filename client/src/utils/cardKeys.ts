/**
 * A stable `v-for` key for every card of a row: what the card SHOWS, not the
 * object that carries it.
 *
 * Rows used to key their cards by the item object itself. Every fetch hands
 * out new objects, so coming back to Home (cached rows first, the server's
 * answer a moment later) threw every card away and built it again — the
 * artwork reloaded and the arrival animation played a second time: Home
 * flickered (measured: 72 of 83 cards built twice at 1920px). Keyed by
 * identity, Vue patches the card in place and only a card that really changed
 * is rebuilt.
 *
 * The same entity twice in one row gets a running count, so keys stay unique.
 */

type RowCard = { type: string; item?: any }

function identity(card: RowCard): string | number | undefined {
    const item = card.item
    if (!item) return undefined

    switch (card.type) {
        case 'album':
            return item.albumhash
        case 'artist':
            return item.artisthash
        case 'track':
            return item.trackhash
        case 'folder':
            return item.path
        case 'playlist':
            return item.id
        case 'favorite':
            return 'favorites'
    }
}

export function cardKeys(cards: RowCard[]): string[] {
    const seen = new Map<string, number>()

    return cards.map((card, index) => {
        const id = identity(card)
        // Placeholders and unknown shapes have nothing to be: their place is all.
        const base = id == null || id === '' ? `${card.type}@${index}` : `${card.type}:${id}`
        const n = seen.get(base) ?? 0
        seen.set(base, n + 1)

        // The count goes in FRONT: a type never starts with "#", while an id
        // (a folder path) may well end in "#1".
        return n ? `#${n} ${base}` : base
    })
}
