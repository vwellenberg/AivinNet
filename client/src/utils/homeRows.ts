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
}

export function playButtonLabel(rowKey: string | undefined): string {
    // Own keys only: a row key is server data, and `constructor` is no button.
    return rowKey && Object.prototype.hasOwnProperty.call(PLAY_BUTTONS, rowKey) ? PLAY_BUTTONS[rowKey] : 'Play all'
}
