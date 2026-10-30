import { readFileSync } from 'node:fs'

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SignalBurst from '@/components/SignalBurst.vue'
import { __resetSignalTestState, BURST_MS, useLogoSignal } from '@/composables/useLogoSignal'
import { useToast } from '@/stores/notification'

// The signal layer (#544): drawn once in App.vue, from the burst the logo or
// the phone icon sends. These tests check what is drawn and from where; the
// motion itself is the stylesheet's.

/** A stand-in icon that sends through the real composable. */
function launcher() {
    let registerClick: (origin?: Element | null) => void = () => {}
    const Icon = defineComponent({
        setup() {
            registerClick = useLogoSignal().registerClick
            return () => h('span')
        },
    })
    mount(Icon)
    return (origin?: Element | null) => {
        for (let i = 0; i < 7; i++) registerClick(origin)
    }
}

function origin(left: number, top: number, size = 44): Element {
    const el = document.createElement('div')
    el.getBoundingClientRect = () => ({ left, top, width: size, height: size }) as DOMRect
    return el
}

function viewport(w: number, h: number) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: w })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: h })
}

describe('SignalBurst', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        __resetSignalTestState()
        viewport(1440, 900)
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    })

    afterEach(() => {
        vi.useRealTimers()
        delete (window as any).matchMedia
    })

    it('draws nothing until a signal is sent', () => {
        const layer = mount(SignalBurst)
        expect(layer.find('.sig-burst').exists()).toBe(false)
    })

    it('draws waves, the trace, the static and the flash, then goes away', async () => {
        const layer = mount(SignalBurst)
        launcher()(origin(20, 12))
        await layer.vm.$nextTick()

        expect(layer.find('.sig-burst').attributes('aria-hidden')).toBe('true')
        expect(layer.findAll('.sig-wave')).toHaveLength(5)
        expect(layer.findAll('.sig-wave.is-dashed')).toHaveLength(2)
        expect(layer.findAll('.sig-trace path')).toHaveLength(2)
        expect(layer.findAll('.sig-static')).toHaveLength(1)
        expect(layer.findAll('.sig-roll')).toHaveLength(1)
        expect(layer.findAll('.sig-tear')).toHaveLength(3)
        expect(layer.findAll('.sig-flash')).toHaveLength(1)

        vi.advanceTimersByTime(BURST_MS)
        await layer.vm.$nextTick()
        expect(layer.find('.sig-burst').exists()).toBe(false)
    })

    it('there is no satellite any more', async () => {
        const layer = mount(SignalBurst)
        launcher()(origin(20, 12))
        await layer.vm.$nextTick()
        expect(layer.html()).not.toMatch(/sat|craft/)
    })

    it('starts from the icon that was clicked, the phone icon as well as the logo', async () => {
        const layer = mount(SignalBurst)
        launcher()(origin(16, 20, 32))
        await layer.vm.$nextTick()

        const style = layer.find('.sig-burst').attributes('style')
        expect(style).toContain('--sig-x: 32px')
        expect(style).toContain('--sig-y: 36px')
    })

    it('the waves reach past the farthest corner of the screen', async () => {
        const layer = mount(SignalBurst)
        launcher()(origin(0, 0, 0))
        await layer.vm.$nextTick()

        // From the top-left corner, the far corner is the diagonal away.
        const diameter = Math.ceil(2 * Math.hypot(1440, 900))
        expect(layer.find('.sig-burst').attributes('style')).toContain(`--sig-reach: ${diameter}px`)
    })

    it('the trace runs from the planet to the right edge, and starts flat', async () => {
        const layer = mount(SignalBurst)
        launcher()(origin(18, 18))
        await layer.vm.$nextTick()

        const svg = layer.find('.sig-trace')
        expect(svg.attributes('width')).toBe(String(1440 - 40))
        const d = layer.find('.sig-trace-line').attributes('d')!
        // The first point sits on the middle line: the swing grows out of the planet.
        expect(d.startsWith('M0,32.0')).toBe(true)
    })

    it('hands every duration to the stylesheet, with the burst from the composable', async () => {
        const layer = mount(SignalBurst)
        launcher()(origin(0, 0))
        await layer.vm.$nextTick()

        expect(layer.find('.sig-burst').attributes('style')).toContain(`--sig-burst: ${BURST_MS}ms`)
    })

    it('one burst at a time: sending again mid-burst does not restart it', async () => {
        const layer = mount(SignalBurst)
        const send = launcher()
        send(origin(0, 0))
        await layer.vm.$nextTick()
        const first = layer.find('.sig-burst').element

        send(origin(100, 100))
        await layer.vm.$nextTick()
        expect(layer.find('.sig-burst').element).toBe(first)
        expect(layer.find('.sig-burst').attributes('style')).toContain('--sig-x: 22px')
    })

    it('under reduced motion nothing moves, only the toast answers', async () => {
        window.matchMedia = vi.fn(() => ({ matches: true })) as any
        const layer = mount(SignalBurst)
        launcher()(origin(0, 0))
        await layer.vm.$nextTick()

        expect(layer.find('.sig-burst').exists()).toBe(false)
        expect(useToast().notifs.map(n => n.text)).toEqual(['📡 Signal received'])
    })
})

describe('SignalBurst: mounted once, app-wide', () => {
    it('App.vue draws the layer exactly once', () => {
        const app = readFileSync('src/App.vue', 'utf8')
        expect(app.match(/<SignalBurst\s*\/>/g) ?? []).toHaveLength(1)
    })
})
