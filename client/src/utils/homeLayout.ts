/**
 * The Home rows in Settings → Home (#532): the list arithmetic, kept pure.
 *
 * The server owns the layout (`GET`/`PUT /nothome/layout`) and normalizes what
 * it is sent; these helpers only rearrange the rows on screen and say what to
 * send. Pinned rows ("Continue listening", drawn above every row anyway) can be
 * hidden but never moved, and always stay first.
 */
import type { HomeLayoutRow } from '@/requests/home'

/** The rows that can be moved, in order — the indices the drag works with. */
export function movableRows(rows: HomeLayoutRow[]): HomeLayoutRow[] {
    return rows.filter(row => !row.pinned)
}

/**
 * `rows` with the movable row at `from` put at `to` (both indices among the
 * movable rows). Pinned rows stay first. An index out of range moves nothing.
 */
export function moveRow(rows: HomeLayoutRow[], from: number, to: number): HomeLayoutRow[] {
    const movable = movableRows(rows)
    if (from === to || from < 0 || to < 0 || from >= movable.length || to >= movable.length) return rows

    const [moved] = movable.splice(from, 1)
    movable.splice(to, 0, moved)
    return [...rows.filter(row => row.pinned), ...movable]
}

/** `rows` with the row `key` shown if it was hidden and hidden if it was shown. */
export function toggleRow(rows: HomeLayoutRow[], key: string): HomeLayoutRow[] {
    return rows.map(row => (row.key === key ? { ...row, visible: !row.visible } : row))
}

/** The layout as `PUT /nothome/layout` takes it: every key in order, and the hidden ones. */
export function layoutPayload(rows: HomeLayoutRow[]): { order: string[]; hidden: string[] } {
    return {
        order: rows.map(row => row.key),
        hidden: rows.filter(row => !row.visible).map(row => row.key),
    }
}
