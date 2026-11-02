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

describe('SeasonParticles: Christmas hangs a bell, tumbles a present and waddles penguins', () => {
    it('draws one bell on a thread: the hanger class, its emoji, and a gold or red ribbon variable', () => {
        const wrapper = mount(SeasonParticles, { props: { season: 'christmas' } })
        const bells = wrapper.findAll('.season-particle.season-bell')
        expect(bells).toHaveLength(1)
        expect(bells[0].classes()).toContain('is-hanger')
        expect(bells[0].classes()).not.toContain('is-ground')
        expect(bells[0].find('.season-glyph').text()).toBe('🔔')
        const ribbon = (bells[0].element as HTMLElement).style.getPropertyValue('--season-ribbon')
        expect(['var(--mem-gold)', 'var(--mem-coral)']).toContain(ribbon)
    })

    it('hangs the spider and the bell with the same class, and nothing else', () => {
        const halloween = mount(SeasonParticles, { props: { season: 'halloween' } })
        expect(halloween.find('.season-spider').classes()).toContain('is-hanger')
        expect(halloween.find('.season-spider').classes()).not.toContain('is-ground')
        for (const kind of ['bat', 'ghost', 'pumpkin', 'chase']) {
            expect(halloween.findAll(`.season-${kind}`).every((el) => !el.classes().includes('is-hanger'))).toBe(true)
        }
        const christmas = mount(SeasonParticles, { props: { season: 'christmas' } })
        expect(christmas.findAll('.is-hanger')).toHaveLength(1)
        expect(christmas.findAll('.season-sleigh').every((el) => !el.classes().includes('is-hanger'))).toBe(true)
    })

    it('gives the spider the line colour as its thread', () => {
        const wrapper = mount(SeasonParticles, { props: { season: 'halloween' } })
        const spider = wrapper.find('.season-spider').element as HTMLElement
        expect(spider.style.getPropertyValue('--season-ribbon')).toBe('var(--mem-line)')
    })

    it('draws one present on the ground lane, with its gift emoji', () => {
        const wrapper = mount(SeasonParticles, { props: { season: 'christmas' } })
        const presents = wrapper.findAll('.season-particle.season-present')
        expect(presents).toHaveLength(1)
        expect(presents[0].classes()).toContain('is-ground')
        expect(presents[0].classes()).not.toContain('is-hanger')
        expect(presents[0].find('.season-glyph').text()).toBe('🎁')
    })

    it('draws one waddle of 3 to 5 penguins, each with its own offset, the leader in front', () => {
        const wrapper = mount(SeasonParticles, { props: { season: 'christmas' } })
        const waddles = wrapper.findAll('.season-particle.season-waddle')
        expect(waddles).toHaveLength(1)
        expect(waddles[0].classes()).toContain('is-ground')
        const spans = waddles[0].findAll('.season-glyph')
        expect(spans.length).toBeGreaterThanOrEqual(3)
        expect(spans.length).toBeLessThanOrEqual(5)
        for (const s of spans) expect(s.text()).toBe('🐧')
        const leader = spans[0].element as HTMLElement
        expect(leader.style.getPropertyValue('--season-gx')).toBe('0')
        expect(leader.style.getPropertyValue('--season-gy')).toBe('0')
        expect(leader.style.zIndex).toBe('200')
        for (const follower of spans.slice(1)) {
            expect(Number((follower.element as HTMLElement).style.getPropertyValue('--season-gx'))).toBeGreaterThan(0)
        }
        const style = (waddles[0].element as HTMLElement).style
        expect(style.getPropertyValue('--season-from')).toBe('100vw')
        expect(style.getPropertyValue('--season-to')).toBe('calc(-100% - 1rem)')
    })

    it('draws none of the new Christmas shapes under the OS "reduce motion" setting', () => {
        stubMatchMedia(true)
        const wrapper = mount(SeasonParticles, { props: { season: 'christmas' } })
        expect(wrapper.findAll('.season-bell, .season-present, .season-waddle, .season-star')).toHaveLength(0)
        expect(wrapper.find('.season-drift').exists()).toBe(false)
    })
})

describe('SeasonParticles: a shooting star, and the snow drift on the bar', () => {
    it('draws one star in the sky with its emoji and no ground lane', () => {
        const wrapper = mount(SeasonParticles, { props: { season: 'christmas' } })
        const stars = wrapper.findAll('.season-particle.season-star')
        expect(stars).toHaveLength(1)
        expect(stars[0].classes()).not.toContain('is-ground')
        expect(stars[0].find('.season-glyph').text()).toBe('⭐')
    })

    it('draws the drift on the Christmas layer only, with its settle time from the particle model', () => {
        const christmas = mount(SeasonParticles, { props: { season: 'christmas' } })
        const drift = christmas.find('.season-drift')
        expect(drift.exists()).toBe(true)
        expect((drift.element as HTMLElement).style.getPropertyValue('--season-drift-dur')).toBe('210s')

        const halloween = mount(SeasonParticles, { props: { season: 'halloween' } })
        expect(halloween.find('.season-drift').exists()).toBe(false)
    })

    it('starts the drift over on every page change: a new navigation count is a new element', async () => {
        const wrapper = mount(SeasonParticles, { props: { season: 'christmas', navigation: 0 } })
        const before = wrapper.find('.season-drift').element
        await wrapper.setProps({ navigation: 1 })
        const after = wrapper.find('.season-drift').element
        expect(after).not.toBe(before)
        expect(wrapper.findAll('.season-drift')).toHaveLength(1)
    })

    it('keeps the drift while the page does not change', async () => {
        const wrapper = mount(SeasonParticles, { props: { season: 'christmas', navigation: 2 } })
        const before = wrapper.find('.season-drift').element
        await wrapper.setProps({ season: 'christmas' })
        expect(wrapper.find('.season-drift').element).toBe(before)
    })
})
