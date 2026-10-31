import { mount } from '@vue/test-utils'
import { defineComponent, h, ref, withDirectives } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import vTip, { hideTip, SHOW_DELAY_MS } from '@/directives/vTip'

function pointer(type: string, pointerType: string): Event {
    const event = new Event(type, { bubbles: false })
    Object.defineProperty(event, 'pointerType', { value: pointerType })
    return event
}

const bubble = () => document.querySelector('.hover-tip') as HTMLElement | null
const shown = () => bubble()?.classList.contains('visible') ?? false

function mountButton(text = ref('Sleep timer')) {
    const Button = defineComponent({
        setup: () => () => withDirectives(h('button', 'z'), [[vTip, text.value]]),
    })
    const wrapper = mount(Button, { attachTo: document.body })
    return { wrapper, el: wrapper.element as HTMLElement, text }
}

describe('v-tip', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => {
        hideTip()
        vi.useRealTimers()
        document.body.innerHTML = ''
    })

    it('shows the hint after a short pause under the mouse, and hides it on leave', () => {
        const { el, wrapper } = mountButton()
        el.dispatchEvent(pointer('pointerenter', 'mouse'))
        expect(shown()).toBe(false)

        vi.advanceTimersByTime(SHOW_DELAY_MS)
        expect(shown()).toBe(true)
        expect(bubble()?.textContent).toBe('Sleep timer')
        expect(bubble()?.getAttribute('role')).toBe('tooltip')

        el.dispatchEvent(pointer('pointerleave', 'mouse'))
        expect(shown()).toBe(false)
        wrapper.unmount()
    })

    it('never shows for a touch, which has no hover and would cover the menu', () => {
        const { el, wrapper } = mountButton()
        el.dispatchEvent(pointer('pointerenter', 'touch'))
        vi.advanceTimersByTime(SHOW_DELAY_MS * 2)
        expect(shown()).toBe(false)
        wrapper.unmount()
    })

    it('does not show when the mouse leaves before the pause is over', () => {
        const { el, wrapper } = mountButton()
        el.dispatchEvent(pointer('pointerenter', 'mouse'))
        el.dispatchEvent(pointer('pointerleave', 'mouse'))
        vi.advanceTimersByTime(SHOW_DELAY_MS)
        expect(shown()).toBe(false)
        wrapper.unmount()
    })

    it('hides on a click, so the menu it opens is not covered', () => {
        const { el, wrapper } = mountButton()
        el.dispatchEvent(pointer('pointerenter', 'mouse'))
        vi.advanceTimersByTime(SHOW_DELAY_MS)
        el.dispatchEvent(pointer('pointerdown', 'mouse'))
        expect(shown()).toBe(false)
        wrapper.unmount()
    })

    it('names the button for a screen reader and follows a changing text', async () => {
        const { el, text, wrapper } = mountButton()
        expect(el.getAttribute('aria-label')).toBe('Sleep timer')

        el.dispatchEvent(pointer('pointerenter', 'mouse'))
        vi.advanceTimersByTime(SHOW_DELAY_MS)
        text.value = 'Sleep timer: 14 min left'
        await wrapper.vm.$nextTick()
        expect(el.getAttribute('aria-label')).toBe('Sleep timer: 14 min left')
        expect(bubble()?.textContent).toBe('Sleep timer: 14 min left')
        wrapper.unmount()
    })

    it('takes the hint away with the button', () => {
        const { el, wrapper } = mountButton()
        el.dispatchEvent(pointer('pointerenter', 'mouse'))
        vi.advanceTimersByTime(SHOW_DELAY_MS)
        wrapper.unmount()
        expect(shown()).toBe(false)
    })
})
