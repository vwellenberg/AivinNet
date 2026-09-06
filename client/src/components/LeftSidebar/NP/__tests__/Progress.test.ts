import { DOMWrapper, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The seek bar only needs the playhead and a seek() from the queue store;
// mounting the real one would drag in the player, device sync and requests.
const queue = reactive({
    duration: { current: 0, full: 200 },
    currenttrackhash: 'abc123',
    seek: vi.fn(),
})

vi.mock('@/stores/queue', () => ({ default: () => queue }))
vi.mock('@/stores/player', () => ({ maxSeekPercent: { value: 100 } }))
vi.mock('@/utils/colortools/pageGradient', () => ({
    MEMPHIS: { teal: '#2fbfa3', yellow: '#F5B23C', blush: '#f5c6ce', blushSoft: '#fbe3e7' },
}))

import Progress from '@/components/LeftSidebar/NP/Progress.vue'

// One drag step. Written by hand instead of `setValue()`: on a range input that
// helper leaves the component's @input handler reading the OLD value, so the
// assertions would pass or fail for reasons that have nothing to do with the
// component. A real browser sets the value before dispatching `input`.
async function dragTo(input: DOMWrapper<Element>, value: string) {
    ;(input.element as HTMLInputElement).value = value
    await input.trigger('input')
}

const valueOf = (input: DOMWrapper<Element>) => (input.element as HTMLInputElement).value

describe('seek bar scrubbing', () => {
    beforeEach(() => {
        queue.duration.current = 40
        queue.duration.full = 200
        queue.seek.mockReset()
    })

    it('shows the playhead while nothing is being dragged', () => {
        const w = mount(Progress)
        expect(valueOf(w.find('#progress'))).toBe('40')
    })

    it('does not seek on every drag step — only when the drag ends', async () => {
        const w = mount(Progress)
        const input = w.find('#progress')

        await dragTo(input, '120')
        expect(queue.seek).not.toHaveBeenCalled()

        await input.trigger('change')
        expect(queue.seek).toHaveBeenCalledWith(120)
    })

    it('keeps the dragged position while the playhead moves under it', async () => {
        // The regression: the input's value is bound to the playhead, which
        // ticks several times a second, so mid-drag re-renders used to yank the
        // knob back — on touch that read as "the knob will not move".
        const w = mount(Progress)
        const input = w.find('#progress')

        await dragTo(input, '120')
        queue.duration.current = 41
        await w.vm.$nextTick()

        expect(valueOf(input)).toBe('120')
    })

    it('paints the fill at the dragged position, not the playhead', async () => {
        const w = mount(Progress)
        await dragTo(w.find('#progress'), '100')

        // 100 of 200 seconds -> the fill (and its sprinkle overlay) sit at 50%.
        expect(w.find('.progress-wrap').attributes('style')).toContain('--texture-frac: 0.5')
    })

    it('follows the playhead again once the drag is released', async () => {
        const w = mount(Progress)
        const input = w.find('#progress')

        await dragTo(input, '120')
        await input.trigger('change')

        queue.duration.current = 130
        await w.vm.$nextTick()
        expect(valueOf(input)).toBe('130')
    })
})

describe('seek bar hover preview', () => {
    // jsdom lays nothing out, so the component would measure a zero-width bar
    // and bail out of the hover path entirely. Give it a 200px track starting
    // at the wrapper's left edge; then a pixel is a half percent.
    const BAR = { left: 0, top: 0, width: 200, height: 10 }
    const realRect = Element.prototype.getBoundingClientRect

    // jsdom's CSS parser drops a multi-layer `background` shorthand on the
    // floor — reading it back off the element returns ''. Capture what the
    // component writes instead, which is the thing under test anyway.
    let lastBg = ''
    const realBg = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, 'background')

    beforeEach(() => {
        queue.duration.current = 40 // playhead at 20%
        queue.duration.full = 200
        lastBg = ''
        Element.prototype.getBoundingClientRect = () =>
            ({ ...BAR, right: BAR.width, bottom: BAR.height, x: 0, y: 0 } as DOMRect)
        Object.defineProperty(CSSStyleDeclaration.prototype, 'background', {
            configurable: true,
            get: () => lastBg,
            set: (v: string) => {
                lastBg = v
            },
        })
    })

    // Put the prototypes back: a patched getBoundingClientRect or background
    // left lying around is exactly the kind of cross-test bleed that is hard to
    // trace later.
    afterEach(() => {
        Element.prototype.getBoundingClientRect = realRect
        if (realBg) Object.defineProperty(CSSStyleDeclaration.prototype, 'background', realBg)
    })

    // The span is a background layer on the input, placed with hard colour
    // stops: `transparent <from>%, YELLOW <from>%, YELLOW <to>%, transparent`.
    // Its edges are sub-pixel floats, so read the stops back as numbers.
    const span = () => {
        const stops = [...lastBg.matchAll(/#F5B23C ([\d.]+)%/gi)].map(m => Number(m[1]))
        return stops.length === 2 ? { from: stops[0], to: stops[1] } : null
    }
    const textureFrac = (w: ReturnType<typeof mount>) =>
        Number(
            /--texture-frac: ([\d.]+)/.exec(w.find('.progress-wrap').attributes('style') ?? '')?.[1] ??
                NaN
        )

    const hoverAt = (w: ReturnType<typeof mount>, clientX: number) =>
        w.find('.progress-wrap').trigger('pointermove', { pointerType: 'mouse', clientX })

    it('paints only the stretch between the playhead and the cursor', async () => {
        const w = mount(Progress)

        // Cursor at 70% with the playhead at 20% -> the span runs 20%..70%.
        // Painting from zero would bury the played fill under the preview.
        await hoverAt(w, 140)
        expect(span()?.from).toBeCloseTo(20)
        expect(span()?.to).toBeCloseTo(70)
    })

    it('paints backwards when the cursor is behind the playhead', async () => {
        const w = mount(Progress)

        // Cursor at 5%, playhead at 20% -> the span is the 15% being given up.
        await hoverAt(w, 10)
        expect(span()?.from).toBeCloseTo(5)
        expect(span()?.to).toBeCloseTo(20)
    })

    it('keeps up with the playhead while the pointer holds still', async () => {
        const w = mount(Progress)
        await hoverAt(w, 140)

        queue.duration.current = 60 // playhead moves on to 30%
        await w.vm.$nextTick()

        // The span shrinks from its left edge instead of drifting: a geometry
        // measured once on pointermove would still claim to start at 20%.
        expect(span()?.from).toBeCloseTo(30)
        expect(span()?.to).toBeCloseTo(70)
    })

    it('paints nothing while the bar is not hovered', () => {
        mount(Progress)
        expect(span()).toBeNull()
    })

    it('carries the sprinkle texture across the span, not just the played fill', async () => {
        const w = mount(Progress)

        // Ahead of the playhead the texture has to reach the cursor, otherwise
        // the yellow reads as a flat patch pasted onto a patterned bar.
        await hoverAt(w, 140)
        expect(textureFrac(w)).toBeCloseTo(0.7)

        // Behind it the span sits inside the played fill, which is already
        // textured — the texture stays at the playhead.
        await hoverAt(w, 10)
        expect(textureFrac(w)).toBeCloseTo(0.2)
    })

    it('puts the tooltip on the cursor, not on the span', async () => {
        const w = mount(Progress)
        await hoverAt(w, 140)

        const left = /left: ([\d.]+)px/.exec(
            w.find('.progress-tooltip').attributes('style') ?? ''
        )?.[1]
        expect(Number(left)).toBeCloseTo(140)
        expect(w.find('.progress-tooltip').text()).toBe('02:20') // 70% of 200s
    })
})
