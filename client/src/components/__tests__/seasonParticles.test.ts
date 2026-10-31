import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SeasonParticles from '@/components/SeasonParticles.vue'
import { MAX_PARTICLES } from '@/utils/seasonParticles'

// The layer is CSS animation over a handful of DOM nodes, so these tests check
// what is drawn and when it is not: no season, reduced motion, the cap, and the
// hidden-tab pause. The motion itself is the stylesheet's.

/** `reduce` answers the OS "reduce motion" query; everything else is "no". */
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

beforeEach(() => {
    stubMatchMedia(false)
    setVisibility('visible')
})

afterEach(() => {
    delete (document as any).visibilityState
})

describe('SeasonParticles: drawn only while a season is active', () => {
    it('draws nothing with no season', () => {
        const wrapper = mount(SeasonParticles, { props: { season: null } })
        expect(wrapper.find('.season-particles').exists()).toBe(false)
        expect(wrapper.findAll('.season-particle')).toHaveLength(0)
    })

    it('draws the snow at Christmas', () => {
        const wrapper = mount(SeasonParticles, { props: { season: 'christmas' } })
        expect(wrapper.find('.season-particles').exists()).toBe(true)
        expect(wrapper.findAll('.season-particle.season-flake').length).toBeGreaterThan(0)
        expect(wrapper.findAll('.season-particle.season-bat')).toHaveLength(0)
    })

    it('draws the bats, ghosts and pumpkin at Halloween, each with its emoji', () => {
        const wrapper = mount(SeasonParticles, { props: { season: 'halloween' } })
        expect(wrapper.findAll('.season-bat')).toHaveLength(3)
        expect(wrapper.findAll('.season-ghost')).toHaveLength(2)
        expect(wrapper.findAll('.season-pumpkin')).toHaveLength(1)
        expect(wrapper.findAll('.season-glyph').map((g) => g.text())).toContain('🦇')
    })

    it('draws no vampire and no monster: those crossers are gone from the sky and the ground', () => {
        const wrapper = mount(SeasonParticles, { props: { season: 'halloween' } })
        const glyphs = wrapper.findAll('.season-glyph').map((g) => g.text())
        expect(glyphs).not.toContain('🧛')
        expect(wrapper.findAll('.season-vampire')).toHaveLength(0)
        expect(wrapper.findAll('.season-frankenstein')).toHaveLength(0)
        expect(wrapper.findAll('.season-monster-face')).toHaveLength(0)
    })

    it('draws the chase as one group: two zombies, then the runner last, each with its own glyph span', () => {
        const wrapper = mount(SeasonParticles, { props: { season: 'halloween' } })
        const chases = wrapper.findAll('.season-particle.season-chase')
        expect(chases).toHaveLength(1)
        const spans = chases[0].findAll('.season-glyph')
        expect(spans.map((g) => g.text())).toEqual(['🧟', '🧟‍♂️', '🏃'])
        // Each glyph carries its index, which staggers its bob.
        expect(spans.map((g) => (g.element as HTMLElement).style.getPropertyValue('--season-i'))).toEqual(['0', '1', '2'])
        // No lone zombie anywhere else on the page.
        expect(wrapper.findAll('.season-particle').filter((p) => p.classes().includes('season-zombie'))).toHaveLength(0)
    })

    it('anchors the ground lane to the player bar: the chase and the pumpkin carry is-ground, the sky does not', () => {
        const wrapper = mount(SeasonParticles, { props: { season: 'halloween' } })
        expect(wrapper.findAll('.season-particle.is-ground')).toHaveLength(2)
        expect(wrapper.find('.season-chase').classes()).toContain('is-ground')
        expect(wrapper.find('.season-pumpkin').classes()).toContain('is-ground')
        expect(wrapper.find('.season-bat').classes()).not.toContain('is-ground')
        expect(wrapper.find('.season-ghost').classes()).not.toContain('is-ground')
    })

    it('draws one spider, with its emoji, and gives it the lift-free drop variable', () => {
        const wrapper = mount(SeasonParticles, { props: { season: 'halloween' } })
        const spider = wrapper.find('.season-particle.season-spider')
        expect(spider.exists()).toBe(true)
        expect(spider.find('.season-glyph').text()).toBe('🕷️')
        expect((spider.element as HTMLElement).style.getPropertyValue('--season-drop')).toMatch(/^\d+(\.\d+)?vh$/)
    })

    it('is hidden from assistive technology: the layer is decoration', () => {
        const wrapper = mount(SeasonParticles, { props: { season: 'christmas' } })
        expect(wrapper.find('.season-particles').attributes('aria-hidden')).toBe('true')
    })

    it('goes away when the season ends, and comes back with the next one', async () => {
        const wrapper = mount(SeasonParticles, { props: { season: 'christmas' } })
        expect(wrapper.find('.season-particles').exists()).toBe(true)

        await wrapper.setProps({ season: null })
        expect(wrapper.find('.season-particles').exists()).toBe(false)

        await wrapper.setProps({ season: 'halloween' })
        expect(wrapper.findAll('.season-bat')).toHaveLength(3)
    })
})

describe('SeasonParticles: reduced motion draws nothing', () => {
    it('draws no snow under the OS "reduce motion" setting', () => {
        stubMatchMedia(true)
        const wrapper = mount(SeasonParticles, { props: { season: 'christmas' } })
        expect(wrapper.find('.season-particles').exists()).toBe(false)
    })

    it('draws no Halloween shapes under the OS "reduce motion" setting', () => {
        stubMatchMedia(true)
        const wrapper = mount(SeasonParticles, { props: { season: 'halloween' } })
        expect(wrapper.findAll('.season-particle')).toHaveLength(0)
    })

    it('still draws normally when the setting is off', () => {
        stubMatchMedia(false)
        const wrapper = mount(SeasonParticles, { props: { season: 'christmas' } })
        expect(wrapper.findAll('.season-particle').length).toBeGreaterThan(0)
    })
})

describe('SeasonParticles: the count is capped', () => {
    it('never renders more than MAX_PARTICLES', () => {
        for (const season of ['christmas', 'halloween'] as const) {
            const wrapper = mount(SeasonParticles, { props: { season } })
            expect(wrapper.findAll('.season-particle').length).toBeLessThanOrEqual(MAX_PARTICLES)
        }
    })
})

describe('SeasonParticles: a hidden tab pauses the animation', () => {
    it('is not paused while the tab is visible', () => {
        const wrapper = mount(SeasonParticles, { props: { season: 'christmas' } })
        expect(wrapper.find('.season-particles').classes()).not.toContain('is-paused')
    })

    it('is paused while the tab is hidden', () => {
        setVisibility('hidden')
        const wrapper = mount(SeasonParticles, { props: { season: 'christmas' } })
        expect(wrapper.find('.season-particles').classes()).toContain('is-paused')
    })
})
