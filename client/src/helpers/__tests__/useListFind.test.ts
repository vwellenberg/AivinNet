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
