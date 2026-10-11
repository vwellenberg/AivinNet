import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import PlayingMeter from '../PlayingMeter.vue'

// The meter asks for levels while it plays, and paints the four bars from
// them. Here the levels are fed by hand: the browser tap is not part of jsdom.

let listener: ((levels: number[] | null) => void) | null = null
const stop = vi.fn()

vi.mock('@/utils/audioLevels', async () => {
    const actual = await vi.importActual<typeof import('@/utils/audioLevels')>('@/utils/audioLevels')
    return {
        ...actual,
        subscribeLevels: (fn: (levels: number[] | null) => void) => {
            listener = fn
            return stop
        },
    }
})

/** The transform each bar was given, read from its style attribute (jsdom does not parse SVG transforms). */
function barStyles(wrapper: ReturnType<typeof mount>) {
    return Array.from(wrapper.findAll('.bar')).map(bar => bar.attributes('style') ?? '')
}

describe('PlayingMeter with live levels', () => {
    it('paints each bar from its band and marks the meter live', () => {
        const wrapper = mount(PlayingMeter)
        listener?.([0.1, 0.9, 0.5, 0])

        expect(wrapper.classes()).toContain('live')
        const styles = barStyles(wrapper)
        expect(styles[0]).toContain('scaleY(0.25)')
        expect(styles[1]).toContain('scaleY(1)')
        expect(styles[2]).toContain('scaleY(0.5)')
        expect(styles[3]).toContain('scaleY(0.25)')
    })

    it('hands the bars back to their own loops when the levels stop', () => {
        const wrapper = mount(PlayingMeter)
        listener?.([0.8, 0.8, 0.8, 0.8])
        listener?.(null)

        expect(wrapper.classes()).not.toContain('live')
        barStyles(wrapper).forEach(style => expect(style).not.toContain('transform'))
    })

    it('stops listening when it pauses, and again when it unmounts', async () => {
        stop.mockClear()
        const wrapper = mount(PlayingMeter)
        // The playing watcher runs on the next tick, so wait for it.
        await wrapper.setProps({ playing: false })
        expect(stop).toHaveBeenCalledTimes(1)

        await wrapper.setProps({ playing: true })
        wrapper.unmount()
        expect(stop).toHaveBeenCalledTimes(2)
    })
})
