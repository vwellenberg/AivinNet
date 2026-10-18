import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { peeking } from '@/utils/settingsPeek'

import RangeInput from '../RangeInput.vue'

function render(props: Record<string, unknown> = {}) {
    const onChange = vi.fn()
    const wrapper = mount(RangeInput, {
        attachTo: document.body,
        props: {
            value: 192,
            min: 128,
            max: 288,
            step: 8,
            label: 'Tile size',
            format: (v: number) => `${v} px`,
            onChange,
            ...props,
        },
    })
    return { wrapper, onChange }
}

afterEach(() => {
    peeking.value = false
})

describe('RangeInput', () => {
    it('shows the value through the formatter', () => {
        const { wrapper } = render()

        expect(wrapper.find('.readout').text()).toBe('192 px')
        expect(wrapper.find('input').attributes('aria-valuetext')).toBe('192 px')
    })

    it('reports the new value as a number', async () => {
        const { wrapper, onChange } = render()
        const input = wrapper.find('input')

        // setValue() on a range input hands the component the OLD value
        // (testing.md): set the element, then trigger.
        ;(input.element as HTMLInputElement).value = '240'
        await input.trigger('input')

        expect(onChange).toHaveBeenCalledWith(240)
    })

    it('peeks only when asked to', async () => {
        const quiet = render()
        await quiet.wrapper.find('input').trigger('pointerdown')
        expect(peeking.value).toBe(false)
        quiet.wrapper.unmount()

        const peek = render({ peek: true })
        await peek.wrapper.find('input').trigger('pointerdown')
        expect(peeking.value).toBe(true)

        // Leaving the pane mid-drag must not strand the modal see-through.
        peek.wrapper.unmount()
        expect(peeking.value).toBe(false)
    })
})
