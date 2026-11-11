// ---------------------------------------------------------------------------
// One view pool PER COMPONENT, not one for the whole page.
//
// The detail pages render a mixed list through one `DynamicScroller`: the album
// page is head, disc bar, track rows, genre banner, card rows and stats, each
// item naming its `component`. The scroller recycles views — a view that left
// the screen is handed to the next item that needs one — and it did so across
// components: the view that showed "More from …" at the bottom became the head
// or a track row on the way back up. Vue cannot turn a card row into a head, so
// `<component :is>` threw the subtree away and built a NEW one, and a new node
// plays its arrival. Reported as "scroll down, then fast back up: it pops in
// twice" — the head's buttons and the disc sticker built themselves up again,
// and the scroller's re-sort moved them and replayed it (utils/arrivalLatch.ts
// takes care of that second half).
//
// `RecycleScroller` keeps a separate pool per row `type` (`typeField`, default
// "type"). The library's DynamicScroller (3.x) builds rows `{ item, id, size }`
// without a type, so the app's `DynamicScroller` (components/shared/
// TypedDynamicScroller.vue) adds one per row through `typedRows()` below.
// A plain `RecycleScroller` with mixed rows takes `type-field="component"`
// instead (SearchView/tracks.vue).
// ---------------------------------------------------------------------------

import { toRaw } from 'vue'

/**
 * The pool a scroller item's view belongs to: the component it renders. Raw,
 * so an item that reached the scroller through reactive state does not open a
 * second pool for the same component.
 */
export function viewType(item: unknown): unknown {
    const component = item !== null && typeof item === 'object' ? (item as { component?: unknown }).component : undefined
    return component && typeof component === 'object' ? toRaw(component) : component
}

/** Copies each library row with its pool type; the library's own fields stay as they are. */
export function typedRows<T extends { item: unknown }>(rows: T[]): (T & { type: unknown })[] {
    return rows.map((row) => ({ ...row, type: viewType(row.item) }))
}
