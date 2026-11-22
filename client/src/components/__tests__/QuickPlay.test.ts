import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import type { Track } from '@/interfaces'

const m = vi.hoisted(() => ({
    play: vi.fn(),
    playTrackNext: vi.fn(),
    setFromSearch: vi.fn(),
    searchTracks: vi.fn(),
}))

vi.mock('@/stores/queue', () => ({ default: () => ({ play: m.play, playTrackNext: m.playTrackNext }) }))
vi.mock('@/stores/queue/tracklist', () => ({ default: () => ({ setFromSearch: m.setFromSearch }) }))
vi.mock('@/requests/searchMusic', () => ({ searchTracks: m.searchTracks }))

import QuickPlay from '../QuickPlay.vue'
import { closeQuickPlay, openQuickPlay, open } from '@/stores/quickPlay'

const track = (title: string) =>
    ({
        title,
        trackhash: `hash-${title}`,
        album: 'Album',
        artists: [{ name: 'Artist' }],
    }) as unknown as Track

describe('QuickPlay component', () => {
    let wrapper: VueWrapper | null = null

    beforeEach(() => {
        vi.useFakeTimers()
        m.searchTracks.mockReset()
        m.play.mockReset()
        m.playTrackNext.mockReset()
        m.setFromSearch.mockReset()
    })

    afterEach(() => {
        wrapper?.unmount()
        wrapper = null
        document.body.innerHTML = ''
        closeQuickPlay()
        vi.useRealTimers()
    })

    const input = () => document.querySelector<HTMLInputElement>('.qp-input')!

    async function typeText(text: string) {
        input().value = text
        input().dispatchEvent(new Event('input'))
        await nextTick()
        await vi.advanceTimersByTimeAsync(150)
    }

    it('is closed until opened, then focuses its input', async () => {
        wrapper = mount(QuickPlay, { attachTo: document.body })
        expect(input()).toBeNull()

        openQuickPlay()
        await nextTick()
        await nextTick()
        expect(open.value).toBe(true)
        expect(document.activeElement).toBe(input())
    })

    it('searches as you type and Enter plays the best match with the search queue', async () => {
        const blue = track('Blue Monday')
        m.searchTracks.mockResolvedValue({ results: [blue, track('Blue Velvet')], more: false })

        wrapper = mount(QuickPlay, { attachTo: document.body })
        openQuickPlay()
        await nextTick()

        await typeText('blue')
        // Silent: no app-wide busy cursor on every pause in typing.
        expect(m.searchTracks).toHaveBeenCalledWith('blue', 0, true)
        await vi.runAllTimersAsync()

        input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await vi.runAllTimersAsync()

        expect(m.setFromSearch).toHaveBeenCalledWith('blue', expect.arrayContaining([blue]))
        expect(m.play).toHaveBeenCalledWith(0)
        expect(open.value).toBe(false)
    })

    it('Escape closes the box', async () => {
        wrapper = mount(QuickPlay, { attachTo: document.body })
        openQuickPlay()
        await nextTick()
        input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        await nextTick()
        expect(open.value).toBe(false)
        expect(m.play).not.toHaveBeenCalled()
    })

    it('Tab keeps the focus inside the box', async () => {
        // Out of the box, Space would toggle playback behind the backdrop.
        wrapper = mount(QuickPlay, { attachTo: document.body })
        openQuickPlay()
        await nextTick()
        const e = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
        input().dispatchEvent(e)
        expect(e.defaultPrevented).toBe(true)
        expect(document.querySelector('.qp-panel')?.getAttribute('aria-modal')).toBe('true')
    })

    it('Ctrl/Cmd+P inside the open box keeps the browser from printing', async () => {
        // The box stops its keys from reaching the global handler, which is the
        // one place that suppressed the print dialog.
        wrapper = mount(QuickPlay, { attachTo: document.body })
        openQuickPlay()
        await nextTick()
        for (const mod of [{ ctrlKey: true }, { metaKey: true }]) {
            const e = new KeyboardEvent('keydown', { key: 'p', bubbles: true, cancelable: true, ...mod })
            input().dispatchEvent(e)
            expect(e.defaultPrevented).toBe(true)
        }
        expect(open.value).toBe(true)
    })
})
