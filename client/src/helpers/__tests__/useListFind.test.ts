import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

const modal = { visible: false }
const menu = { visible: false }
vi.mock('@/stores/modal', () => ({ default: () => modal }))
vi.mock('@/stores/context', () => ({ default: () => menu }))

import { useListFind } from '../useListFind'
import { handleFindShortcut } from '@/utils/pageFind'

// jsdom lays nothing out: every box is 0×0, so the field reads as scrolled
// away and the hook scrolls the list back to the top.
Element.prototype.scrollTo = vi.fn()

const press = () => new KeyboardEvent('keydown', { key: 'f', metaKey: true, cancelable: true })

function host(canFind: () => boolean) {
    return mount(
        defineComponent({
            setup() {
                useListFind('list-find-test', 'list-find-scroller', canFind)
                return () => h('div', { id: 'list-find-scroller' }, [h('input', { id: 'list-find-test' })])
            },
        }),
        { attachTo: document.body }
    )
}

// A list page hands Cmd/Ctrl+F to its own field — but only while there is
// something to search and nothing sits over the list.
describe('useListFind', () => {
    afterEach(() => {
        modal.visible = false
        menu.visible = false
        document.body.innerHTML = ''
    })

    it('takes the shortcut while the page has something to search', () => {
        const wrapper = host(() => true)
        expect(handleFindShortcut(press())).toBe(true)
        wrapper.unmount()
    })

    it("leaves it to the browser when the page declines, a modal or a menu is open, or it is gone", () => {
        const declined = host(() => false)
        expect(handleFindShortcut(press())).toBe(false)
        declined.unmount()

        const wrapper = host(() => true)
        modal.visible = true
        expect(handleFindShortcut(press())).toBe(false)
        modal.visible = false
        menu.visible = true
        expect(handleFindShortcut(press())).toBe(false)
        menu.visible = false

        wrapper.unmount()
        expect(handleFindShortcut(press())).toBe(false)
    })
})

// While a find is on, the list is held at the top, where the best match is:
// the scroller otherwise keeps whichever row was at the top in place, and when
// the rest of the list arrives for the search it follows that row into the
// middle of the matches.
describe('useListFind holds the list at the top', () => {
    afterEach(() => {
        document.body.innerHTML = ''
        vi.restoreAllMocks()
    })

    async function setup() {
        const { ref, nextTick } = await import('vue')
        const query = ref('')
        const rows = ref<number[]>([1, 2, 3])
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => {
            cb(0)
            return 0
        })
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
        const wrapper = mount(
            defineComponent({
                setup() {
                    useListFind('list-find-test', 'list-find-scroller', () => true, {
                        query: () => query.value,
                        rows: () => rows.value,
                        at: 'top',
                    })
                    return () => h('div', { id: 'list-find-scroller' }, [h('input', { id: 'list-find-test' })])
                },
            }),
            { attachTo: document.body }
        )
        const scroller = document.getElementById('list-find-scroller')!
        // Somewhere down the list, so a hold has somewhere to go.
        Object.defineProperty(scroller, 'scrollTop', { value: 500, configurable: true })
        const scrollTo = vi.fn()
        scroller.scrollTo = scrollTo as any
        return { query, rows, nextTick, wrapper, scroller, scrollTo }
    }

    it('scrolls to the top when the query changes and again when its rows arrive', async () => {
        const { query, rows, nextTick, scrollTo, wrapper } = await setup()
        query.value = 'song'
        await nextTick()
        expect(scrollTo).toHaveBeenCalledTimes(1)

        rows.value = [1, 2, 3, 4, 5]
        await nextTick()
        expect(scrollTo).toHaveBeenCalledTimes(2)
        expect(scrollTo).toHaveBeenLastCalledWith({ top: 0 })
        wrapper.unmount()
    })

    it('lets go once the reader scrolls, and does nothing without a query', async () => {
        const { query, rows, nextTick, scroller, scrollTo, wrapper } = await setup()
        rows.value = [9]
        await nextTick()
        expect(scrollTo).not.toHaveBeenCalled()

        query.value = 'song'
        await nextTick()
        scroller.dispatchEvent(new Event('wheel'))
        rows.value = [1, 2]
        await nextTick()
        expect(scrollTo).toHaveBeenCalledTimes(1)
        wrapper.unmount()
    })
})

describe('useListFind hold details', () => {
    afterEach(() => {
        document.body.innerHTML = ''
        vi.restoreAllMocks()
    })

    it("does not let go for keys typed into the find, and keeps the field's row in view with at: 'field'", async () => {
        const { ref, nextTick } = await import('vue')
        const query = ref('')
        const rows = ref<number[]>([1])
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => {
            cb(0)
            return 0
        })
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
        const wrapper = mount(
            defineComponent({
                setup() {
                    useListFind('list-find-test', 'list-find-scroller', () => true, {
                        query: () => query.value,
                        rows: () => rows.value,
                        at: 'field',
                    })
                    return () =>
                        h('div', { id: 'list-find-scroller' }, [
                            h('label', { class: 'list-find' }, [h('input', { id: 'list-find-test' })]),
                        ])
                },
            }),
            { attachTo: document.body }
        )
        const scroller = document.getElementById('list-find-scroller')!
        const field = scroller.querySelector('.list-find')!
        Object.defineProperty(scroller, 'scrollTop', { value: 100, configurable: true })
        scroller.getBoundingClientRect = () => ({ top: 50 }) as DOMRect
        // The field sits 300 px into the viewport: 100 scrolled + 300 - 8 air.
        field.getBoundingClientRect = () => ({ top: 350 }) as DOMRect
        const scrollTo = vi.fn()
        scroller.scrollTo = scrollTo as any

        query.value = 's'
        await nextTick()
        document.getElementById('list-find-test')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        rows.value = [1, 2]
        await nextTick()

        expect(scrollTo).toHaveBeenCalledTimes(2)
        expect(scrollTo).toHaveBeenLastCalledWith({ top: 392 })
        wrapper.unmount()
    })
})
