import { readFileSync } from 'fs'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MarqueeText from '../MarqueeText.vue'

// The marquee measures two widths: the box (`.marquee`) and the natural width of
// the text (`.marquee-text`). jsdom has no layout, so both are answered from
// variables the tests set. The getters look at the element's class, so one
// prototype stub serves both nodes without knowing which is which.

let boxWidth = 0
let textWidth = 0
let reduced = false
const listeners: Array<() => void> = []

beforeEach(() => {
    boxWidth = 120
    textWidth = 100
    reduced = false
    listeners.length = 0

    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
        configurable: true,
        get(this: HTMLElement) {
            return this.classList.contains('marquee') ? boxWidth : 0
        },
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
        configurable: true,
        get(this: HTMLElement) {
            return this.classList.contains('marquee-text') ? textWidth : 0
        },
    })

    vi.stubGlobal(
        'ResizeObserver',
        class {
            observe() {}
            unobserve() {}
            disconnect() {}
        },
    )
    vi.stubGlobal('matchMedia', (query: string) => ({
        get matches() {
            return query.includes('reduce') && reduced
        },
        media: query,
        addEventListener: (_: string, fn: () => void) => listeners.push(fn),
        removeEventListener: () => {},
    }))
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('MarqueeText', () => {
    it('stays a plain one-line ellipsis when the text fits', async () => {
        textWidth = 100
        const wrapper = mount(MarqueeText, { props: { text: 'Short' }, slots: { default: 'Short' } })
        await flushPromises()

        expect(wrapper.classes()).not.toContain('is-running')
        expect(wrapper.attributes('style') ?? '').not.toContain('--marquee-shift')
    })

    it('runs when the text overflows, with the shift and duration as inline properties', async () => {
        textWidth = 300
        const wrapper = mount(MarqueeText, { props: { text: 'Long title' }, slots: { default: 'Long title' } })
        await flushPromises()

        expect(wrapper.classes()).toContain('is-running')
        const style = wrapper.attributes('style') ?? ''
        // 300 px of text + 2 x 12 px of edge padding, less the 120 px box.
        expect(style).toContain('--marquee-shift: 204px')
        expect(style).toMatch(/--marquee-duration: [\d.]+s/)
    })

    it('never runs faster than a six-second pass', async () => {
        textWidth = 130
        const wrapper = mount(MarqueeText, { props: { text: 'Barely' }, slots: { default: 'Barely' } })
        await flushPromises()

        const seconds = Number((wrapper.attributes('style') ?? '').match(/--marquee-duration: ([\d.]+)s/)?.[1])
        expect(seconds).toBeGreaterThanOrEqual(6)
    })

    it('stays idle under reduced motion, even when the text overflows', async () => {
        reduced = true
        textWidth = 300
        const wrapper = mount(MarqueeText, { props: { text: 'Long title' }, slots: { default: 'Long title' } })
        await flushPromises()

        expect(wrapper.classes()).not.toContain('is-running')
    })

    it('stops when the reduced-motion setting is switched on while it runs', async () => {
        textWidth = 300
        const wrapper = mount(MarqueeText, { props: { text: 'Long title' }, slots: { default: 'Long title' } })
        await flushPromises()
        expect(wrapper.classes()).toContain('is-running')

        reduced = true
        listeners.forEach(fn => fn())
        await flushPromises()

        expect(wrapper.classes()).not.toContain('is-running')
    })

    it('re-measures when the text prop changes and restarts from rest', async () => {
        textWidth = 100
        const wrapper = mount(MarqueeText, { props: { text: 'Short' }, slots: { default: 'Short' } })
        await flushPromises()
        expect(wrapper.classes()).not.toContain('is-running')

        textWidth = 300
        await wrapper.setProps({ text: 'A much longer title' })
        await flushPromises()
        expect(wrapper.classes()).toContain('is-running')
    })

    it('keeps the text in the DOM once, so a screen reader reads it once', async () => {
        const wrapper = mount(MarqueeText, { props: { text: 'Echo' }, slots: { default: 'Echo' } })
        await flushPromises()

        expect(wrapper.html().split('Echo').length - 1).toBe(1)
    })
})

describe('the marquee is used on the cut-off titles', () => {
    const NOW_PLAYING = readFileSync('src/components/NowPlaying/NowPlayingInfo.vue', 'utf8')
    const LEFT = readFileSync('src/components/BottomBar/Left.vue', 'utf8')

    it('reads the files it checks', () => {
        expect(NOW_PLAYING).toContain('<template>')
        expect(LEFT).toContain('<template>')
    })

    it('wraps the Now Playing title and artist line', () => {
        expect(NOW_PLAYING).toMatch(/<MarqueeText class="title" :text="title">/)
        expect(NOW_PLAYING).toMatch(/<MarqueeText[^>]*class="artist-line"[^>]*>\s*<ArtistName/)
    })

    it('wraps the player bar title and artist line', () => {
        expect(LEFT).toMatch(/<MarqueeText class="track-title" :text="titleText">/)
        expect(LEFT).toMatch(/<MarqueeText class="artist-line"[^>]*>\s*<ArtistName/)
    })
})
