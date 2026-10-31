import { mount } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'
import { routeLocationKey } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SeasonVampire from '@/components/SeasonVampire.vue'
import { PEEK_DELAY_MIN_MS, PEEK_DURATION_MS } from '@/utils/vampirePeek'

// The clock and the overlay. The choice of card and the timing are unit-tested in
// utils/__tests__/vampirePeek.test.ts; here: it peeks, it ends, it books the next
// one, it stays quiet when there is nothing to peek over, and it leaves no timer
// behind. `Math.random` is pinned to 0, so the first delay is exactly the minimum.

function stubMatchMedia(reduce: boolean) {
    window.matchMedia = vi.fn((query: string) => ({
        matches: reduce && query.includes('prefers-reduced-motion: reduce'),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
    })) as any
}

function setVisibility(state: 'visible' | 'hidden') {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
}

/** A card cover fully inside the 1000 x 800 viewport, 100 px from the left, 200 px from the top. */
function coverInView(): HTMLElement {
    const el = document.createElement('div')
    el.className = 'card-art'
    el.getBoundingClientRect = () => ({ top: 200, left: 100, width: 150, height: 150, bottom: 350, right: 250 }) as DOMRect
    document.body.appendChild(el)
    return el
}

function mountVampire() {
    return mount(SeasonVampire, {
        global: { provide: { [routeLocationKey as symbol]: reactive({ fullPath: '/' }) } },
        attachTo: document.body,
    })
}

/** Advance the clock and let Vue paint what the timers changed. */
async function advance(ms: number): Promise<void> {
    vi.advanceTimersByTime(ms)
    await nextTick()
}

beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    stubMatchMedia(false)
    setVisibility('visible')
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
})

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    delete (document as any).visibilityState
})

describe('SeasonVampire: the peek', () => {
    it('does not show before its first delay', async () => {
        coverInView()
        const wrapper = mountVampire()
        await advance(PEEK_DELAY_MIN_MS - 1)
        expect(wrapper.find('.season-peek').exists()).toBe(false)
        wrapper.unmount()
    })

    it('peeks over a visible cover, anchored at the middle of its top edge', async () => {
        coverInView()
        const wrapper = mountVampire()
        await advance(PEEK_DELAY_MIN_MS)
        const peek = wrapper.find('.season-peek')
        expect(peek.exists()).toBe(true)
        expect(peek.attributes('aria-hidden')).toBe('true')
        const style = (peek.element as HTMLElement).style
        expect(style.getPropertyValue('--peek-x')).toBe('175px')
        expect(style.getPropertyValue('--peek-y')).toBe('200px')
        wrapper.unmount()
    })

    it('ends by itself after the whole sequence, and books the next peek', async () => {
        coverInView()
        const wrapper = mountVampire()
        await advance(PEEK_DELAY_MIN_MS)
        expect(wrapper.find('.season-peek').exists()).toBe(true)

        await advance(PEEK_DURATION_MS)
        expect(wrapper.find('.season-peek').exists()).toBe(false)

        // The next one comes after another delay, not at once.
        await advance(PEEK_DELAY_MIN_MS)
        expect(wrapper.find('.season-peek').exists()).toBe(true)
        wrapper.unmount()
    })

    it('skips the peek when no cover fits the viewport, and tries again later', async () => {
        const wrapper = mountVampire()
        await advance(PEEK_DELAY_MIN_MS)
        expect(wrapper.find('.season-peek').exists()).toBe(false)

        coverInView()
        await advance(PEEK_DELAY_MIN_MS)
        expect(wrapper.find('.season-peek').exists()).toBe(true)
        wrapper.unmount()
    })

    it('draws nothing under "reduce motion"', async () => {
        stubMatchMedia(true)
        coverInView()
        const wrapper = mountVampire()
        await advance(PEEK_DELAY_MIN_MS * 3)
        expect(wrapper.find('.season-peek').exists()).toBe(false)
        wrapper.unmount()
    })

    it('does not peek while the tab is hidden', async () => {
        setVisibility('hidden')
        coverInView()
        const wrapper = mountVampire()
        await advance(PEEK_DELAY_MIN_MS * 3)
        expect(wrapper.find('.season-peek').exists()).toBe(false)
        wrapper.unmount()
    })
})

describe('SeasonVampire: no timer outlives the component', () => {
    it('clears every timer on unmount, even mid-peek', async () => {
        coverInView()
        const wrapper = mountVampire()
        await advance(PEEK_DELAY_MIN_MS)
        expect(wrapper.find('.season-peek').exists()).toBe(true)

        wrapper.unmount()
        expect(vi.getTimerCount()).toBe(0)
    })
})
