import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The plate of the logo's find (#828): what it shows, what its buttons do,
// and when it goes away by itself.
const { getSignalFind, playFromAlbumCard, playFromPlaylist } = vi.hoisted(() => ({
    getSignalFind: vi.fn(),
    playFromAlbumCard: vi.fn(),
    playFromPlaylist: vi.fn(),
}))
vi.mock('@/requests/home', () => ({ getSignalFind }))
vi.mock('@/helpers/usePlayFrom', () => ({ playFromAlbumCard, playFromPlaylist }))
// The real router module pulls in every view; the plate only needs the name.
vi.mock('@/router', () => ({ Routes: { album: 'AlbumView' } }))

import SignalFind from '@/components/SignalFind.vue'
import { __resetSignalTestState, AUTO_CLOSE_MS, useLogoSignal, useSignalPlate } from '@/composables/useLogoSignal'

const ALBUM = {
    type: 'album',
    reason: 'Never played',
    item: {
        albumhash: 'a1b2c3d4e5f60718',
        title: 'Old Love',
        image: 'a1b2c3d4e5f60718.webp?pathhash=ph1',
        albumartists: [{ name: 'Some Band' }, { name: 'Guest' }],
    },
}
const TRACK = {
    type: 'track',
    reason: 'Forgotten favorite',
    item: {
        trackhash: '0f1e2d3c4b5a6978',
        albumhash: 'a1b2c3d4e5f60718',
        title: 'Song 2',
        image: 'a1b2c3d4e5f60718.webp?pathhash=ph1',
        artists: [{ name: 'Some Band' }],
    },
}

const plate = () => useSignalPlate().value

async function openWith(find: unknown) {
    getSignalFind.mockResolvedValue(find)
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/', name: 'Home', component: { render: () => null } },
            { path: '/albums/:albumhash', name: 'AlbumView', component: { render: () => null } },
        ],
    })
    const wrapper = mount(SignalFind, { global: { plugins: [router] }, attachTo: document.body })

    const origin = document.createElement('div')
    origin.getBoundingClientRect = () => ({ left: 20, top: 12, right: 64, bottom: 56 }) as DOMRect
    const { registerClick } = useLogoSignal()
    for (let i = 0; i < 7; i++) registerClick(origin)
    await flushPromises()
    return wrapper
}

describe('SignalFind: the plate of the logo find', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        __resetSignalTestState()
        vi.clearAllMocks()
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    })

    afterEach(() => {
        vi.useRealTimers()
        document.body.innerHTML = ''
    })

    it('shows the album with its reason, artists and cover, under the planet', async () => {
        const wrapper = await openWith(ALBUM)
        const el = wrapper.find('.signal-find')

        expect(el.find('.sf-reason').text()).toBe('Never played')
        expect(el.find('.sf-title').text()).toBe('Old Love')
        expect(el.find('.sf-artist').text()).toBe('Some Band, Guest')
        expect(el.find('.sf-cover').attributes('src')).toContain('a1b2c3d4e5f60718.webp?pathhash=ph1')
        expect(el.attributes('style')).toContain('--sf-left: 20px')
        expect(el.attributes('style')).toContain('--sf-top: 56px')
        expect(el.find('.sf-title').attributes('href')).toContain('/albums/a1b2c3d4e5f60718')
    })

    it('Play on an album plays the album and closes the plate', async () => {
        const wrapper = await openWith(ALBUM)

        await wrapper.find('.sf-play').trigger('click')

        expect(playFromAlbumCard).toHaveBeenCalledWith('a1b2c3d4e5f60718', 'Old Love')
        expect(plate()).toBeNull()
    })

    it('Play on a track plays "Forgotten favorites" from that track', async () => {
        const wrapper = await openWith(TRACK)
        expect(wrapper.find('.sf-artist').text()).toBe('Some Band')

        await wrapper.find('.sf-play').trigger('click')

        expect(playFromPlaylist).toHaveBeenCalledWith('forgottenfavorites', TRACK.item)
        expect(playFromAlbumCard).not.toHaveBeenCalled()
    })

    it('Another asks for a different find', async () => {
        const wrapper = await openWith(ALBUM)

        getSignalFind.mockResolvedValue(TRACK)
        await wrapper.find('.sf-another').trigger('click')
        await flushPromises()

        expect(getSignalFind).toHaveBeenLastCalledWith('a1b2c3d4e5f60718')
        expect(wrapper.find('.sf-title').text()).toBe('Song 2')
    })

    it('nothing to find: a note, no buttons', async () => {
        const wrapper = await openWith(null)

        expect(wrapper.find('.sf-note').text()).toContain('No signal')
        expect(wrapper.find('.sf-play').exists()).toBe(false)
    })

    it('goes by itself after a while left alone', async () => {
        await openWith(ALBUM)

        vi.advanceTimersByTime(AUTO_CLOSE_MS - 1)
        expect(plate()).not.toBeNull()
        vi.advanceTimersByTime(1)
        expect(plate()).toBeNull()
    })

    it('stays while the pointer is on it, and the clock restarts when it leaves', async () => {
        const wrapper = await openWith(ALBUM)

        await wrapper.find('.signal-find').trigger('mouseenter')
        vi.advanceTimersByTime(AUTO_CLOSE_MS * 2)
        expect(plate()).not.toBeNull()

        await wrapper.find('.signal-find').trigger('mouseleave')
        vi.advanceTimersByTime(AUTO_CLOSE_MS)
        expect(plate()).toBeNull()
    })

    it('Esc and the ✕ close it', async () => {
        let wrapper = await openWith(ALBUM)
        await wrapper.find('.signal-find').trigger('keydown', { key: 'Escape' })
        expect(plate()).toBeNull()
        wrapper.unmount()

        wrapper = await openWith(ALBUM)
        await wrapper.find('.sf-close').trigger('click')
        expect(plate()).toBeNull()
    })

    it('a press outside closes it, a press inside does not', async () => {
        const wrapper = await openWith(ALBUM)

        wrapper.find('.sf-artist').element.dispatchEvent(new Event('pointerdown', { bubbles: true }))
        expect(plate()).not.toBeNull()

        document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
        expect(plate()).toBeNull()
    })
})
