import { readFileSync } from 'node:fs'

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SatelliteFlyby from '@/components/SatelliteFlyby.vue'
import { __resetSatelliteTestState, FLIGHT_MS, useLogoSatellite } from '@/composables/useLogoSatellite'
import { useToast } from '@/stores/notification'

// The flyby layer (#544): drawn once in App.vue, from the flight the logo or the
// phone icon launches. These tests check what is drawn and from where; the
// motion itself is the stylesheet's.

/** A stand-in icon that launches through the real composable. */
function launcher() {
    let registerClick: (origin?: Element | null) => void = () => {}
    const Icon = defineComponent({
        setup() {
            registerClick = useLogoSatellite().registerClick
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

describe('SatelliteFlyby', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        __resetSatelliteTestState()
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    })

    afterEach(() => {
        vi.useRealTimers()
        delete (window as any).matchMedia
    })

    it('draws nothing until a flight is launched', () => {
        const layer = mount(SatelliteFlyby)
        expect(layer.find('.sat-flyby').exists()).toBe(false)
    })

    it('draws the satellite, three radio waves and the static, then goes away', async () => {
        const layer = mount(SatelliteFlyby)
        launcher()(origin(20, 12))
        await layer.vm.$nextTick()

        expect(layer.find('.sat-flyby').attributes('aria-hidden')).toBe('true')
        expect(layer.findAll('.sat-craft')).toHaveLength(1)
        expect(layer.findAll('.sat-wave')).toHaveLength(3)
        expect(layer.findAll('.sat-static')).toHaveLength(1)

        vi.advanceTimersByTime(FLIGHT_MS)
        await layer.vm.$nextTick()
        expect(layer.find('.sat-flyby').exists()).toBe(false)
    })

    it('starts from the icon that was clicked, the phone icon as well as the logo', async () => {
        const layer = mount(SatelliteFlyby)
        launcher()(origin(16, 20, 32))
        await layer.vm.$nextTick()

        const style = layer.find('.sat-flyby').attributes('style')
        expect(style).toContain('--sat-x: 32px')
        expect(style).toContain('--sat-y: 36px')
    })

    it('hands every duration to the stylesheet, with the flight from the composable', async () => {
        const layer = mount(SatelliteFlyby)
        launcher()(origin(0, 0))
        await layer.vm.$nextTick()

        expect(layer.find('.sat-flyby').attributes('style')).toContain(`--sat-flight: ${FLIGHT_MS}ms`)
    })

    it('one flight at a time: launching again mid-flight does not restart it', async () => {
        const layer = mount(SatelliteFlyby)
        const launch = launcher()
        launch(origin(0, 0))
        await layer.vm.$nextTick()
        const first = layer.find('.sat-flyby').element

        launch(origin(100, 100))
        await layer.vm.$nextTick()
        expect(layer.find('.sat-flyby').element).toBe(first)
        expect(layer.find('.sat-flyby').attributes('style')).toContain('--sat-x: 22px')
    })

    it('under reduced motion nothing flies, only the toast answers', async () => {
        window.matchMedia = vi.fn(() => ({ matches: true })) as any
        const layer = mount(SatelliteFlyby)
        launcher()(origin(0, 0))
        await layer.vm.$nextTick()

        expect(layer.find('.sat-flyby').exists()).toBe(false)
        expect(useToast().notifs.map(n => n.text)).toEqual(['📡 Signal received'])
    })
})

describe('SatelliteFlyby: mounted once, app-wide', () => {
    it('App.vue draws the layer exactly once', () => {
        const app = readFileSync('src/App.vue', 'utf8')
        expect(app.match(/<SatelliteFlyby\s*\/>/g) ?? []).toHaveLength(1)
    })
})
