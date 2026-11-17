import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

// ---------------------------------------------------------------------------
// A tap on the search pill types into the field (Galaxy S22 + Vivaldi, 2026-11-17).
//
// "Tapping the search bar opens no keyboard." The visible pill is `#ginner`;
// the <input> inside it is narrower — on a 360px phone 174x36 of a 225x62
// pill. A tap beside the text (where the hidden clear button sits) landed on
// `#ginner`, which carried `tabindex="0"` and therefore took the focus itself:
// a focused <div>, so no keyboard. Measured on the built client in a 360x780
// touch profile: focus went to DIV#ginner before the fix, to the input after.
//
// Same root, second symptom: the clear button focused the pill, not the field,
// so clearing a query closed the phone keyboard.
// ---------------------------------------------------------------------------

const search = reactive({ query: '' })
vi.mock('@/stores/search', () => ({ default: () => search }))
vi.mock('@/stores/settings', () => ({ default: () => ({}) }))
vi.mock('@/stores/tabs', () => ({
    default: () => ({ current: 'queue', tabs: { search: 'search', queue: 'queue' }, switchToQueue: vi.fn(), switchToSearch: vi.fn() }),
}))

import SearchInput from '@/components/RightSideBar/SearchInput.vue'

function mountInput() {
    return mount(SearchInput, {
        props: { on_nav: true },
        attachTo: document.body,
        global: {
            directives: { 'auto-animate': {} },
            mocks: { $route: { name: 'SearchView' }, $router: { push: vi.fn() } },
        },
    })
}

let wrapper: ReturnType<typeof mountInput> | undefined

afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    search.query = ''
})

describe('SearchInput: the pill focuses the field', () => {
    it('finds the pill and the field (guard)', () => {
        wrapper = mountInput()
        expect(wrapper.find('#ginner').exists()).toBe(true)
        expect(wrapper.find('input#globalsearch').exists()).toBe(true)
    })

    it('the pill itself is no tab stop', () => {
        wrapper = mountInput()
        expect(wrapper.find('#ginner').attributes('tabindex')).toBeUndefined()
    })

    it('a tap on the pill beside the text focuses the input', async () => {
        wrapper = mountInput()
        await wrapper.find('#ginner').trigger('click')
        expect(document.activeElement).toBe(wrapper.find('input#globalsearch').element)
    })

    it('clearing the query keeps the focus in the input', async () => {
        wrapper = mountInput()
        search.query = 'primus'
        await wrapper.vm.$nextTick()
        await wrapper.find('.clear_input').trigger('click')
        expect(search.query).toBe('')
        expect(document.activeElement).toBe(wrapper.find('input#globalsearch').element)
    })

    it('a button in the pill keeps its own click (no focus grab)', async () => {
        wrapper = mountInput()
        await wrapper.find('#ginner button').trigger('click')
        expect(document.activeElement).not.toBe(wrapper.find('input#globalsearch').element)
    })
})
