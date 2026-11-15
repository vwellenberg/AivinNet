import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, type Ref } from 'vue'

// The station list is Home's store (#776): it comes with the rows, and the dial
// follows the store's list.
const { homeMock, queueMock, tracklistMock, tuneStation, resumeMusic, muteForTuning, crackle } = await vi.hoisted(async () => {
  const { reactive } = await import('vue')
  return {
    homeMock: reactive({ homepageItems: [] as any[], stations: [] as any[] }),
    // The queue's `playing` flag decides ON AIR (the player is playing).
    queueMock: reactive({ playing: false }),
    // Where the queue came from: ON AIR also needs it to be the tuned station.
    tracklistMock: reactive({ from: {} as { type?: string; id?: unknown } }),
    tuneStation: vi.fn(async () => {}),
    resumeMusic: vi.fn(),
    muteForTuning: vi.fn(),
    crackle: vi.fn(),
  }
})

vi.mock('@/stores/home', () => ({ default: () => homeMock }))
vi.mock('@/stores/queue', () => ({ default: () => queueMock }))
vi.mock('@/stores/queue/tracklist', () => ({ default: () => tracklistMock }))
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

// The dial's pointer maths reads the scale's clientWidth (jsdom: 0).
function dialWidth(px: number) {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => px })
}

// VTU cannot set `button` or `pointerId` on jsdom's MouseEvent (read-only), so
// the pointer events are dispatched by hand.
function pointer(
    w: ReturnType<typeof mount>,
    type: string,
    init: { pointerId: number; clientX: number; clientY?: number },
    target: Element = dial(w).element
) {
    const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: init.clientX,
        clientY: init.clientY ?? 0,
    })
    Object.defineProperty(event, 'pointerId', { value: init.pointerId })
    target.dispatchEvent(event)
}

/** Mount the dial with these stations listed, and let the list arrive. */
async function mountWith(stations: any[], options: Record<string, unknown> = {}) {
    homeMock.stations = stations
    const w = mount(RadioDial, options)
    mounted.push(w)
    await flushPromises()
    return w
}

