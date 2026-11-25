import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Home is laid down in ONE go: nothing that sits under "Continue listening"
// may stand on the page before Home's answer is there.
//
// Browse Library fetches its crates itself (GET /getall), and since #808 it
// sits right under the Continue cards. On a first visit /getall answered before
// /nothome (which computes every row), so the crates stood at the TOP of the
// page, then the Continue cards were inserted above them: the crates jumped
// away and the cards faded in where they had been. Reported as "the Continue
// listening tiles flicker while Home builds" (user, 2026-11-17, Vivaldi, wide
// window); filmed against the real server at 25 fps. A return visit has the
// answer in the store already, so only the first build showed it.
// ---------------------------------------------------------------------------

const { getHomePageData, stub } = vi.hoisted(() => ({
    getHomePageData: vi.fn(),
    // The parts of Home stand in as named boxes: the test is about which of them
    // is on the page, and in which order, not about what they draw.
    stub: async (name: string) => {
        const { defineComponent, h } = await import('vue')
        return { default: defineComponent({ name, render: () => h('div', { class: name }) }) }
    },
}))

vi.mock('@/requests/home', () => ({ getHomePageData, getSurpriseAlbum: vi.fn() }))
vi.mock('@/stores/content-width', async () => {
    const { ref } = await import('vue')
    // isMobile: the 900px line, set per test (imported below as `phone`).
    return { fetchCardCount: ref(6), maxAbumCards: ref(6), isMobile: ref(false) }
})
vi.mock('@/utils/updatePageTitle', () => ({ default: vi.fn() }))
vi.mock('@/helpers/usePlayFrom', () => ({ playFromAlbumCard: vi.fn(), playFromPlaylist: vi.fn() }))
vi.mock('@/helpers/notInterested', () => ({ notInterestedMenu: vi.fn() }))
vi.mock('@/assets/icons/shuffle.svg', () => ({ default: {} }))
vi.mock('@/assets/icons/play.svg', () => ({ default: {} }))
vi.mock('@/assets/icons/chart.svg', () => ({ default: {} }))

vi.mock('@/components/HomeView/Browse.vue', () => stub('browse-stub'))
vi.mock('@/components/HomeView/ContinueCard.vue', () => stub('continue-stub'))
vi.mock('@/components/HomeView/RadioDial.vue', () => stub('radio-stub'))
vi.mock('@/components/HomeView/RewindCard.vue', () => stub('rewind-stub'))
vi.mock('@/components/HomeView/YearInMusicCard.vue', () => stub('year-stub'))
vi.mock('@/components/HomeView/WeeklyRecap.vue', () => stub('recap-stub'))
vi.mock('@/components/HomeView/AdventCalendar.vue', () => stub('advent-stub'))
vi.mock('@/components/shared/GenericHeader.vue', () => stub('header-stub'))
vi.mock('@/components/shared/CardScroller.vue', () => stub('row-stub'))

import HomeView from '@/views/HomeView/main.vue'
import useHome from '@/stores/home'
import { isMobile as phone } from '@/stores/content-width'

// As GET /nothome/ sends it: Continue listening first, then the rows.
const answer = {
    rows: [
        {
            continue_listening: {
                title: 'Continue listening',
                items: [
                    {
                        type: 'album',
                        item: { albumhash: 'a81af5b91ea34739', title: 'Light Up The Night', track_index: 3, track_total: 9 },
                        dismiss: { type: 'album', hash: 'a81af5b91ea34739' },
                    },
                ],
            },
        },
        { recently_played: { title: 'Recently played', items: [{ type: 'album', item: { albumhash: 'd22311ed9c1e527c' } }] } },
    ],
    stations: [],
    recap: null,
    advent: null,
    rewind: null,
}

function held() {
    let release!: () => void
    getHomePageData.mockReturnValueOnce(new Promise(resolve => (release = () => resolve(answer))))
    return () => release()
}

const mountHome = () => mount(HomeView, { global: { stubs: { RouterLink: RouterLinkStub } } })

beforeEach(() => {
    setActivePinia(createPinia())
    getHomePageData.mockReset()
    phone.value = false
})

describe('Home build order', () => {
    it('keeps Browse Library off the page until Home has answered', async () => {
        const release = held()
        const w = mountHome()
        await flushPromises()

        // The answer is still out: no Continue cards yet, so nothing under them either.
        expect(w.find('.continue-stub').exists()).toBe(false)
        expect(w.find('.browse-stub').exists()).toBe(false)

        release()
        await flushPromises()

        expect(w.find('.continue-stub').exists()).toBe(true)
        expect(w.find('.browse-stub').exists()).toBe(true)
    })

    it('puts the crates UNDER the cards when both are there', async () => {
        const release = held()
        const w = mountHome()
        release()
        await flushPromises()

        const order = w.findAll('.continue-stub, .browse-stub').map(e => e.classes()[0])
        expect(order).toEqual(['continue-stub', 'browse-stub'])
    })

    it('shows Browse at once on a return visit: the answer is in the store', async () => {
        // First visit, answered.
        getHomePageData.mockResolvedValueOnce(answer)
        mountHome().unmount()
        await flushPromises()

        // Second visit: the refetch is still out, the store already has Home.
        held()
        const w = mountHome()
        await flushPromises()
        expect(w.find('.continue-stub').exists()).toBe(true)
        expect(w.find('.browse-stub').exists()).toBe(true)
    })

    it('shows Browse when Home failed: a failed answer is an answer', async () => {
        // useAxios resolves on errors; getHomePageData then hands back no rows.
        getHomePageData.mockResolvedValueOnce({ rows: [], stations: [], recap: null, advent: null, rewind: null })
        const w = mountHome()
        await flushPromises()
        expect(w.find('.browse-stub').exists()).toBe(true)
    })

    it('does not mark Home answered from a stale answer', async () => {
        const home = useHome()
        const releaseOld = held()
        const releaseNew = held()
        const first = home.fetchAll()
        const second = home.fetchAll('christmas')

        releaseOld()
        await first
        // The older answer is dropped (only the newest writes): still not answered.
        expect(home.answered).toBe(false)

        releaseNew()
        await second
        expect(home.answered).toBe(true)
    })
})

// ---------------------------------------------------------------------------
// Stats on the phone (user, 2026-11-25): the phone's bottom bar has no Stats
// entry, and until then the only way there was the recap card on Mondays and
// the 1st — the user landed on Stats once and could not find it again.
// ---------------------------------------------------------------------------
describe('The way to Stats at the end of Home', () => {
    it('stands at the very end of Home on a phone, linking to Stats', async () => {
        phone.value = true
        getHomePageData.mockResolvedValueOnce(answer)
        const w = mountHome()
        await flushPromises()

        const door = w.find('.home-stats-door')
        expect(door.exists()).toBe(true)
        expect(w.find('.homepageview').element.lastElementChild).toBe(door.element)
        const link = door.findComponent(RouterLinkStub)
        expect(link.props('to')).toEqual({ name: 'StatsView' })
        expect(link.text()).toBe('Your listening stats')
    })

    it('is not there on desktop: the sidebar has Stats', async () => {
        getHomePageData.mockResolvedValueOnce(answer)
        const w = mountHome()
        await flushPromises()
        expect(w.find('.home-stats-door').exists()).toBe(false)
    })

    it('waits for Home: before the answer, the end of Home is its top', async () => {
        phone.value = true
        const release = held()
        const w = mountHome()
        await flushPromises()
        expect(w.find('.home-stats-door').exists()).toBe(false)

        release()
        await flushPromises()
        expect(w.find('.home-stats-door').exists()).toBe(true)
    })
})
