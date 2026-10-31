import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Reactive: the dial re-reads the list when Home's rows change.
const { homeMock, stationsMock, getStations, tuneStation, resumeMusic, muteForTuning, crackle } = await vi.hoisted(
  async () => {
    const { reactive } = await import('vue')
    return {
      homeMock: reactive({ homepageItems: [] as any[] }),
      stationsMock: { list: [] as any[], fail: false },
      getStations: vi.fn(),
      tuneStation: vi.fn(async () => {}),
      resumeMusic: vi.fn(),
      muteForTuning: vi.fn(),
      crackle: vi.fn(),
    }
  }
)

vi.mock('@/stores/home', () => ({ default: () => homeMock }))
vi.mock('@/requests/home', () => ({ getStations }))
vi.mock('@/helpers/radio', () => ({ tuneStation, resumeMusic, muteForTuning, crackle }))

import RadioDial from '@/components/HomeView/RadioDial.vue'

// The stations the server lists (`GET /nothome/stations`), in its order. They
// are listed as genre stations: a dial of mixes alone stays hidden
// (utils/radioDial.ts::dialIsWorthShowing), and these tests are about the dial.
const dialOf = (ids: string[]) => ids.map((id, i) => ({ id, kind: 'genre', name: `Mix ${i + 1}` }))
const mixes = (ids: string[]) => ids.map((id, i) => ({ id, kind: 'mix', name: `Mix ${i + 1}` }))

const dial = (w: ReturnType<typeof mount>) => w.get('[role="slider"]')

// Every dial mounted by a test: one still watching the shared home mock would
// read the list again in a later test.
const mounted: ReturnType<typeof mount>[] = []

/** Mount the dial with these stations listed, and let the list arrive. */
async function mountWith(stations: any[], options: Record<string, unknown> = {}) {
    stationsMock.list = stations
    const w = mount(RadioDial, options)
    mounted.push(w)
    await flushPromises()
    return w
}

