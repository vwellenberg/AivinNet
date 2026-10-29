import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Logo from '@/components/Logo.vue'
import { useToast } from '@/stores/notification'

// Easter egg (#544): seven clicks within ~3 s send a satellite round the logo.
// The logo is still a link, so every click has to navigate as before.
import { CLICK_WINDOW_MS, LAP_MS } from '@/composables/useLogoSatellite'

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

function satellite(wrapper: ReturnType<typeof mount>) {
    return wrapper.find('.logo-satellite')
}

describe('logo satellite easter egg', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    })

    afterEach(() => {
        vi.useRealTimers()
        delete (window as any).matchMedia
        delete (window as any).AudioContext
    })

    it('seven fast clicks launch the satellite, and it leaves after one lap', async () => {
        const { wrapper } = await mountLogo()

        await click(wrapper, 7, 200)
        expect(satellite(wrapper).exists()).toBe(true)
        // The toast comes with the flight: a satellite in the corner of the eye
        // is easy to miss.
        expect(useToast().notifs.map(n => n.text)).toEqual(['📡 Signal received'])

        vi.advanceTimersByTime(LAP_MS)
        await wrapper.vm.$nextTick()
        expect(satellite(wrapper).exists()).toBe(false)
    })

    it('six fast clicks do not launch it', async () => {
        const { wrapper } = await mountLogo()

        await click(wrapper, 6, 200)
        expect(satellite(wrapper).exists()).toBe(false)
    })

    it('the window is 3 s: 2 s was too tight to hit on purpose', () => {
        expect(CLICK_WINDOW_MS).toBe(3000)
    })

    it('seven clicks spread over 2.4 s still launch it', async () => {
        const { wrapper } = await mountLogo()

        await click(wrapper, 7, 400)
        expect(satellite(wrapper).exists()).toBe(true)
    })

    it('seven slow clicks do not launch it: these span 3.6 s', async () => {
        const { wrapper } = await mountLogo()

        await click(wrapper, 7, 600)
        expect(satellite(wrapper).exists()).toBe(false)
    })

    it('needs seven clicks inside the window, not seven clicks in total', async () => {
        const { wrapper } = await mountLogo()

        // Six fast, a pause, then one more: the old six have expired.
        await click(wrapper, 6, 200)
        vi.advanceTimersByTime(CLICK_WINDOW_MS)
        await click(wrapper, 1, 0)
        expect(satellite(wrapper).exists()).toBe(false)
    })

    it('under reduced motion it shows a toast instead of flying', async () => {
        window.matchMedia = vi.fn(() => ({ matches: true })) as any
        const { wrapper } = await mountLogo()
        const toast = useToast()

        await click(wrapper, 7, 200)

        expect(satellite(wrapper).exists()).toBe(false)
        expect(toast.notifs.map(n => n.text)).toEqual(['📡 Signal received'])
    })

    it('every click still navigates to Home, including the seventh', async () => {
        const { router, wrapper } = await mountLogo()
        expect(router.currentRoute.value.name).toBe('Other')

        await click(wrapper, 1, 0)
        await flushPromises()
        expect(router.currentRoute.value.name).toBe('Home')

        await router.push('/other')
        await click(wrapper, 7, 200)
        await flushPromises()
        expect(router.currentRoute.value.name).toBe('Home')
        expect(satellite(wrapper).exists()).toBe(true)
    })

    it('plays a short generated hiss with the satellite when Web Audio exists', async () => {
        const contexts: Array<{ started: number }> = []
        class FakeAudioContext {
            sampleRate = 8000
            destination = {}
            started = 0
            constructor() {
                contexts.push(this)
            }
            createBuffer(_channels: number, length: number) {
                return { getChannelData: () => new Float32Array(length) }
            }
            createBufferSource() {
                const ctx = this
                return {
                    buffer: null as unknown,
                    onended: null as unknown,
                    connect(node: unknown) {
                        return node
                    },
                    start() {
                        ctx.started++
                    },
                }
            }
            createBiquadFilter() {
                return { type: '', frequency: { value: 0 }, Q: { value: 0 }, connect: (n: unknown) => n }
            }
            createGain() {
                return { gain: { value: 0 }, connect: (n: unknown) => n }
            }
            close() {
                return Promise.resolve()
            }
        }
        ;(window as any).AudioContext = FakeAudioContext

        const { wrapper } = await mountLogo()
        await click(wrapper, 7, 200)

        expect(contexts).toHaveLength(1)
        expect(contexts[0].started).toBe(1)
    })

    it('without Web Audio the satellite still flies, silently', async () => {
        const { wrapper } = await mountLogo()

        await click(wrapper, 7, 200)
        expect(satellite(wrapper).exists()).toBe(true)
    })
})
