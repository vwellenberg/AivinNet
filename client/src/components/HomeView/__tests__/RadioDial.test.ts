import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { favType } from '@/enums'
import { ref, type Ref } from 'vue'

// The station list is Home's store (#776): it comes with the rows, and the dial
// follows the store's list.
const { homeMock, settingsMock, queueMock, tracklistMock, tuneStation, resumeMusic, muteForTuning, crackle, favoriteHandler, favoritesMock } = await vi.hoisted(async () => {
  const { reactive } = await import('vue')
  return {
    homeMock: reactive({ homepageItems: [] as any[], stations: [] as any[] }),
    // The per-device flag: folded (false) by default. The setter writes it, as the store does.
    settingsMock: reactive({
      radio_open: false,
      setRadioOpen(value: boolean) {
        this.radio_open = value
      },
    }),
    // The queue's `playing` flag decides ON AIR (the player is playing).
    // The queue's clock (seconds) is what the progress row reads; `playNext` is the
    // queue's next action, which the ⏭ button calls.
    queueMock: reactive({
      playing: false,
      currentindex: 0,
      duration: { current: 0, full: 0 },
      playNext: vi.fn(),
    }),
    // The favourite toggle the player bar uses, and the registry's answer for a hash.
    favoriteHandler: vi.fn(async () => {}),
    favoritesMock: { flag: vi.fn((): boolean | undefined => undefined) },
    // Where the queue came from: ON AIR also needs it to be the tuned station.
    // `tracklist` is the queue's list: the now-playing column reads its current track.
    tracklistMock: reactive({ from: {} as { type?: string; id?: unknown }, tracklist: [] as any[] }),
    tuneStation: vi.fn(async () => {}),
    resumeMusic: vi.fn(),
    muteForTuning: vi.fn(),
    crackle: vi.fn(),
  }
})

vi.mock('@/stores/home', () => ({ default: () => homeMock }))
vi.mock('@/stores/settings', () => ({ default: () => settingsMock }))
vi.mock('@/stores/queue', () => ({ default: () => queueMock }))
vi.mock('@/stores/queue/tracklist', () => ({ default: () => tracklistMock }))
vi.mock('@/stores/favorites', () => ({ default: () => favoritesMock }))
vi.mock('@/helpers/favoriteHandler', () => ({ default: favoriteHandler }))
vi.mock('@/helpers/radio', () => ({ tuneStation, resumeMusic, muteForTuning, crackle }))

import RadioDial from '@/components/HomeView/RadioDial.vue'

// The stations the server lists (`GET /nothome/stations`), in its order. They
// are listed as genre stations: a dial of mixes alone stays hidden
// (utils/radioDial.ts::dialIsWorthShowing), and these tests are about the dial.
const dialOf = (ids: string[]) => ids.map((id, i) => ({ id, kind: 'genre', name: `Mix ${i + 1}` }))
const mixes = (ids: string[]) => ids.map((id, i) => ({ id, kind: 'mix', name: `Mix ${i + 1}` }))

// The slider is the knob's grip (the scale is gone since 2026-11-15).
const dial = (w: ReturnType<typeof mount>) => w.get('[role="slider"]')

// Every dial mounted by a test: one still watching the shared home mock would
// read the list again in a later test.
const mounted: ReturnType<typeof mount>[] = []

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

