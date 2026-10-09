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
