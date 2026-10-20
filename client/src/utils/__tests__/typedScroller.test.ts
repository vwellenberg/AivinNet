import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

// @ts-ignore — the library ships no type declarations
import { DynamicScroller } from 'vue-virtual-scroller'

import { TypedDynamicScroller, viewType } from '@/utils/typedScroller'

// ---------------------------------------------------------------------------
// One view pool per component. With one pool for the whole page, the album
// head was rebuilt inside a view that had shown a card row at the bottom, and
// its buttons popped in again on the way back up (twice, with the re-sort).
// RecycleScroller keeps a pool per row `type`; the copy hands it one.
// ---------------------------------------------------------------------------

const Header = { name: 'Header' }
const SongItem = { name: 'SongItem' }

/** What `DynamicScroller`'s computed reads from `this`. */
function scrollerThis(items: unknown[], sizes: Record<string, number> = {}) {
    return {
        items,
        keyField: 'id',
        simpleArray: false,
        vscrollData: { sizes },
        $_undefinedMap: {},
    }
}

describe('typed DynamicScroller', () => {
    const itemsWithSize = TypedDynamicScroller.computed.itemsWithSize

    it('gives every row the component it renders as its pool type', () => {
        const rows = itemsWithSize.call(
            scrollerThis([
                { id: 'album-header', component: Header },
                { id: 'a.mp3', component: SongItem },
                { id: 'b.mp3', component: SongItem },
            ])
        )
        expect(rows.map((r: { type?: unknown }) => r.type)).toEqual([Header, SongItem, SongItem])
    })

    it("keeps the library's own row fields (item, id, measured size)", () => {
        const item = { id: 'a.mp3', component: SongItem }
        const [row] = itemsWithSize.call(scrollerThis([item], { 'a.mp3': 72 })) as unknown as {
            item: unknown
            id: unknown
            size: unknown
        }[]
        expect(row).toMatchObject({ item, id: 'a.mp3', size: 72 })
    })

    it('leaves items without a component in the one shared pool, as before', () => {
        expect(viewType('a plain string')).toBeUndefined()
        expect(viewType(null)).toBeUndefined()
        expect(viewType({ id: 1 })).toBeUndefined()
    })

    it("is the library's component otherwise — render, props, provide — and leaves that one untouched", () => {
        // A version bump that renames the computed must fail HERE, not drop the
        // type silently and bring the rebuilt heads back.
        expect(typeof DynamicScroller.computed.itemsWithSize).toBe('function')
        expect(TypedDynamicScroller.render).toBe(DynamicScroller.render)
        expect(TypedDynamicScroller.props).toBe(DynamicScroller.props)
        expect(TypedDynamicScroller.provide).toBe(DynamicScroller.provide)
        expect(DynamicScroller.computed.itemsWithSize).not.toBe(itemsWithSize)
    })

    it('reaches RecycleScroller under the field it reads the type from', () => {
        // `typeField` defaults to "type"; DynamicScroller passes no other.
        const src = readFileSync('node_modules/vue-virtual-scroller/dist/vue-virtual-scroller.esm.js', 'utf8')
        expect(src).toMatch(/typeField:\s*\{\s*type: String,\s*default: 'type',/)
    })

    it('is what the app registers as DynamicScroller', () => {
        const main = readFileSync('src/main.ts', 'utf8')
        expect(main).toMatch(/app\.component\("DynamicScroller", TypedDynamicScroller\)/)
    })
})