/** Mount the dial with these stations listed, and let the list arrive. Open unless told otherwise. */
async function mountWith(stations: any[], options: Record<string, unknown> = {}, open = true) {
    homeMock.stations = stations
    settingsMock.radio_open = open
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
        queueMock.currentindex = 0
        tracklistMock.from = {}
        tracklistMock.tracklist = []
        settingsMock.radio_open = false
    })

    afterEach(() => {
        for (const w of mounted.splice(0)) w.unmount()
        vi.unstubAllGlobals()
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
        // station under the knob, the first one here is the mix.
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

    it('has no frequency scale: no track, ticks, notches, needle or band labels', async () => {
        const w = await mountWith([
            { id: 'mix1', kind: 'mix', name: 'Mix 1' },
            { id: 'genre1', kind: 'genre', name: 'Jazz' },
            { id: 'decade1', kind: 'decade', name: '1990s' },
        ])

        for (const selector of ['.radio-scale', '.radio-track', '.radio-line', '.radio-minor', '.radio-label', '.radio-notch', '.radio-needle']) {
            expect(w.find(selector).exists(), selector).toBe(false)
        }
        // The dial still reads out the station, and the knob is the one control.
        expect(w.find('.radio-display-name').text()).toBe('Mix 1')
        expect(w.findAll('[role="slider"]')).toHaveLength(1)
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

    it('the display follows a drag of the knob over the station under it, before the tune-in', async () => {
        const w = await mountWith(dialOf(['mix1', 'mix2', 'mix3']))

        pointer(w, 'pointerdown', { pointerId: 1, clientX: 0, clientY: 0 })
        // 26 px up is one station (KNOB_PX_PER_STATION): the second.
        pointer(w, 'pointermove', { pointerId: 1, clientX: 0, clientY: -26 })
        await w.vm.$nextTick()

        expect(w.find('.radio-display-name').text()).toBe('Mix 2')
        expect(w.find('.radio-kind').text()).toBe('GENRE')
        expect(w.find('.radio-freq').text()).toBe('97.8MHz')
        expect(tuneStation).not.toHaveBeenCalled()

        pointer(w, 'pointerup', { pointerId: 1, clientX: 0, clientY: -26 })
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

    it('under reduced motion the knob does not swing', async () => {
        vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query }))
        const w = await mountWith(dialOf(['mix1', 'mix2']))
        await w.vm.$nextTick()

        expect(w.get('.radio-knob').classes()).toContain('is-still')
    })

    it('without the preference the knob keeps its swing', async () => {
        vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query }))
        const w = await mountWith(dialOf(['mix1', 'mix2']))
        await w.vm.$nextTick()

        expect(w.get('.radio-knob').classes()).not.toContain('is-still')
    })

    it('the knob is the slider: focusable, named, carrying its values, and visible to assistive tech', async () => {
        const w = await mountWith(dialOf(['mix1', 'mix2', 'mix3']))
        const grip = w.get('.radio-grip')

        expect(w.find('.radio-knob').attributes('aria-hidden')).toBeUndefined()
        expect(grip.element).toBe(dial(w).element)
        expect(grip.attributes('role')).toBe('slider')
        expect(grip.attributes('tabindex')).toBe('0')
        expect(grip.attributes('aria-label')).toBe('AivinNet FM')
        expect(grip.attributes('aria-valuemin')).toBe('1')
        expect(grip.attributes('aria-valuemax')).toBe('3')
        expect(grip.attributes('aria-valuenow')).toBe('1')
        expect(grip.attributes('aria-valuetext')).toBe('Mix 1, 87.5 FM')
        expect(w.findAll('[role="slider"]')).toHaveLength(1)
    })

    it('knob drag turns the knob: up and right move on, and tunes the station on release', async () => {
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

    it('has no neighbours row: nothing says what comes next', async () => {
        const w = await mountWith(dialOf(['mix1', 'mix2', 'mix3']))
        await dial(w).trigger('keydown', { key: 'ArrowRight' })

        expect(w.find('.radio-nbr').exists()).toBe(false)
        expect(w.text()).not.toContain('▸')
        expect(w.text()).not.toContain('◂')
    })

    it('keeps the level meter: the now-playing column sits beside the readout, not in place of it', async () => {
        const w = await mountWith(dialOf(['mix1', 'mix2']))

        expect(w.find('.radio-level').exists()).toBe(true)
        expect(w.find('.radio-display .radio-readout .radio-level').exists()).toBe(true)
        expect(w.find('.radio-display > .radio-now').exists()).toBe(true)
    })

    it('while ON AIR the now-playing column names the track and its artists, from the queue', async () => {
        const w = await mountWith(dialOf(['mix1', 'mix2']))
        tracklistMock.tracklist = [
            {
                id: 't1',
                title: 'Blue in Green',
                image: 'a1b2c3d4e5f6.webp?pathhash=9f8e7d6c',
                artists: [{ name: 'Miles Davis' }, { name: 'Bill Evans' }],
            },
        ]
        queueMock.playing = true
        tracklistMock.from = { type: 'playlist', id: 'mix1' }
        await dial(w).trigger('keydown', { key: 'ArrowRight' })
        tracklistMock.from = { type: 'playlist', id: 'mix2' }
        await w.vm.$nextTick()

        expect(w.get('.radio-now-label').text()).toBe('NOW PLAYING')
        expect(w.get('.radio-now-title').text()).toBe('Blue in Green')
        expect(w.get('.radio-now-artist').text()).toBe('Miles Davis, Bill Evans')
        expect(w.get('.radio-now-cover').attributes('src')).toContain('a1b2c3d4e5f6.webp?pathhash=9f8e7d6c')
        expect(w.find('.radio-now-idle').exists()).toBe(false)
    })

    it('shows no "next" line in the now-playing column', async () => {
        queueMock.playing = true
        tracklistMock.from = { type: 'playlist', id: 'mix1' }
        tracklistMock.tracklist = [
            { id: 't1', title: 'Blue in Green', image: 'None', artists: [{ name: 'Miles Davis' }] },
            { id: 't2', title: 'So What', image: 'None', artists: [{ name: 'Miles Davis' }] },
        ]
        const w = await mountWith(dialOf(['mix1', 'mix2']))

        expect(w.get('.radio-now').text()).not.toMatch(/next/i)
        // Whatever the wording: the following track is nowhere on the radio.
        expect(w.text()).not.toContain('So What')
    })

    it('otherwise the now-playing column asks the listener to turn the knob', async () => {
        tracklistMock.tracklist = [{ id: 't1', title: 'Blue in Green', image: 'None', artists: [{ name: 'Miles Davis' }] }]
        queueMock.playing = true
        const w = await mountWith(dialOf(['mix1', 'mix2']))

        expect(w.get('.radio-now-idle').text()).toBe('Turn the knob')
        expect(w.find('.radio-now-title').exists()).toBe(false)
        expect(w.text()).not.toContain('Blue in Green')
    })

    it('the air state reads STANDBY, then ON AIR once music plays from the tuned station, then TUNING while dragged', async () => {
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
        const w = await mountWith(dialOf(['mix1', 'mix2']))
        await dial(w).trigger('keydown', { key: 'ArrowRight' })

        queueMock.playing = true
        tracklistMock.from = { type: 'album', id: 'a1b2c3d4' }
        await w.vm.$nextTick()
        expect(w.find('.radio-air').text()).toBe('STANDBY')
        // No signal beside STANDBY.
        expect(w.findAll('.radio-signal i.on')).toHaveLength(0)
    })
    it('is folded by default: no slider in the tab order, the toggle says so', async () => {
        const w = await mountWith(dialOf(['mix1', 'mix2']), {}, false)

        expect(w.find('[role="slider"]').exists()).toBe(false)
        const toggle = w.get('.radio-toggle')
        expect(toggle.attributes('type')).toBe('button')
        expect(toggle.attributes('aria-expanded')).toBe('false')
        // Folded, the body is not in the DOM: no reference to a missing id.
        expect(toggle.attributes('aria-controls')).toBeUndefined()
        expect(toggle.attributes('aria-label')).toBe('Open radio')
    })

    it('the toggle opens the radio and writes the setting, and closes it again', async () => {
        const w = await mountWith(dialOf(['mix1', 'mix2']), {}, false)

        await w.get('.radio-toggle').trigger('click')
        await flushPromises()
        expect(settingsMock.radio_open).toBe(true)
        expect(w.find('[role="slider"]').exists()).toBe(true)
        expect(w.get('.radio-toggle').attributes('aria-expanded')).toBe('true')
        expect(w.get('.radio-toggle').attributes('aria-label')).toBe('Close radio')
        expect(w.get('.radio-toggle').attributes('aria-controls')).toBe('radio-body')
        expect(w.find('#radio-body').exists()).toBe(true)

        await w.get('.radio-toggle').trigger('click')
        await flushPromises()
        expect(settingsMock.radio_open).toBe(false)
        expect(w.find('[role="slider"]').exists()).toBe(false)
    })

    it('a setting of true mounts the radio open', async () => {
        const w = await mountWith(dialOf(['mix1', 'mix2']), {}, true)

        expect(w.find('[role="slider"]').exists()).toBe(true)
        expect(w.get('.radio-toggle').attributes('aria-expanded')).toBe('true')
    })

    it('the folded strip names the station on air, and shows nothing of it otherwise', async () => {
        const w = await mountWith(dialOf(['mix1', 'mix2']))
        await dial(w).trigger('keydown', { key: 'ArrowRight' })
        await w.get('.radio-toggle').trigger('click')
        await flushPromises()
        expect(w.find('.radio-onair').exists()).toBe(false)

        // Still folded: the music starts from the tuned station.
        queueMock.playing = true
        tracklistMock.from = { type: 'playlist', id: 'mix2' }
        await w.vm.$nextTick()
        expect(w.find('[role="slider"]').exists()).toBe(false)
        expect(w.find('.radio-onair').text()).toBe('ON AIR · Mix 2')
    })

    it('a station tuned in but not playing leaves the folded strip without a chip', async () => {
        const w = await mountWith(dialOf(['mix1', 'mix2']))
        await dial(w).trigger('keydown', { key: 'ArrowRight' })
        await w.get('.radio-toggle').trigger('click')
        await flushPromises()

        expect(w.find('.radio-onair').exists()).toBe(false)
        expect(w.text()).not.toContain('ON AIR')
    })

    it('the live status stays rendered while folded and still names the station tuned in', async () => {
        const w = await mountWith(dialOf(['mix1', 'mix2']))
        await dial(w).trigger('keydown', { key: 'ArrowRight' })
        await w.get('.radio-toggle').trigger('click')
        await flushPromises()

        expect(w.find('[role="slider"]').exists()).toBe(false)
        expect(w.get('.radio-status').attributes('aria-live')).toBe('polite')
        expect(w.get('.radio-status').text()).toBe('Tuned in: Mix 2, 108.0 FM')
    })

    it('folding in the middle of a drag ends it and brings the music back', async () => {
        const w = await mountWith(dialOf(['mix1', 'mix2', 'mix3']))
        pointer(w, 'pointerdown', { pointerId: 7, clientX: 0, clientY: 0 })
        pointer(w, 'pointermove', { pointerId: 7, clientX: 0, clientY: -26 })
        await w.vm.$nextTick()
        expect(muteForTuning).toHaveBeenCalled()

        await w.get('.radio-toggle').trigger('click')
        await flushPromises()
        expect(resumeMusic).toHaveBeenCalled()
        expect(tuneStation).not.toHaveBeenCalled()
        expect(w.find('.radio-air').exists()).toBe(false)
    })

    it('back on Home while a station plays, the folded strip still says ON AIR', async () => {
        // A fresh mount (another page, a reload): only the queue remembers.
        queueMock.playing = true
        tracklistMock.from = { type: 'playlist', id: 'mix2' }
        const w = await mountWith(dialOf(['mix1', 'mix2']), {}, false)

        expect(w.get('.radio-onair').text()).toContain('ON AIR')
        expect(w.get('.radio-onair').text()).toContain('Mix 2')
    })

    it('a click on the housing opens and closes it; a click inside the instrument does not', async () => {
        const w = await mountWith(dialOf(['mix1', 'mix2']), {}, false)

        await w.get('.radio-head').trigger('click')
        await flushPromises()
        expect(settingsMock.radio_open).toBe(true)

        // Tuning and reading stay put.
        await w.get('.radio-display').trigger('click')
        await dial(w).trigger('click')
        await flushPromises()
        expect(settingsMock.radio_open).toBe(true)

        await w.get('.radio-case').trigger('click')
        await flushPromises()
        expect(settingsMock.radio_open).toBe(false)
    })

    it('the toggle button flips once, not twice through the housing', async () => {
        const w = await mountWith(dialOf(['mix1', 'mix2']), {}, false)
        await w.get('.radio-toggle').trigger('click')
        await flushPromises()
        expect(settingsMock.radio_open).toBe(true)
    })

    it('a click on the knob without turning it only takes the focus: no tuning', async () => {
        // Attached: focus needs a document.
        const w = await mountWith(dialOf(['mix1', 'mix2']), { attachTo: document.body })
        const grip = w.get('.radio-grip').element

        pointer(w, 'pointerdown', { pointerId: 9, clientX: 10, clientY: 10 }, grip)
        pointer(w, 'pointerup', { pointerId: 9, clientX: 11, clientY: 10 }, grip)
        await flushPromises()

        expect(tuneStation).not.toHaveBeenCalled()
        expect(resumeMusic).toHaveBeenCalled()
        expect(document.activeElement).toBe(grip)
    })

    it('ON AIR before the track is in the list: the column stays empty, it does not say "Turn the knob"', async () => {
        queueMock.playing = true
        tracklistMock.from = { type: 'playlist', id: 'mix1' }
        tracklistMock.tracklist = []
        const w = await mountWith(dialOf(['mix1', 'mix2']))

        expect(w.get('.radio-air').text()).toBe('ON AIR')
        expect(w.find('.radio-now-idle').exists()).toBe(false)
    })
})

