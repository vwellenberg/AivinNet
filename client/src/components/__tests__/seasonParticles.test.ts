import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SeasonParticles from '@/components/SeasonParticles.vue'
import { CHASE_ZOMBIES_MAX, CHASE_ZOMBIES_MIN, MAX_PARTICLES, ZOMBIE_GLYPHS } from '@/utils/seasonParticles'

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

    it('draws one sleigh at Christmas, reindeer first, and gives it a right-to-left crossing', () => {
        const wrapper = mount(SeasonParticles, { props: { season: 'christmas' } })
        const sleighs = wrapper.findAll('.season-particle.season-sleigh')
        expect(sleighs).toHaveLength(1)
        expect(sleighs[0].findAll('.season-glyph').map((g) => g.text())).toEqual(['🦌', '🦌', '🛷', '🎅'])
        expect(sleighs[0].classes()).not.toContain('is-ground')
        const style = (sleighs[0].element as HTMLElement).style
        expect(style.getPropertyValue('--season-from')).toBe('100vw')
        expect(style.getPropertyValue('--season-to')).toBe('calc(-100% - 1rem)')
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

    it('draws the chase as one group: the runner first, then a horde of zombies, each with its own glyph span', () => {
        const wrapper = mount(SeasonParticles, { props: { season: 'halloween' } })
        const chases = wrapper.findAll('.season-particle.season-chase')
        expect(chases).toHaveLength(1)
        const spans = chases[0].findAll('.season-glyph')
        const names = spans.map((g) => g.text())
        expect(names[0]).toBe('🏃')
        expect(names.length - 1).toBeGreaterThanOrEqual(CHASE_ZOMBIES_MIN)
        expect(names.length - 1).toBeLessThanOrEqual(CHASE_ZOMBIES_MAX)
        for (const z of names.slice(1)) expect(ZOMBIE_GLYPHS).toContain(z)
        // Each glyph carries its index, which staggers its bob, and the horde's size.
        const styles = spans.map((g) => g.element as HTMLElement)
        expect(styles.map((s) => s.style.getPropertyValue('--season-i'))).toEqual(names.map((_, i) => String(i)))
        expect(styles.every((s) => s.style.getPropertyValue('--season-n') === String(names.length))).toBe(true)
        // No lone zombie anywhere else on the page.
        expect(wrapper.findAll('.season-particle').filter((p) => p.classes().includes('season-zombie'))).toHaveLength(0)
    })

    it('places the chase as a cluster: the runner at the origin, each zombie at its own offset, the box sized to fit', () => {
        const wrapper = mount(SeasonParticles, { props: { season: 'halloween' } })
        const chase = wrapper.find('.season-particle.season-chase')
        const style = (chase.element as HTMLElement).style
        expect(style.getPropertyValue('--season-w')).toMatch(/^\d+(\.\d+)?$/)
        expect(style.getPropertyValue('--season-h')).toMatch(/^\d+(\.\d+)?$/)
        const spans = chase.findAll('.season-glyph').map((g) => g.element as HTMLElement)
        // The runner, the first span, is at the origin and drawn in front of the zombies.
        expect(spans[0].style.getPropertyValue('--season-gx')).toBe('0')
        expect(spans[0].style.getPropertyValue('--season-gy')).toBe('0')
        expect(spans[0].style.zIndex).toBe('200')
        for (const zombie of spans.slice(1)) {
            expect(Number(zombie.style.getPropertyValue('--season-gx'))).toBeGreaterThan(0)
            expect(Number(zombie.style.getPropertyValue('--season-gy'))).toBeLessThanOrEqual(0)
            expect(Number(zombie.style.zIndex)).toBeLessThan(200)
        }
    })

    it('leaves the sleigh a plain row: no per-glyph offsets', () => {
        const wrapper = mount(SeasonParticles, { props: { season: 'christmas' } })
        for (const g of wrapper.findAll('.season-particle.season-sleigh .season-glyph')) {
            expect((g.element as HTMLElement).style.getPropertyValue('--season-gx')).toBe('')
        }
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