describe('RadioDial', () => {
    beforeEach(() => {
        homeMock.homepageItems = []
        stationsMock.list = []
        stationsMock.fail = false
        getStations.mockReset()
        getStations.mockImplementation(async () => {
            if (stationsMock.fail) throw new Error('offline')
            return stationsMock.list
        })
        tuneStation.mockClear()
        resumeMusic.mockClear()
        muteForTuning.mockClear()
        crackle.mockClear()
    })

    afterEach(() => {
        for (const w of mounted.splice(0)) w.unmount()
        vi.unstubAllGlobals()
    })

    it('shows nothing without stations', async () => {
        const w = await mountWith([])

        expect(w.find('.radio-card').exists()).toBe(false)
    })

    it('shows nothing with mixes alone: the "Your mixes" row below already has them', async () => {
        const w = await mountWith(mixes(['mix1', 'mix2']))

        expect(w.find('.radio-card').exists()).toBe(false)
    })

    it('shows nothing when the station list cannot be had', async () => {
        stationsMock.fail = true
        const w = await mountWith(dialOf(['mix1']))

        expect(w.find('.radio-card').exists()).toBe(false)
    })

    it('is a slider over the stations, naming the station in aria-valuetext', async () => {
        const w = await mountWith(dialOf(['mix1', 'mix2', 'mix3']))

        const el = dial(w)
        expect(el.attributes('role')).toBe('slider')
        expect(el.attributes('aria-valuemin')).toBe('1')
        expect(el.attributes('aria-valuemax')).toBe('3')
        expect(el.attributes('aria-valuenow')).toBe('1')
        expect(el.attributes('aria-valuetext')).toBe('Mix 1')
    })

    it('puts the genre and the decade stations on the dial after the mixes', async () => {
        const w = await mountWith([
            { id: 'decade1', kind: 'decade', name: '1990s' },
            { id: 'genre2', kind: 'genre', name: 'jazz' },
            { id: 'mix1', kind: 'mix', name: 'Mix 1' },
            { id: 'genre1', kind: 'genre', name: 'rock' },
        ])

        expect(dial(w).attributes('aria-valuemax')).toBe('4')
        expect(dial(w).attributes('aria-valuetext')).toBe('Mix 1')
        // Each kind keeps the order the server listed it in.
        const labels = w.findAll('.radio-label').map(label => label.text())
        expect(labels).toEqual(['Mix 1', 'jazz', 'rock', '1990s'])
    })

    it('steps with the arrow keys and tunes each station in', async () => {
        const w = await mountWith(dialOf(['mix1', 'mix2', 'mix3']))

        await dial(w).trigger('keydown', { key: 'ArrowRight' })

        expect(tuneStation).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'mix2' }))
        expect(dial(w).attributes('aria-valuetext')).toBe('Mix 2')
        expect(dial(w).attributes('aria-valuenow')).toBe('2')

        await dial(w).trigger('keydown', { key: 'ArrowLeft' })
        expect(tuneStation).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'mix1' }))
    })

    it('tunes a genre station in as the station it is, with its playlist id', async () => {
        const w = await mountWith([
            { id: 'mix1', kind: 'mix', name: 'Mix 1' },
            { id: 'genre1', kind: 'genre', name: 'rock' },
        ])

        await dial(w).trigger('keydown', { key: 'ArrowRight' })

        expect(tuneStation).toHaveBeenLastCalledWith({ id: 'genre1', name: 'rock', kind: 'genre' })
        expect(dial(w).attributes('aria-valuetext')).toBe('rock')
    })

    it('jumps to the ends with Home and End, and stops at them', async () => {
        const w = await mountWith(dialOf(['mix1', 'mix2', 'mix3']))

        await dial(w).trigger('keydown', { key: 'End' })
        expect(dial(w).attributes('aria-valuetext')).toBe('Mix 3')

        await dial(w).trigger('keydown', { key: 'ArrowRight' })
        expect(dial(w).attributes('aria-valuetext')).toBe('Mix 3')

        await dial(w).trigger('keydown', { key: 'Home' })
        expect(tuneStation).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'mix1' }))
    })

    it('a key that lands on the station already playing resumes the music instead', async () => {
        const w = await mountWith(dialOf(['mix1', 'mix2']))

        await dial(w).trigger('keydown', { key: 'ArrowRight' })
        tuneStation.mockClear()
        await dial(w).trigger('keydown', { key: 'ArrowRight' })

        expect(tuneStation).not.toHaveBeenCalled()
        expect(resumeMusic).toHaveBeenCalledTimes(1)
    })

    it('the wheel steps one station per notch once the dial is focused', async () => {
        const w = await mountWith(dialOf(['mix1', 'mix2', 'mix3']), { attachTo: document.body })
        ;(dial(w).element as HTMLElement).focus()

        // 50 px is one notch (WHEEL_PX_PER_STATION); 120 px would be two stations.
        await dial(w).trigger('wheel', { deltaY: 50 })

        expect(dial(w).attributes('aria-valuetext')).toBe('Mix 2')
        expect(tuneStation).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'mix2' }))
        w.unmount()
    })

    it('a wheel passing over an unfocused dial scrolls the page instead', async () => {
        const w = await mountWith(dialOf(['mix1', 'mix2', 'mix3']), { attachTo: document.body })

        const event = new WheelEvent('wheel', { deltaY: 50, cancelable: true, bubbles: true })
        dial(w).element.dispatchEvent(event)
        await w.vm.$nextTick()

        expect(event.defaultPrevented).toBe(false)
        expect(dial(w).attributes('aria-valuetext')).toBe('Mix 1')
        expect(tuneStation).not.toHaveBeenCalled()
        w.unmount()
    })

    it('reads the list again when Home refreshes its rows', async () => {
        const w = await mountWith(dialOf(['mix1']))
        expect(getStations).toHaveBeenCalledTimes(1)

        stationsMock.list = dialOf(['mix1', 'mix2'])
        homeMock.homepageItems = [{ key: 'your_mixes', items: [] }]
        await flushPromises()

        expect(getStations).toHaveBeenCalledTimes(2)
        expect(dial(w).attributes('aria-valuemax')).toBe('2')
    })

    it('under reduced motion the needle does not animate', async () => {
        vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query }))
        const w = await mountWith(dialOf(['mix1', 'mix2']))
        await w.vm.$nextTick()

        expect(dial(w).classes()).toContain('is-still')
    })

    it('without the preference the needle keeps its movement', async () => {
        vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query }))
        const w = await mountWith(dialOf(['mix1', 'mix2']))
        await w.vm.$nextTick()

        expect(dial(w).classes()).not.toContain('is-still')
    })
})