describe('RadioDial now-playing zone (wide display)', () => {
    // A realistic Track: the image carries the `?pathhash=` suffix, `date` is the
    // backend's unix timestamp (1990-01-01 UTC), artists come as objects.
    const track = {
        title: 'Paradise Lost',
        trackhash: 'th-paradise',
        album: 'Icon',
        date: 631152000,
        image: 'icon-cover.webp?pathhash=cover123',
        artists: [{ name: 'Sleeping Giant' }],
        is_favorite: false,
    }

    beforeEach(() => {
        homeMock.stations = []
        settingsMock.radio_open = true
        queueMock.playing = true
        queueMock.currentindex = 0
        queueMock.duration = { current: 131, full: 240 }
        queueMock.playNext.mockClear()
        favoriteHandler.mockClear()
        favoritesMock.flag.mockReturnValue(undefined)
        tracklistMock.from = { type: 'playlist', id: 'mix1' }
        tracklistMock.tracklist = [track]
    })

    afterEach(() => {
        for (const w of mounted.splice(0)) w.unmount()
        queueMock.playing = false
        queueMock.duration = { current: 0, full: 0 }
        tracklistMock.tracklist = []
    })

    it('ON AIR shows the title, the artists, album and year, the progress and both buttons', async () => {
        const w = await mountWith(dialOf(['mix1', 'mix2']), {}, true)

        expect(w.get('.radio-now-title').text()).toBe('Paradise Lost')
        expect(w.get('.radio-now-artist').text()).toBe('Sleeping Giant')
        expect(w.get('.radio-now-album').text()).toBe('Icon · 1990')
        expect(w.get('.radio-now-cover').attributes('src')).toContain('icon-cover.webp?pathhash=cover123')
        expect(w.get('.radio-now-prog').text()).toContain('02:11')
        expect(w.get('.radio-now-prog').text()).toContain('-01:49')
        expect(w.find('button[aria-label="Favorite"]').exists()).toBe(true)
        expect(w.find('button[aria-label="Next song"]').exists()).toBe(true)
    })

    it('leaves the year out of the album line when the track has no date', async () => {
        tracklistMock.tracklist = [{ ...track, date: 0 }]
        const w = await mountWith(dialOf(['mix1', 'mix2']), {}, true)

        expect(w.get('.radio-now-album').text()).toBe('Icon')
    })

    it("⏭ calls the queue's next action", async () => {
        const w = await mountWith(dialOf(['mix1', 'mix2']), {}, true)

        await w.get('button[aria-label="Next song"]').trigger('click')

        expect(queueMock.playNext).toHaveBeenCalledTimes(1)
    })

    it('♥ calls the favourite toggle with the current track and the flag it shows', async () => {
        const w = await mountWith(dialOf(['mix1', 'mix2']), {}, true)

        await w.get('button[aria-label="Favorite"]').trigger('click')

        expect(favoriteHandler).toHaveBeenCalledWith(false, favType.track, 'th-paradise', expect.any(Function), expect.any(Function))
    })

    it('♥ reads the registry before the copy: a flip recorded elsewhere shows as favourite', async () => {
        favoritesMock.flag.mockReturnValue(true)
        const w = await mountWith(dialOf(['mix1', 'mix2']), {}, true)

        expect(w.get('button[aria-label="Favorite"]').attributes('aria-pressed')).toBe('true')
        await w.get('button[aria-label="Favorite"]').trigger('click')
        expect(favoriteHandler).toHaveBeenCalledWith(true, favType.track, 'th-paradise', expect.any(Function), expect.any(Function))
    })

    it('not on air: no buttons, no progress, only the dim "Turn the knob" line', async () => {
        queueMock.playing = false
        const w = await mountWith(dialOf(['mix1', 'mix2']), {}, true)

        expect(w.get('.radio-now-idle').text()).toBe('Turn the knob')
        expect(w.find('.radio-now-title').exists()).toBe(false)
        expect(w.find('button[aria-label="Favorite"]').exists()).toBe(false)
        expect(w.find('button[aria-label="Next song"]').exists()).toBe(false)
        expect(w.find('.radio-now-prog').exists()).toBe(false)
    })

    it('the spectrum is decoration: aria-hidden, 40 bars, running only ON AIR', async () => {
        const w = await mountWith(dialOf(['mix1', 'mix2']), {}, true)
        const spectrum = w.get('.radio-spectrum')
        expect(spectrum.attributes('aria-hidden')).toBe('true')
        expect(spectrum.findAll('i')).toHaveLength(40)
        expect(spectrum.classes()).toContain('is-live')

        queueMock.playing = false
        await flushPromises()
        expect(w.get('.radio-spectrum').classes()).not.toContain('is-live')
        expect(w.get('.radio-spectrum').attributes('aria-hidden')).toBe('true')
    })

    it('clicks on ♥ and ⏭ do not fold the radio', async () => {
        const w = await mountWith(dialOf(['mix1', 'mix2']), {}, true)

        await w.get('button[aria-label="Favorite"]').trigger('click')
        await w.get('button[aria-label="Next song"]').trigger('click')
        await flushPromises()

        expect(settingsMock.radio_open).toBe(true)
    })
})