describe('RadioDial', () => {
    beforeEach(() => {
        homeMock.homepageItems = []
        homeMock.stations = []
        tuneStation.mockClear()
        resumeMusic.mockClear()
        muteForTuning.mockClear()
        crackle.mockClear()
        queueMock.playing = false
        tracklistMock.from = {}
    })

    afterEach(() => {
        for (const w of mounted.splice(0)) w.unmount()
        vi.unstubAllGlobals()
        delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth
        queueMock.playing = false
    })

    it('shows nothing without stations', async () => {
        const w = await mountWith([])

        expect(w.find('.radio-card').exists()).toBe(false)
    })

    it('shows nothing with mixes alone: the "Your mixes" row below already has them', async () => {
        const w = await mountWith(mixes(['mix1', 'mix2']))

        expect(w.find('.radio-card').exists()).toBe(false)
    })


    it('is a slider over the stations, naming the station in aria-valuetext', async () => {
        const w = await mountWith(dialOf(['mix1', 'mix2', 'mix3']))

        const el = dial(w)
        expect(el.attributes('role')).toBe('slider')
        expect(el.attributes('aria-valuemin')).toBe('1')
        expect(el.attributes('aria-valuemax')).toBe('3')
        expect(el.attributes('aria-valuenow')).toBe('1')
        expect(el.attributes('aria-valuetext')).toBe('Mix 1, 87.5 FM')
    })

    it('puts the genre and the decade stations on the dial after the mixes', async () => {
        const w = await mountWith([
            { id: 'decade1', kind: 'decade', name: '1990s' },
            { id: 'genre2', kind: 'genre', name: 'jazz' },
            { id: 'mix1', kind: 'mix', name: 'Mix 1' },
            { id: 'genre1', kind: 'genre', name: 'rock' },
        ])

        expect(dial(w).attributes('aria-valuemax')).toBe('4')
        expect(dial(w).attributes('aria-valuetext')).toBe('Mix 1, 87.5 FM')
        // Each kind keeps the order the server listed it in: the display reads the
        // station under the needle, the first one here is the mix.
        expect(w.find('.radio-display-name').text()).toBe('Mix 1')
    })

    it('steps with the arrow keys and tunes each station in', async () => {
        const w = await mountWith(dialOf(['mix1', 'mix2', 'mix3']))

        await dial(w).trigger('keydown', { key: 'ArrowRight' })

        expect(tuneStation).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'mix2' }))
        expect(dial(w).attributes('aria-valuetext')).toBe('Mix 2, 97.8 FM')
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
        expect(dial(w).attributes('aria-valuetext')).toBe('rock, 108.0 FM')
    })

    it('jumps to the ends with Home and End, and stops at them', async () => {
        const w = await mountWith(dialOf(['mix1', 'mix2', 'mix3']))

        await dial(w).trigger('keydown', { key: 'End' })
        expect(dial(w).attributes('aria-valuetext')).toBe('Mix 3, 108.0 FM')

        await dial(w).trigger('keydown', { key: 'ArrowRight' })
        expect(dial(w).attributes('aria-valuetext')).toBe('Mix 3, 108.0 FM')

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

        expect(dial(w).attributes('aria-valuetext')).toBe('Mix 2, 97.8 FM')
        expect(tuneStation).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'mix2' }))
        w.unmount()
    })

    it('a wheel passing over an unfocused dial scrolls the page instead', async () => {
        const w = await mountWith(dialOf(['mix1', 'mix2', 'mix3']), { attachTo: document.body })

        const event = new WheelEvent('wheel', { deltaY: 50, cancelable: true, bubbles: true })
        dial(w).element.dispatchEvent(event)
        await w.vm.$nextTick()

        expect(event.defaultPrevented).toBe(false)
        expect(dial(w).attributes('aria-valuetext')).toBe('Mix 1, 87.5 FM')
        expect(tuneStation).not.toHaveBeenCalled()
        w.unmount()
    })

    it('is AivinNet FM in its title and its aria-label', async () => {
        const w = await mountWith(dialOf(['mix1', 'genre1']))

        expect(w.find('.radio-title').text()).toBe('AivinNet FM')
        expect(dial(w).attributes('aria-label')).toBe('AivinNet FM')
        expect(w.text()).not.toContain('Subspace')
    })

    it('puts the fixed band labels on the scale, never the station names', async () => {
        const w = await mountWith([
            { id: 'mix1', kind: 'mix', name: 'Mix 1' },
            { id: 'genre1', kind: 'genre', name: 'Jazz' },
            { id: 'genre2', kind: 'genre', name: 'rock' },
            { id: 'decade1', kind: 'decade', name: '1990s' },
        ])

        expect(w.findAll('.radio-label').map(label => label.text())).toEqual(['88', '92', '96', '100', '104', '108'])
        expect(w.find('.radio-scale').text()).not.toMatch(/Mix|Jazz|rock|1990s/)
    })

    it('the display shows the station tuned in: its name, its kind and its frequency', async () => {
        const w = await mountWith([
            { id: 'mix1', kind: 'mix', name: 'Mix 1' },
            { id: 'genre1', kind: 'genre', name: 'Jazz' },
            { id: 'decade1', kind: 'decade', name: '1990s' },
        ])

        expect(w.find('.radio-display-name').text()).toBe('Mix 1')
        expect(w.find('.radio-kind').text()).toBe('MIX')
        expect(w.find('.radio-freq').text()).toBe('87.5MHz')

        await dial(w).trigger('keydown', { key: 'End' })

        expect(w.find('.radio-display-name').text()).toBe('1990s')
        expect(w.find('.radio-kind').text()).toBe('DECADE')
        expect(w.find('.radio-freq').text()).toBe('108.0MHz')
    })

    it('the display follows a drag over the station under the needle, before the tune-in', async () => {
        dialWidth(300)
        const w = await mountWith(dialOf(['mix1', 'mix2', 'mix3']))

        pointer(w, 'pointerdown', { pointerId: 1, clientX: 0 })
        // 150 px of a 300 px dial over 3 stations is one station: the second.
        pointer(w, 'pointermove', { pointerId: 1, clientX: 150 })
        await w.vm.$nextTick()

        expect(w.find('.radio-display-name').text()).toBe('Mix 2')
        expect(w.find('.radio-kind').text()).toBe('GENRE')
        expect(w.find('.radio-freq').text()).toBe('97.8MHz')
        expect(tuneStation).not.toHaveBeenCalled()

        pointer(w, 'pointerup', { pointerId: 1, clientX: 150 })
        await flushPromises()

        expect(tuneStation).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'mix2' }))
        expect(dial(w).attributes('aria-valuetext')).toBe('Mix 2, 97.8 FM')
    })

    it('the status line names the station and its frequency once tuned in', async () => {
        const w = await mountWith(dialOf(['mix1', 'mix2']))
        expect(w.find('.radio-status').text()).toBe('Turn the dial to tune in')

        await dial(w).trigger('keydown', { key: 'ArrowRight' })

        expect(w.find('.radio-status').text()).toBe('Tuned in: Mix 2, 108.0 FM')
    })

    it('follows the list in the store when Home fetches again, with no request of its own', async () => {
        const w = await mountWith(dialOf(['mix1']))
        expect(dial(w).attributes('aria-valuemax')).toBe('1')

        homeMock.stations = dialOf(['mix1', 'mix2'])
        await flushPromises()

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

    it('the knob is decoration: hidden from assistive tech and not in the tab order', async () => {
        const w = await mountWith(dialOf(['mix1', 'mix2']))

        expect(w.find('.radio-knob').attributes('aria-hidden')).toBe('true')
        expect(w.find('.radio-grip').attributes('tabindex')).toBeUndefined()
        expect(w.findAll('[role="slider"]')).toHaveLength(1)
    })

    it('knob drag turns the knob: up and right move on, and tunes the station on release', async () => {
        dialWidth(300)
        const w = await mountWith(dialOf(['mix1', 'mix2', 'mix3']))
        const grip = w.find('.radio-grip').element

        pointer(w, 'pointerdown', { pointerId: 2, clientX: 0, clientY: 0 }, grip)
        // 52 px up over 26 px per station: two stations on.
        pointer(w, 'pointermove', { pointerId: 2, clientX: 0, clientY: -52 }, grip)
        await w.vm.$nextTick()

        expect(w.find('.radio-display-name').text()).toBe('Mix 3')
        expect(tuneStation).not.toHaveBeenCalled()

        pointer(w, 'pointerup', { pointerId: 2, clientX: 0, clientY: -52 }, grip)
        await flushPromises()

        expect(tuneStation).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'mix3' }))
        expect(dial(w).attributes('aria-valuetext')).toBe('Mix 3, 108.0 FM')
    })

    it('the legend lists only the kinds on the dial, in dial order', async () => {
        const w = await mountWith([
            { id: 'decade1', kind: 'decade', name: '1990s' },
            { id: 'genre1', kind: 'genre', name: 'Jazz' },
            { id: 'mix1', kind: 'mix', name: 'Mix 1' },
        ])

        expect(w.find('.radio-legend').text()).toContain('MIX')
        expect(w.find('.radio-legend').text()).toContain('GENRE')
        expect(w.find('.radio-legend').text()).toContain('DECADE')
        expect(w.find('.radio-legend').text()).not.toContain('SEASON')
    })

    it('shows the neighbour stations, and nothing past the ends of the dial', async () => {
        const w = await mountWith(dialOf(['mix1', 'mix2', 'mix3']))
        const nbr = () => w.find('.radio-nbr').findAll('span').map(s => s.text())

        expect(nbr()).toEqual(['', 'Mix 2 ▸'])

        await dial(w).trigger('keydown', { key: 'ArrowRight' })
        expect(nbr()).toEqual(['◂ Mix 1', 'Mix 3 ▸'])

        await dial(w).trigger('keydown', { key: 'End' })
        expect(nbr()).toEqual(['◂ Mix 2', ''])
    })

    it('the air state reads STANDBY, then ON AIR once music plays from the tuned station, then TUNING while dragged', async () => {
        dialWidth(300)
        const w = await mountWith(dialOf(['mix1', 'mix2']))
        expect(w.find('.radio-air').text()).toBe('STANDBY')

        await dial(w).trigger('keydown', { key: 'ArrowRight' })
        expect(w.find('.radio-air').text()).toBe('STANDBY')

        queueMock.playing = true
        tracklistMock.from = { type: 'playlist', id: 'mix2' }
        await w.vm.$nextTick()
        expect(w.find('.radio-air').text()).toBe('ON AIR')

        pointer(w, 'pointerdown', { pointerId: 3, clientX: 0 })
        await w.vm.$nextTick()
        expect(w.find('.radio-air').text()).toBe('TUNING')

        pointer(w, 'pointerup', { pointerId: 3, clientX: 0 })
        await flushPromises()
    })

    it('is not ON AIR when something else plays after tuning in (an album from its page)', async () => {
        dialWidth(300)
        const w = await mountWith(dialOf(['mix1', 'mix2']))
        await dial(w).trigger('keydown', { key: 'ArrowRight' })

        queueMock.playing = true
        tracklistMock.from = { type: 'album', id: 'a1b2c3d4' }
        await w.vm.$nextTick()
        expect(w.find('.radio-air').text()).toBe('STANDBY')
        // No signal beside STANDBY.
        expect(w.findAll('.radio-signal i.on')).toHaveLength(0)
    })
})
