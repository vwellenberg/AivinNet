import { readFileSync } from 'node:fs'

import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import TypedDynamicScroller from '@/components/shared/TypedDynamicScroller.vue'
import { typeRows, viewType } from '@/utils/typedScroller'

// ---------------------------------------------------------------------------
// One view pool per component. With one pool for the whole page, the album
// head was rebuilt inside a view that had shown a card row at the bottom, and
// its buttons popped in again on the way back up (twice, with the re-sort).
// RecycleScroller keeps a pool per row `type`; the app's DynamicScroller hands
// it one through typedRows().
// ---------------------------------------------------------------------------

// The real RecycleScroller needs layout (ResizeObserver, element sizes), which
// jsdom does not have. The stub records what the wrapper hands it — the rows
// and the `type-field` — and renders the default slot once per row, the way the
// real one does, so the slot contract the pages rely on is exercised too.
// useDynamicScroller stays real.
const recycle = vi.hoisted(() => ({ calls: [] as { items: unknown[]; attrs: Record<string, unknown> }[] }))

vi.mock('vue-virtual-scroller', async (importOriginal) => {
    const real = await importOriginal<typeof import('vue-virtual-scroller')>()
    const RecycleScroller = defineComponent({
        name: 'RecycleScroller',
        inheritAttrs: false,
        props: { items: { type: Array, default: () => [] } },
        setup(props, { attrs, slots }) {
            return () => {
                recycle.calls.push({ items: props.items as unknown[], attrs: { ...attrs } })
                const rows = props.items as unknown[]
                return h(
                    'div',
                    rows.map((row, index) => slots.default?.({ item: row, index, active: true })),
                )
            }
        },
    })
    return { ...real, RecycleScroller }
})

const Header = { name: 'Header' }
const SongItem = { name: 'SongItem' }

describe('typed rows', () => {
    it('gives every row the component it renders as its pool type', () => {
        const rows = typeRows([
            { item: { id: 'album-header', component: Header }, id: 'album-header', size: 0 },
            { item: { id: 'a.mp3', component: SongItem }, id: 'a.mp3', size: 72 },
            { item: { id: 'b.mp3', component: SongItem }, id: 'b.mp3', size: 72 },
        ])
        expect(rows.map((r) => r.type)).toEqual([Header, SongItem, SongItem])
    })

    it("types the library's rows in place: same array, same row objects, fields kept", () => {
        // A copy per size flush would refire RecycleScroller's items watcher on every
        // measurement batch while scrolling a long list.
        const item = { id: 'a.mp3', component: SongItem }
        const source = [{ item, id: 'a.mp3', size: 72 }]
        const rows = typeRows(source)
        expect(rows).toBe(source)
        expect(rows[0]).toBe(source[0])
        expect(rows[0]).toMatchObject({ item, id: 'a.mp3', size: 72, type: SongItem })
    })

    it('leaves items without a component in the one shared pool, as before', () => {
        expect(viewType('a plain string')).toBeUndefined()
        expect(viewType(null)).toBeUndefined()
        expect(viewType({ id: 1 })).toBeUndefined()
    })
})

describe('TypedDynamicScroller', () => {
    it('hands RecycleScroller rows that carry a type, under type-field "type"', () => {
        recycle.calls.length = 0
        mount(TypedDynamicScroller, {
            props: {
                items: [
                    { id: 'album-header', component: Header },
                    { id: 'a.mp3', component: SongItem },
                    { id: 'b.mp3', component: SongItem },
                ],
                minItemSize: 64,
            },
        })
        const last = recycle.calls.at(-1)
        expect(last).toBeDefined()
        expect(last!.attrs['type-field']).toBe('type')
        expect(last!.attrs['key-field']).toBe('id')
        expect(last!.items.map((r) => (r as { type: unknown }).type)).toEqual([Header, SongItem, SongItem])
    })

    it('keeps the library row shape: item, id and the measured size', () => {
        recycle.calls.length = 0
        const item = { id: 'a.mp3', component: SongItem }
        mount(TypedDynamicScroller, { props: { items: [item] } })
        const row = recycle.calls.at(-1)!.items[0] as Record<string, unknown>
        expect(row).toMatchObject({ item, id: 'a.mp3' })
        expect(typeof row.size).toBe('number')
    })

    it('hands each page slot the item itself, its index and the active flag', () => {
        const seen: unknown[] = []
        const item = { id: 'a.mp3', component: SongItem }
        mount(TypedDynamicScroller, {
            props: { items: [item] },
            slots: {
                default: (props: { item: unknown; index: number; active: boolean }) => {
                    seen.push(props)
                    return h('span')
                },
            },
        })
        expect(seen.at(-1)).toMatchObject({ item, index: 0, active: true })
    })

    it('keeps its own type-field even when a page passes one', () => {
        recycle.calls.length = 0
        mount(TypedDynamicScroller, {
            props: { items: [{ id: 'a.mp3', component: SongItem }] },
            // `key-field` is a real prop (the items' own key) and never reaches the attrs;
            // `type-field` is not, and a page copying SearchView/tracks.vue might pass it.
            attrs: { 'type-field': 'component' },
        })
        const last = recycle.calls.at(-1)!
        expect(last.attrs['type-field']).toBe('type')
    })

    it('is what the app registers as DynamicScroller', () => {
        const main = readFileSync('src/main.ts', 'utf8')
        expect(main).toMatch(/app\.component\("DynamicScroller", TypedDynamicScroller\)/)
        expect(main).toMatch(/import TypedDynamicScroller from "\.\/components\/shared\/TypedDynamicScroller\.vue"/)
    })
})
