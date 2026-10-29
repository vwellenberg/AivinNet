import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { homeMock, tuneStation, resumeMusic, muteForTuning, crackle } = vi.hoisted(() => ({
    homeMock: { homepageItems: [] as any[] },
    tuneStation: vi.fn(async () => {}),
    resumeMusic: vi.fn(),
    muteForTuning: vi.fn(),
    crackle: vi.fn(),
}))

vi.mock('@/stores/home', () => ({ default: () => homeMock }))
vi.mock('@/helpers/radio', () => ({ tuneStation, resumeMusic, muteForTuning, crackle }))

import RadioDial from '@/components/HomeView/RadioDial.vue'

// "Your mixes" as the home store holds it: playlist cards, one per mix slot.
const mixRow = (ids: string[]) => ({
    key: 'your_mixes',
    items: ids.map((id, i) => ({ type: 'playlist', item: { id, name: `Mix ${i + 1}`, count: 30 } })),
})

const dial = (w: ReturnType<typeof mount>) => w.get('[role="slider"]')

describe('RadioDial', () => {
    beforeEach(() => {
        homeMock.homepageItems = []
        tuneStation.mockClear()
        resumeMusic.mockClear()
        muteForTuning.mockClear()
        crackle.mockClear()
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('shows nothing without mixes', () => {
        const w = mount(RadioDial)

        expect(w.find('.radio-card').exists()).toBe(false)
    })

    it('is a slider over the mixes, naming the station in aria-valuetext', () => {
        homeMock.homepageItems = [mixRow(['mix1', 'mix2', 'mix3'])]
        const w = mount(RadioDial)

        const el = dial(w)
        expect(el.attributes('role')).toBe('slider')
        expect(el.attributes('aria-valuemin')).toBe('1')
        expect(el.attributes('aria-valuemax')).toBe('3')
        expect(el.attributes('aria-valuenow')).toBe('1')
        expect(el.attributes('aria-valuetext')).toBe('Mix 1')
    })

    it('steps with the arrow keys and tunes each station in', async () => {
        homeMock.homepageItems = [mixRow(['mix1', 'mix2', 'mix3'])]
        const w = mount(RadioDial)

        await dial(w).trigger('keydown', { key: 'ArrowRight' })

        expect(tuneStation).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'mix2' }))
        expect(dial(w).attributes('aria-valuetext')).toBe('Mix 2')
        expect(dial(w).attributes('aria-valuenow')).toBe('2')

        await dial(w).trigger('keydown', { key: 'ArrowLeft' })
        expect(tuneStation).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'mix1' }))
    })

    it('jumps to the ends with Home and End, and stops at them', async () => {
        homeMock.homepageItems = [mixRow(['mix1', 'mix2', 'mix3'])]
        const w = mount(RadioDial)

        await dial(w).trigger('keydown', { key: 'End' })
        expect(dial(w).attributes('aria-valuetext')).toBe('Mix 3')

        await dial(w).trigger('keydown', { key: 'ArrowRight' })
        expect(dial(w).attributes('aria-valuetext')).toBe('Mix 3')

        await dial(w).trigger('keydown', { key: 'Home' })
        expect(tuneStation).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'mix1' }))
    })

    it('a key that lands on the station already playing resumes the music instead', async () => {
        homeMock.homepageItems = [mixRow(['mix1', 'mix2'])]
        const w = mount(RadioDial)

        await dial(w).trigger('keydown', { key: 'ArrowRight' })
        tuneStation.mockClear()
        await dial(w).trigger('keydown', { key: 'ArrowRight' })

        expect(tuneStation).not.toHaveBeenCalled()
        expect(resumeMusic).toHaveBeenCalledTimes(1)
    })

    it('the wheel steps one station per notch once the dial is focused', async () => {
        homeMock.homepageItems = [mixRow(['mix1', 'mix2', 'mix3'])]
        const w = mount(RadioDial, { attachTo: document.body })
        ;(dial(w).element as HTMLElement).focus()

        // 50 px is one notch (WHEEL_PX_PER_STATION); 120 px would be two stations.
        await dial(w).trigger('wheel', { deltaY: 50 })

        expect(dial(w).attributes('aria-valuetext')).toBe('Mix 2')
        expect(tuneStation).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'mix2' }))
        w.unmount()
    })

    it('a wheel passing over an unfocused dial scrolls the page instead', async () => {
        homeMock.homepageItems = [mixRow(['mix1', 'mix2', 'mix3'])]
        const w = mount(RadioDial, { attachTo: document.body })

        const event = new WheelEvent('wheel', { deltaY: 50, cancelable: true, bubbles: true })
        dial(w).element.dispatchEvent(event)
        await w.vm.$nextTick()

        expect(event.defaultPrevented).toBe(false)
        expect(dial(w).attributes('aria-valuetext')).toBe('Mix 1')
        expect(tuneStation).not.toHaveBeenCalled()
        w.unmount()
    })

    it('under reduced motion the needle does not animate', async () => {
        vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query }))
        homeMock.homepageItems = [mixRow(['mix1', 'mix2'])]
        const w = mount(RadioDial)
        await w.vm.$nextTick()

        expect(dial(w).classes()).toContain('is-still')
    })

    it('without the preference the needle keeps its movement', async () => {
        vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query }))
        homeMock.homepageItems = [mixRow(['mix1', 'mix2'])]
        const w = mount(RadioDial)
        await w.vm.$nextTick()

        expect(dial(w).classes()).not.toContain('is-still')
    })
})
