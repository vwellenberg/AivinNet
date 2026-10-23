/**
 * Small pure helpers behind Home's recommendation rows (#138).
 */

type RowItem = { type: string; item?: any; with_helptext?: boolean }

export interface RowChip {
    key: string
    label: string
    items: RowItem[]
}

/**
 * The items a row shows: the selected chip's, or the row's own when no chip
 * is selected — or when the selected one is gone (the server recomputes the
 * chips every few hours, a kept selection may name a genre no longer there).
 */
export function chipItems(rowItems: RowItem[], chips: RowChip[] | undefined, selected: string | null): RowItem[] {
    if (!selected) return rowItems
    return chips?.find(c => c.key === selected)?.items ?? rowItems
}

/**
 * The play button of a row the server also serves as a playlist (the row's
 * `playlist`, sent by the server). Most say "Play all"; these say what they
 * play instead.
 */
const PLAY_BUTTONS: Record<string, string> = {
    // One track per album of the row, not the albums in full.
    because_you_listened: 'Play mix',
    // The day a year ago in the order it was heard, not just its albums.
    on_this_day: 'Play that day',
    // Only the songs never played, album after album (#529).
    almost_complete: 'Play the rest',
}

export function playButtonLabel(rowKey: string | undefined): string {
    // Own keys only: a row key is server data, and `constructor` is no button.
    return rowKey && Object.prototype.hasOwnProperty.call(PLAY_BUTTONS, rowKey) ? PLAY_BUTTONS[rowKey] : 'Play all'
}

export function cardHash(card: RowItem): string | undefined {
    return card.type === 'album' ? card.item?.albumhash : card.item?.artisthash
}

// A chip that leads to one album is no choice — the server's NEVER_CHIP_MIN,
// which it applies to a row with a mark taken out as well.
const CHIP_MIN = 2

/**
 * A row's items and chips without the card `hash` — "Not interested" (#531),
 * which the server leaves out from now on. A chip left with fewer than two
 * cards goes, as it would on the server.
 */
export function withoutCard(
    items: RowItem[],
    chips: RowChip[] | undefined,
    hash: string
): { items: RowItem[]; chips: RowChip[] | undefined } {
    const keep = (card: RowItem) => cardHash(card) !== hash
    return {
        items: items.filter(keep),
        chips: chips
            ?.map(chip => ({ ...chip, items: chip.items.filter(keep) }))
            .filter(chip => chip.items.length >= CHIP_MIN),
    }
}

/**
 * `items` with `card` back at `index`, unless it is there already. Putting a
 * card back by itself, not the whole list it was taken from: a second card
 * marked meanwhile must stay out (#531).
 */
export function withCardAt(items: RowItem[], card: RowItem, index: number): RowItem[] {
    const hash = cardHash(card)
    if (items.some(i => cardHash(i) === hash)) return items
    const at = Math.min(index, items.length)
    return [...items.slice(0, at), card, ...items.slice(at)]
}
