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

    it('draws the vampire and zombie as emoji and the monster as a pixel head', () => {
        const wrapper = mount(SeasonParticles, { props: { season: 'halloween' } })
        const glyphs = wrapper.findAll('.season-glyph').map((g) => g.text())
        expect(glyphs).toContain('🧛')
        expect(glyphs).toContain('🧟')
        expect(wrapper.findAll('.season-frankenstein .season-monster-face')).toHaveLength(1)
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
