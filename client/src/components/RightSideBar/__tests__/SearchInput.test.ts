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

    // "The keyboard only opens the first time" (S22 + Vivaldi, 2026-11-18):
    // closing the phone keyboard leaves the field focused, so the next tap is
    // a focus() on a focused element — a no-op, and no keyboard. A touch press
    // on the focused field re-focuses it inside the tap.
    describe('a second tap after the keyboard was closed', () => {
        async function tap(wrapper: ReturnType<typeof mountInput>, pointerType: string) {
            const field = wrapper.find('input#globalsearch')
            await field.trigger('pointerdown', { pointerType })
            await field.trigger('click')
        }

        function watchFocus(field: HTMLInputElement) {
            const log: string[] = []
            field.addEventListener('blur', () => log.push('blur'))
            field.addEventListener('focus', () => log.push('focus'))
            return log
        }

        it('touch on the focused field focuses it afresh', async () => {
            wrapper = mountInput()
            const field = wrapper.find('input#globalsearch').element as HTMLInputElement
            field.focus() // first tap: the keyboard opened, then was closed — focus stays
            const log = watchFocus(field)

            await tap(wrapper, 'touch')
            expect(log).toEqual(['blur', 'focus'])
            expect(document.activeElement).toBe(field)
        })

        it('touch on the pill beside the text does the same', async () => {
            wrapper = mountInput()
            const field = wrapper.find('input#globalsearch').element as HTMLInputElement
            field.focus()
            const log = watchFocus(field)

            const pill = wrapper.find('#ginner')
            await pill.trigger('pointerdown', { pointerType: 'touch' })
            await pill.trigger('click')
            expect(log).toEqual(['blur', 'focus'])
            expect(document.activeElement).toBe(field)
        })

        it('a mouse click on the focused field only places the caret', async () => {
            wrapper = mountInput()
            const field = wrapper.find('input#globalsearch').element as HTMLInputElement
            field.focus()
            const log = watchFocus(field)

            await tap(wrapper, 'mouse')
            expect(log).toEqual([])
            expect(document.activeElement).toBe(field)
        })

        it('the first touch on an unfocused field is a plain focus', async () => {
            wrapper = mountInput()
            const field = wrapper.find('input#globalsearch').element as HTMLInputElement
            const log = watchFocus(field)

            await tap(wrapper, 'touch')
            // The browser focuses the tapped field itself; the handler adds nothing.
            expect(log).toEqual([])
        })
    })

    it('a button in the pill keeps its own click (no focus grab)', async () => {
        wrapper = mountInput()
        await wrapper.find('#ginner button').trigger('click')
        expect(document.activeElement).not.toBe(wrapper.find('input#globalsearch').element)
    })
})
