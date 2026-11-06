import { mount } from '@vue/test-utils'
import { defineComponent, h, withDirectives } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import vWave, { DISSOLVE_MS, DURATION_MS, WAVE_COLOR } from '@/directives/vWave'

const TOTAL_MS = DURATION_MS + DISSOLVE_MS
const ripples = (el: HTMLElement) => el.querySelectorAll(':scope > span[aria-hidden="true"]')

function press(el: HTMLElement, x: number, y: number) {
    el.dispatchEvent(new MouseEvent('pointerdown', { clientX: x, clientY: y, bubbles: true }))
}

function mountRow() {
    const Row = defineComponent({
        setup: () => () => withDirectives(h('div', { class: 'row' }, 'Home'), [[vWave]]),
    })
    const wrapper = mount(Row, { attachTo: document.body })
    const el = wrapper.element as HTMLElement
    // jsdom has no layout: the row is 100 x 50 at (10, 20).
    el.getBoundingClientRect = () => ({ left: 10, top: 20, width: 100, height: 50, right: 110, bottom: 70, x: 10, y: 20, toJSON: () => ({}) }) as DOMRect
    return { wrapper, el }
}

function setReducedMotion(reduce: boolean) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: reduce && query === '(prefers-reduced-motion: reduce)',
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia
}

describe('v-wave', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        setReducedMotion(false)
    })
    afterEach(() => {
        vi.useRealTimers()
        document.body.innerHTML = ''
        delete (window as { matchMedia?: unknown }).matchMedia
    })

    it('starts a ripple at the pointer, in the ink line colour, on a pressed row', () => {
        const { wrapper, el } = mountRow()
        press(el, 30, 45)

        const [span] = Array.from(ripples(el)) as HTMLElement[]
        expect(span).toBeTruthy()
        expect(span.style.left).toBe('20px') // 30 - 10
        expect(span.style.top).toBe('25px') // 45 - 20
        expect(span.style.background).toBe(WAVE_COLOR)
        expect(span.style.borderRadius).toBe('50%')
        // The ripple covers the far corner: 2.05 x the distance to it.
        expect(parseFloat(span.style.width)).toBeCloseTo(2.05 * Math.hypot(80, 25), 1) // the row is 100 wide and the pointer sits 20 px in
        wrapper.unmount()
    })

    it('makes the host a containing block clipped to its corners, and gives the styles back', () => {
        const { wrapper, el } = mountRow()
        expect(el.style.position).toBe('')

        press(el, 30, 45)
        expect(el.style.position).toBe('relative')
        expect(el.style.overflow).toBe('hidden')

        vi.advanceTimersByTime(TOTAL_MS)
        expect(el.style.position).toBe('')
        expect(el.style.overflow).toBe('')
        wrapper.unmount()
    })

    it('removes the ripple itself once it has scaled out and dissolved', () => {
        const { wrapper, el } = mountRow()
        press(el, 30, 45)

        vi.advanceTimersByTime(TOTAL_MS - 1)
        expect(ripples(el)).toHaveLength(1)

        vi.advanceTimersByTime(1)
        expect(ripples(el)).toHaveLength(0)
        wrapper.unmount()
    })

    it('keeps the host styles until the last of overlapping ripples is gone', () => {
        const { wrapper, el } = mountRow()
        press(el, 30, 45)
        vi.advanceTimersByTime(100)
        press(el, 40, 40)

        vi.advanceTimersByTime(TOTAL_MS - 100)
        expect(ripples(el)).toHaveLength(1)
        expect(el.style.position).toBe('relative')

        vi.advanceTimersByTime(100)
        expect(ripples(el)).toHaveLength(0)
        expect(el.style.position).toBe('')
        wrapper.unmount()
    })

    it('draws nothing under prefers-reduced-motion', () => {
        setReducedMotion(true)
        const { wrapper, el } = mountRow()
        press(el, 30, 45)

        expect(ripples(el)).toHaveLength(0)
        expect(el.style.position).toBe('')
        wrapper.unmount()
    })

    it('stops listening once the row is unmounted', () => {
        const { wrapper, el } = mountRow()
        wrapper.unmount()
        press(el, 30, 45)

        expect(ripples(el)).toHaveLength(0)
    })
})
