import { mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The volume bar previews the level a click sets, like the seek bar previews
// the time: a yellow span from the level to the pointer, the sprinkle over
// everything painted, a pill with the level in percent — and the click lands
// exactly there. It used to be a bare teal band with no preview at all.

const settings = reactive({
    volume: 0.4,
    mute: false,
    get is_silent() {
        return this.mute || this.volume === 0
    },
    setVolume: vi.fn((v: number) => {
        settings.volume = v
    }),
    toggleMute: vi.fn(() => {
        settings.mute = !settings.mute
    }),
})

vi.mock('@/stores/settings', () => ({ default: () => settings }))

import Volume from '@/components/BottomBar/Volume.vue'

// The bar's box: 200px wide from x=0, so clientX / 2 is the percentage.
const BAR = { left: 0, top: 0, width: 200, height: 20 }
const realRect = Element.prototype.getBoundingClientRect
// jsdom 30 hands out CSSStyleProperties, a subclass whose prototype shadows
// CSSStyleDeclaration's: patch what an element's style really inherits from.
const styleProto = Object.getPrototypeOf(document.createElement('div').style)
const realBg = Object.getOwnPropertyDescriptor(styleProto, 'background')
let lastBg = ''

beforeEach(() => {
    settings.volume = 0.4
    settings.mute = false
    settings.setVolume.mockClear()
    settings.toggleMute.mockClear()
    lastBg = ''
    Element.prototype.getBoundingClientRect = () =>
        ({ ...BAR, right: BAR.width, bottom: BAR.height, x: 0, y: 0 }) as DOMRect
    // jsdom drops the layered shorthand it cannot parse; keep what was written.
    Object.defineProperty(styleProto, 'background', {
        configurable: true,
        get: () => lastBg,
        set: (v: string) => {
            lastBg = v
        },
    })
})

afterEach(() => {
    Element.prototype.getBoundingClientRect = realRect
    if (realBg) Object.defineProperty(styleProto, 'background', realBg)
    else Reflect.deleteProperty(styleProto, 'background')
})

const span = () => {
    const stops = [...lastBg.matchAll(/var\(--look-track-seek, var\(--mem-yellow\)\) ([\d.]+)%/g)].map((m) => Number(m[1]))
    return stops.length === 2 ? { from: stops[0], to: stops[1] } : null
}
const fill = () => Number(/left center \/ ([\d.]+)% 100% no-repeat, var\(--look-track/.exec(lastBg)?.[1] ?? NaN)
const textureFrac = (w: ReturnType<typeof mount>) =>
    Number(/--texture-frac: ([\d.]+)/.exec(w.find('.volume-wrap').attributes('style') ?? '')?.[1] ?? NaN)
// A real pointer click carries `detail >= 1`; a keyboard-synthesised one 0.
// `trigger()` cannot set `detail` (read-only on UIEvent), so dispatch by hand.
const clickAt = async (w: ReturnType<typeof mount>, clientX: number, detail = 1) => {
    w.find('.volume-slider').element.dispatchEvent(new MouseEvent('click', { clientX, detail, bubbles: true }))
    await w.vm.$nextTick()
}
// jsdom 30 made MouseEvent.clientX a getter, which VTU's trigger() cannot overwrite:
// build the event natively and attach the one field jsdom's MouseEvent lacks.
const hoverAt = async (w: ReturnType<typeof mount>, clientX: number, pointerType = 'mouse') => {
    const ev = new MouseEvent('pointermove', { clientX, bubbles: true })
    Object.defineProperty(ev, 'pointerType', { value: pointerType })
    w.find('.volume-wrap').element.dispatchEvent(ev)
    await w.vm.$nextTick()
}

describe('volume bar preview', () => {
    it('fills to the level and paints no span while not hovered', () => {
        const w = mount(Volume)
        expect(fill()).toBeCloseTo(40)
        expect(span()).toBeNull()
        expect(w.find('.progress-tooltip').isVisible()).toBe(false)
    })

    it('previews a louder level: span from the level to the pointer, pill in percent', async () => {
        const w = mount(Volume)
        await hoverAt(w, 140) // 70%

        expect(span()?.from).toBeCloseTo(40)
        expect(span()?.to).toBeCloseTo(70)
        expect(w.find('.progress-tooltip').isVisible()).toBe(true)
        expect(w.find('.progress-tooltip').text()).toBe('70%')
        // The sprinkle covers the fill AND the preview.
        expect(textureFrac(w)).toBeCloseTo(0.7)
    })

    it('previews a quieter level backwards, the texture stays on the fill', async () => {
        const w = mount(Volume)
        await hoverAt(w, 20) // 10%

        expect(span()?.from).toBeCloseTo(10)
        expect(span()?.to).toBeCloseTo(40)
        expect(w.find('.progress-tooltip').text()).toBe('10%')
        expect(textureFrac(w)).toBeCloseTo(0.4)
    })

    it('shows nothing for a touch, which has no hover', async () => {
        const w = mount(Volume)
        await hoverAt(w, 140, 'touch')

        expect(span()).toBeNull()
        expect(w.find('.progress-tooltip').isVisible()).toBe(false)
    })

    it('clears the preview when the pointer leaves', async () => {
        const w = mount(Volume)
        await hoverAt(w, 140)
        await w.find('.volume-wrap').trigger('pointerleave')

        expect(span()).toBeNull()
        expect(w.find('.progress-tooltip').isVisible()).toBe(false)
    })
})

describe('volume bar click', () => {
    it('sets exactly the level the pill showed', async () => {
        const w = mount(Volume)
        await hoverAt(w, 140)
        await clickAt(w, 140)

        expect(settings.setVolume).toHaveBeenLastCalledWith(0.7)
    })

    it('leaves a keyboard click to the native value', async () => {
        const w = mount(Volume)
        await clickAt(w, 140, 0)

        expect(settings.setVolume).not.toHaveBeenCalled()
    })

    it('unmutes when a level is set from the muted state, and shows 0 while muted', async () => {
        settings.mute = true
        const w = mount(Volume)
        expect((w.find('.volume-slider').element as HTMLInputElement).value).toBe('0')
        expect(fill()).toBeCloseTo(0)

        await clickAt(w, 100)

        expect(settings.toggleMute).toHaveBeenCalledTimes(1)
        expect(settings.setVolume).toHaveBeenLastCalledWith(0.5)
    })

    it('keeps the dragged value when the drag ends with a click on the slider', async () => {
        const w = mount(Volume)
        const input = w.find('.volume-slider')
        input.element.dispatchEvent(new MouseEvent('pointerdown', { clientX: 140, bubbles: true }))
        ;(input.element as HTMLInputElement).value = '0'
        await input.trigger('input') // dragged to the left end
        settings.setVolume.mockClear()

        await clickAt(w, 10) // released 130px from where it went down

        expect(settings.setVolume).not.toHaveBeenCalled()
        expect(settings.volume).toBe(0)
    })

    it('still follows a drag (native input value)', async () => {
        const w = mount(Volume)
        const input = w.find('.volume-slider')
        ;(input.element as HTMLInputElement).value = '0.25'
        await input.trigger('input')

        expect(settings.setVolume).toHaveBeenLastCalledWith(0.25)
    })
})
