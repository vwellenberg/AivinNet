import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Logo from '@/components/Logo.vue'

// Easter egg (#544, #828): seven clicks within ~3 s receive a find from the
// library. The logo is still a link, so every click has to navigate as before.
const { getSignalFind } = vi.hoisted(() => ({ getSignalFind: vi.fn() }))
vi.mock('@/requests/home', () => ({ getSignalFind }))

import {
    __resetSignalTestState,
    anotherFind,
    CLICK_WINDOW_MS,
    closeSignalPlate,
    useSignalPlate,
} from '@/composables/useLogoSignal'

// The server's answer, shaped like `GET /nothome/signal` (the card Home draws).
const ALBUM = {
    type: 'album',
    reason: 'Never played',
    item: { albumhash: 'a1b2c3d4e5f60718', title: 'Old Love', image: 'a1b2c3d4e5f60718.webp?pathhash=ph1', albumartists: [{ name: 'Some Band' }] },
}
const TRACK = {
    type: 'track',
    reason: 'Forgotten favorite',
    item: { trackhash: '0f1e2d3c4b5a6978', title: 'Song 2', image: 'a1b2c3d4e5f60718.webp?pathhash=ph1', artists: [{ name: 'Some Band' }] },
}

function makeRouter() {
    const page = { render: () => null }
    return createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/', name: 'Home', component: page },
            { path: '/other', name: 'Other', component: page },
        ],
    })
}

async function mountLogo() {
    const router = makeRouter()
    await router.push('/other')
    await router.isReady()
    const wrapper = mount(Logo, { global: { plugins: [router] } })
    return { router, wrapper }
}

/** Clicks `count` times, `gapMs` apart. The last gap runs out too, like a real pause. */
async function click(wrapper: ReturnType<typeof mount>, count: number, gapMs: number) {
    for (let i = 0; i < count; i++) {
        await wrapper.find('a').trigger('click')
        vi.advanceTimersByTime(gapMs)
    }
}

const plate = () => useSignalPlate().value

describe('logo easter egg: seven clicks, one find', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        __resetSignalTestState()
        getSignalFind.mockReset()
        getSignalFind.mockResolvedValue(ALBUM)
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('seven fast clicks open the plate, which fills with the find', async () => {
        let answer!: (v: unknown) => void
        getSignalFind.mockReturnValue(new Promise(r => (answer = r)))
        const { wrapper } = await mountLogo()

        await click(wrapper, 7, 200)
        expect(plate()).toMatchObject({ loading: true, find: null })

        answer(ALBUM)
        await flushPromises()
        expect(plate()).toMatchObject({ loading: false, empty: false, find: ALBUM })
        expect(getSignalFind).toHaveBeenCalledWith(undefined)
    })

    it('six fast clicks do not', async () => {
        const { wrapper } = await mountLogo()

        await click(wrapper, 6, 200)
        expect(plate()).toBeNull()
        expect(getSignalFind).not.toHaveBeenCalled()
    })

    it('the window is 3 s: 2 s was too tight to hit on purpose', () => {
        expect(CLICK_WINDOW_MS).toBe(3000)
    })

    it('seven clicks spread over 2.4 s still count', async () => {
        const { wrapper } = await mountLogo()

        await click(wrapper, 7, 400)
        expect(plate()).not.toBeNull()
    })

    it('seven slow clicks do not: these span 3.6 s', async () => {
        const { wrapper } = await mountLogo()

        await click(wrapper, 7, 600)
        expect(plate()).toBeNull()
    })

    it('needs seven clicks inside the window, not seven clicks in total', async () => {
        const { wrapper } = await mountLogo()

        await click(wrapper, 6, 200)
        vi.advanceTimersByTime(CLICK_WINDOW_MS)
        await click(wrapper, 1, 0)
        expect(plate()).toBeNull()
    })

    it('every click still navigates to Home, including the seventh', async () => {
        const { router, wrapper } = await mountLogo()

        await click(wrapper, 1, 0)
        await flushPromises()
        expect(router.currentRoute.value.name).toBe('Home')

        await router.push('/other')
        await click(wrapper, 7, 200)
        await flushPromises()
        expect(router.currentRoute.value.name).toBe('Home')
        expect(plate()).not.toBeNull()
    })

    it('hangs the plate from the lower edge of the planet', async () => {
        const { wrapper } = await mountLogo()
        const planet = wrapper.find('.logo-orbit-wrapper').element
        planet.getBoundingClientRect = () => ({ left: 20, top: 12, right: 64, bottom: 56, width: 44, height: 44 }) as DOMRect

        await click(wrapper, 7, 200)
        expect(plate()!.anchor).toEqual({ left: 20, top: 56, right: 64 })
    })

    it('nothing to find says so instead of staying silent', async () => {
        getSignalFind.mockResolvedValue(null)
        const { wrapper } = await mountLogo()

        await click(wrapper, 7, 200)
        await flushPromises()
        expect(plate()).toMatchObject({ loading: false, empty: true, find: null })
    })

    it('a failed request says so, not "you have heard it all", and is no stuck "Tuning in"', async () => {
        getSignalFind.mockRejectedValue(new Error('offline'))
        const { wrapper } = await mountLogo()

        await click(wrapper, 7, 200)
        await flushPromises()
        expect(plate()).toMatchObject({ loading: false, failed: true, empty: false })
    })

    it('a failed "Another" keeps the find on the plate', async () => {
        const { wrapper } = await mountLogo()
        await click(wrapper, 7, 200)
        await flushPromises()

        getSignalFind.mockRejectedValue(new Error('offline'))
        anotherFind()
        await flushPromises()

        expect(plate()).toMatchObject({ loading: false, failed: false, find: ALBUM })
    })

    it('"Another" asks for a different find than the one on the plate', async () => {
        const { wrapper } = await mountLogo()
        await click(wrapper, 7, 200)
        await flushPromises()

        getSignalFind.mockResolvedValue(TRACK)
        anotherFind()
        expect(plate()).toMatchObject({ loading: true, find: ALBUM })
        await flushPromises()

        expect(getSignalFind).toHaveBeenLastCalledWith(ALBUM.item.albumhash)
        expect(plate()).toMatchObject({ loading: false, find: TRACK })
    })

    it('seven more clicks put up a fresh plate with a fresh find', async () => {
        const { wrapper } = await mountLogo()
        await click(wrapper, 7, 200)
        await flushPromises()
        const id = plate()!.id

        getSignalFind.mockResolvedValue(TRACK)
        await click(wrapper, 7, 200)
        await flushPromises()

        expect(plate()!.id).not.toBe(id)
        expect(plate()).toMatchObject({ find: TRACK })
    })

    it('an answer that arrives after the close does not reopen the plate', async () => {
        let answer!: (v: unknown) => void
        getSignalFind.mockReturnValue(new Promise(r => (answer = r)))
        const { wrapper } = await mountLogo()

        await click(wrapper, 7, 200)
        closeSignalPlate()
        answer(ALBUM)
        await flushPromises()

        expect(plate()).toBeNull()
    })

    it('an older answer cannot overwrite a newer one', async () => {
        const answers: Array<(v: unknown) => void> = []
        getSignalFind.mockImplementation(() => new Promise(r => answers.push(r)))
        const { wrapper } = await mountLogo()

        await click(wrapper, 7, 200)
        anotherFind()
        answers[1](TRACK)
        answers[0](ALBUM)
        await flushPromises()

        expect(plate()!.find).toEqual(TRACK)
    })
})
