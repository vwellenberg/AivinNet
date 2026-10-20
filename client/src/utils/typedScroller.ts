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
// `RecycleScroller` already keeps a separate pool per item `type`
// (`typeField`, default "type"); `DynamicScroller` just never passes one — its
// rows are `{ item, id, size }`. This copy adds `type: item.component`, so a
// view only ever shows the component it was built for and the scroller reuses
// it as it is. Registered under the library's own name in main.ts, so every
// page gets it without knowing. A plain `RecycleScroller` with mixed rows takes
// `type-field="component"` instead (SearchView/tracks.vue).
//
// The library object is copied, not patched: its own `DynamicScroller` stays as
// shipped, and a version bump that renames the computed fails loudly in
// typedScroller.test.ts instead of silently dropping the type.
// ---------------------------------------------------------------------------

import { toRaw } from 'vue'
// @ts-ignore — the library ships no type declarations
import { DynamicScroller } from 'vue-virtual-scroller'

/**
 * The pool a scroller item's view belongs to: the component it renders. Raw,
 * so an item that reached the scroller through reactive state does not open a
 * second pool for the same component.
 */
export function viewType(item: unknown): unknown {
    const component = item !== null && typeof item === 'object' ? (item as { component?: unknown }).component : undefined
    return component && typeof component === 'object' ? toRaw(component) : component
}

const baseItemsWithSize: (this: unknown) => { item: unknown; type?: unknown }[] =
    DynamicScroller.computed.itemsWithSize

export const TypedDynamicScroller = {
    ...DynamicScroller,
    computed: {
        ...DynamicScroller.computed,
        itemsWithSize(this: unknown) {
            const rows = baseItemsWithSize.call(this)
            for (const row of rows) row.type = viewType(row.item)
            return rows
        },
    },
}
