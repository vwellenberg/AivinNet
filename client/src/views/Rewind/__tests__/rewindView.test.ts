import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const route = reactive<{ name: string; params: Record<string, string> }>({ name: 'RewindView', params: {} })
const replace = vi.fn()

vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ replace }) }))
vi.mock('@/router', () => ({ Routes: { artist: 'ArtistView', album: 'AlbumView', Rewind: 'RewindView' } }))
vi.mock('@/requests/stats', () => ({ getRewind: vi.fn(), markRewindSeen: vi.fn() }))
vi.mock('@/utils/updatePageTitle', () => ({ default: vi.fn() }))
vi.mock('@/utils/rewindStoryImage', () => ({
    canShareImage: vi.fn(() => false),
    renderStory: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
    saveBlob: vi.fn(),
    shareImage: vi.fn(async () => {}),
}))

import RewindView from '@/views/Rewind/main.vue'
import { getRewind, markRewindSeen } from '@/requests/stats'
import { canShareImage, renderStory, saveBlob, shareImage } from '@/utils/rewindStoryImage'

// As GET /logger/rewind sends it (#527).
const year2026 = {
    year: 2026,
    years: [2025, 2026],
    plays: 4567,
    seconds: 740_700,
    days: 241,
    top_artists: [
        { name: 'Red Hot Chili Peppers', artisthash: 'ar1', image: 'ar1.webp', seconds: 38 * 3600 },
        { name: 'Primus', artisthash: 'ar2', image: 'ar2.webp', seconds: 3600 },
    ],
    top_albums: [
        {
            title: 'Blood Sugar',
            albumhash: 'al1',
            image: 'al1.webp?pathhash=p1',
            albumartists: [{ name: 'Red Hot Chili Peppers', artisthash: 'ar1' }],
            seconds: 7200,
        },
    ],
    top_tracks: [
        {
            title: 'Blue',
            trackhash: 't1',
            artists: [{ name: 'The Artist', artisthash: 'ar3' }],
            seconds: 3 * 3600 + 5 * 60,
            plays: 12,
        },
    ],
    summer_track: { track: { title: 'Summer', trackhash: 't2', artists: [{ name: 'Primus', artisthash: 'ar2' }] }, plays: 9 },
    first_track: null,
    busiest_day: { date: '2026-05-02', seconds: 5 * 3600 },
    new_artists: 7,
    new_artists_top: [{ name: 'Primus', artisthash: 'ar2' }],
    listener: { kind: 'album', share: 0.62 },
    time_of_day: { band: 'evenings', share: 0.5 },
}

const stubs = { RouterLink: { template: '<a><slot /></a>' } }

// Every mounted page, unmounted after its test: the next test's route reset
// would otherwise reach the old page's watcher.
const mounted: ReturnType<typeof mount>[] = []
function page() {
    const w = mount(RewindView, { global: { stubs } })
    mounted.push(w)
    return w
}

function plates(w: ReturnType<typeof mount>) {
    return w.findAll('.rewind-plate .section-title').map(t => t.text())
}

describe('Rewind', () => {
    afterEach(() => {
        mounted.splice(0).forEach(w => w.unmount())
    })

    beforeEach(() => {
        route.name = 'RewindView'
        route.params = {}
        replace.mockReset()
        vi.mocked(getRewind).mockReset()
    })

    it('tells the year in plates', async () => {
        vi.mocked(getRewind).mockResolvedValue({ status: 200, data: year2026 } as any)

        const w = page()
        await flushPromises()

        expect(getRewind).toHaveBeenLastCalledWith(undefined)
        expect(w.find('.rewind-hero .rewind-big').text()).toBe('12,345')
        expect(plates(w)).toEqual([
            'Rewind 2026',
            'Your top artist',
            'Your top album',
            'Your top tracks',
            'Song of your summer',
            'Your biggest day',
            'New to you',
            'How you listen',
        ])
        expect(w.text()).toContain('The album listener')
        expect(w.text()).toContain('Saturday, May 2')
    })

    it('shows the top tracks by the time they are ranked by, not by plays', async () => {
        vi.mocked(getRewind).mockResolvedValue({ status: 200, data: year2026 } as any)

        const w = page()
        await flushPromises()

        const row = w.find('.rewind-list.is-numbered li')
        expect(row.text()).toContain('Blue — The Artist')
        expect(row.find('.rewind-time').text()).toBe('3 h 5 min')
    })

    it('saves the year as a story image, drawn from the page it shows', async () => {
        vi.mocked(getRewind).mockResolvedValue({ status: 200, data: year2026 } as any)
        vi.mocked(saveBlob).mockClear()
        vi.mocked(shareImage).mockClear()

        const w = page()
        await flushPromises()
        const save = w.findAll('button').find(b => b.text() === 'Save as image')
        expect(save, 'Save as image button').toBeDefined()
        await save!.trigger('click')
        await flushPromises()

        expect(renderStory).toHaveBeenCalledWith(year2026)
        expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), 'aivinnet-rewind-2026.png')
        expect(shareImage).not.toHaveBeenCalled()
    })

    it('offers the share sheet only where the browser can share a file', async () => {
        vi.mocked(getRewind).mockResolvedValue({ status: 200, data: year2026 } as any)
        vi.mocked(saveBlob).mockClear()
        vi.mocked(shareImage).mockClear()
        vi.mocked(canShareImage).mockReturnValue(false)
        const hidden = page()
        await flushPromises()
        expect(hidden.findAll('button').some(b => b.text() === 'Share image')).toBe(false)
        hidden.unmount()
        mounted.splice(mounted.indexOf(hidden), 1)

        vi.mocked(canShareImage).mockReturnValue(true)
        const shown = page()
        await flushPromises()
        const share = shown.findAll('button').find(b => b.text() === 'Share image')
        expect(share, 'Share image button').toBeDefined()
        await share!.trigger('click')
        await flushPromises()

        expect(shareImage).toHaveBeenCalledWith(expect.any(Blob), 'aivinnet-rewind-2026.png', 'AivinNet Rewind 2026')
        expect(saveBlob).not.toHaveBeenCalled()
        vi.mocked(canShareImage).mockReturnValue(false)
    })

    it('says when a year still running opens, and keeps the way to the open ones', async () => {
        vi.mocked(getRewind).mockResolvedValue({
            status: 404,
            data: { error: 'Rewind 2026 opens on January 1, 2027', opens: '2027-01-01', years: [2024, 2025] },
        } as any)
        route.params = { year: '2026' }

        const w = page()
        await flushPromises()

        expect(plates(w)).toEqual(['Rewind 2026'])
        expect(w.text()).toContain('Opens on January 1, 2027')
        expect(w.text()).not.toContain('could not be loaded')
        expect(w.find('.rewind-retry').exists()).toBe(false)
        // A bookmark to this year still reaches the last finished one.
        expect(w.findAll('.rewind-years button').map(b => b.text())).toEqual(['2024', '2025'])
    })

    it('takes a 404 that does not say when the year opens for a failure', async () => {
        // An older backend or a proxy in between: no `opens`, so nothing is promised.
        vi.mocked(getRewind).mockResolvedValue({ status: 404, data: 'Not Found' } as any)
        route.params = { year: '2023' }

        const w = page()
        await flushPromises()

        expect(w.text()).toContain('could not be loaded')
        expect(w.text()).not.toContain('Opens on')
        expect(w.find('.rewind-retry').exists()).toBe(true)
    })

    it('switches years through the route', async () => {
        vi.mocked(getRewind).mockResolvedValue({ status: 200, data: year2026 } as any)

        const w = page()
        await flushPromises()
        await w.findAll('.rewind-years button')[0].trigger('click')

        expect(replace).toHaveBeenCalledWith({ name: 'RewindView', params: { year: 2025 } })

        route.params = { year: '2025' }
        await flushPromises()
        expect(getRewind).toHaveBeenLastCalledWith(2025)
    })

    it('keeps the way to the other years when one fails to load', async () => {
        vi.mocked(getRewind).mockResolvedValueOnce({ status: 200, data: year2026 } as any)
        const w = page()
        await flushPromises()

        vi.mocked(getRewind).mockResolvedValueOnce({ status: 500, data: null } as any)
        route.params = { year: '2025' }
        await flushPromises()

        expect(w.findAll('.rewind-years button').map(b => b.text())).toEqual(['2025', '2026'])
        expect(w.find('.rewind-years button[aria-pressed="true"]').text()).toBe('2025')
        expect(plates(w)).toEqual(['Rewind 2025'])
        expect(w.text()).toContain('could not be loaded')

        vi.mocked(getRewind).mockResolvedValueOnce({ status: 200, data: { ...year2026, year: 2025 } } as any)
        await w.find('.rewind-retry').trigger('click')
        await flushPromises()
        expect(getRewind).toHaveBeenLastCalledWith(2025)
        expect(plates(w)[0]).toBe('Rewind 2025')
        expect(w.text()).not.toContain('could not be loaded')
    })

    it('loads nothing when the route moves on to another page', async () => {
        vi.mocked(getRewind).mockResolvedValue({ status: 200, data: year2026 } as any)
        route.params = { year: '2026' }
        page()
        await flushPromises()

        route.name = 'StatsView'
        route.params = {}
        await flushPromises()

        expect(getRewind).toHaveBeenCalledTimes(1)
    })

    it('says so when a year has no music', async () => {
        const empty = {
            ...year2026,
            year: 2019,
            years: [],
            plays: 0,
            top_artists: [],
            top_albums: [],
            top_tracks: [],
            summer_track: null,
            busiest_day: null,
            new_artists: 0,
            listener: null,
        }
        vi.mocked(getRewind).mockResolvedValue({ status: 200, data: empty } as any)
        route.params = { year: '2019' }

        const w = page()
        await flushPromises()

        expect(plates(w)).toEqual(['Rewind 2019'])
        expect(w.text()).toContain('No music in 2019')
    })

    // Seen to the end (#572): only reaching the last plate marks the year.
    describe('seen to the end', () => {
        // What the page hands the observer (the DOM type is unknown to this lint).
        type Seen = (entries: { isIntersecting: boolean }[]) => void
        let observed: { callback: Seen; el: Element | null }[] = []

        beforeEach(() => {
            observed = []
            vi.mocked(markRewindSeen).mockReset()
            vi.stubGlobal(
                'IntersectionObserver',
                class {
                    entry: { callback: Seen; el: Element | null }
                    constructor(callback: Seen) {
                        this.entry = { callback, el: null }
                        observed.push(this.entry)
                    }
                    observe(el: Element) {
                        this.entry.el = el
                    }
                    disconnect() {
                        this.entry.el = null
                    }
                }
            )
        })
        afterEach(() => {
            vi.unstubAllGlobals()
        })

        const scrollTo = (visible: boolean) =>
            observed
                .filter(o => o.el)
                .forEach(o => o.callback([{ isIntersecting: visible }]))

        it('is not marked on opening, only when the end stays in view — once', async () => {
            vi.useFakeTimers()
            vi.mocked(markRewindSeen).mockResolvedValue({ status: 200, data: {} } as any)
            vi.mocked(getRewind).mockResolvedValue({ status: 200, data: year2026 } as any)

            const w = page()
            await flushPromises()

            expect(observed.some(o => o.el === w.find('.rewind-end').element)).toBe(true)
            // A glance at the end, gone again: no Rewind seen.
            scrollTo(true)
            await vi.advanceTimersByTimeAsync(1000)
            scrollTo(false)
            await vi.advanceTimersByTimeAsync(5000)
            expect(markRewindSeen).not.toHaveBeenCalled()

            scrollTo(true)
            await vi.advanceTimersByTimeAsync(2600)
            expect(markRewindSeen).toHaveBeenCalledTimes(1)
            expect(markRewindSeen).toHaveBeenCalledWith(2026)
            // Seen: the page stops watching.
            expect(observed.filter(o => o.el)).toHaveLength(0)
            vi.useRealTimers()
        })

        it('tries again when the server could not save it', async () => {
            vi.useFakeTimers()
            vi.mocked(markRewindSeen)
                .mockResolvedValueOnce({ status: 500, data: null } as any)
                .mockResolvedValue({ status: 200, data: {} } as any)
            vi.mocked(getRewind).mockResolvedValue({ status: 200, data: year2026 } as any)

            page()
            await flushPromises()

            scrollTo(true)
            await vi.advanceTimersByTimeAsync(2600)
            scrollTo(false)
            scrollTo(true)
            await vi.advanceTimersByTimeAsync(2600)

            expect(markRewindSeen).toHaveBeenCalledTimes(2)
            expect(observed.filter(o => o.el)).toHaveLength(0)
            vi.useRealTimers()
        })

        it('has no end to reach when the year did not load', async () => {
            vi.mocked(getRewind).mockResolvedValue({ status: 500, data: null } as any)

            const w = page()
            await flushPromises()

            expect(w.find('.rewind-end').exists()).toBe(false)
            expect(observed.filter(o => o.el)).toHaveLength(0)
        })
    })
})
