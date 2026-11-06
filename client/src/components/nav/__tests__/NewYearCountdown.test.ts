import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { celebrate, celebrateNewYear } = vi.hoisted(() => ({ celebrate: vi.fn(), celebrateNewYear: vi.fn() }))
vi.mock('@/utils/confetti', () => ({ celebrate, celebrateNewYear }))

import NewYearCountdown from '@/components/nav/NewYearCountdown.vue'
import { CELEBRATED_KEY } from '@/utils/newYearCountdown'
import { setSeasonPreview } from '@/utils/seasons'

// The pill ticks once a second on the faked clock. A reload of the page (a new mount)
// reads the remembered year the way a real reload does.
function pill(props: { compact?: boolean } = {}) {
    return mount(NewYearCountdown, { props })
}

// The tab's visibility, as vueuse's useDocumentVisibility reads it.
function setVisibility(state: 'visible' | 'hidden') {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
    document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
    vi.useFakeTimers()
    setVisibility('visible')
})

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    celebrate.mockReset()
    celebrateNewYear.mockReset()
    setSeasonPreview(null)
    localStorage.clear()
})

describe('NewYearCountdown: the pill in the top bar (#674)', () => {
    it('counts the time left as hh:mm:ss, a second at a time, from 18:00', async () => {
        vi.setSystemTime(new Date(2026, 11, 31, 23, 59, 58, 0))
        const w = pill()
        expect(w.text()).toBe('00:00:02')

        vi.advanceTimersByTime(1000)
        await w.vm.$nextTick()
        expect(w.text()).toBe('00:00:01')
    })

    it('shows the clock from 18:00 on, and nothing before', async () => {
        vi.setSystemTime(new Date(2026, 11, 31, 17, 59, 59, 0))
        const w = pill()
        expect(w.find('.newyear-countdown').exists()).toBe(false)

        vi.advanceTimersByTime(1000)
        await w.vm.$nextTick()
        expect(w.text()).toBe('06:00:00')
    })

    it('fires the confetti once when the page is open across midnight, and says Happy New Year', async () => {
        vi.setSystemTime(new Date(2026, 11, 31, 23, 59, 59, 0))
        const w = pill()
        expect(celebrateNewYear).not.toHaveBeenCalled()

        vi.advanceTimersByTime(1000)
        await w.vm.$nextTick()
        expect(celebrateNewYear).toHaveBeenCalledTimes(1)
        expect(localStorage.getItem(CELEBRATED_KEY)).toBe('2027')
        expect(w.text()).toBe('Happy New Year 🎉')

        // Ticking on through the first hour does not fire it again.
        vi.advanceTimersByTime(5000)
        await w.vm.$nextTick()
        expect(celebrateNewYear).toHaveBeenCalledTimes(1)
    })

    it('does not fire the confetti again for a year it already fired for', async () => {
        localStorage.setItem(CELEBRATED_KEY, '2027')
        vi.setSystemTime(new Date(2026, 11, 31, 23, 59, 59, 0))
        pill()
        vi.advanceTimersByTime(1000)
        expect(celebrateNewYear).not.toHaveBeenCalled()
    })

    it('still fires only once when storage is blocked: the mount remembers it on its own', async () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked')
        })
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('blocked')
        })
        vi.setSystemTime(new Date(2026, 11, 31, 23, 59, 59, 0))
        const w = pill()
        vi.advanceTimersByTime(1000)
        await w.vm.$nextTick()
        vi.advanceTimersByTime(5000)
        await w.vm.$nextTick()
        expect(celebrateNewYear).toHaveBeenCalledTimes(1)
    })

    it('fires on 1 January at 14:00 with nothing remembered: on the first tick after mount, not the synchronous one', async () => {
        vi.setSystemTime(new Date(2027, 0, 1, 14, 0, 0, 0))
        const w = pill()
        // The mount's own tick is synchronous, before the page is painted: no burst there.
        expect(celebrateNewYear).not.toHaveBeenCalled()

        vi.advanceTimersByTime(1000)
        await w.vm.$nextTick()
        expect(celebrateNewYear).toHaveBeenCalledTimes(1)
        expect(localStorage.getItem(CELEBRATED_KEY)).toBe('2027')
    })

    it('does not fire again on a remount the same day, once the year is remembered', async () => {
        vi.setSystemTime(new Date(2027, 0, 1, 14, 0, 0, 0))
        const first = pill()
        vi.advanceTimersByTime(1000)
        await first.vm.$nextTick()
        first.unmount()
        expect(celebrateNewYear).toHaveBeenCalledTimes(1)

        vi.setSystemTime(new Date(2027, 0, 1, 14, 30, 0, 0))
        pill()
        vi.advanceTimersByTime(5000)
        expect(celebrateNewYear).toHaveBeenCalledTimes(1)
    })

    it('does not fire in the Appearance preview, and does not remember the year', async () => {
        setSeasonPreview('newyear')
        vi.setSystemTime(new Date(2027, 0, 1, 14, 0, 0, 0))
        const w = pill()
        vi.advanceTimersByTime(2000)
        await w.vm.$nextTick()
        expect(celebrateNewYear).not.toHaveBeenCalled()
        expect(localStorage.getItem(CELEBRATED_KEY)).toBeNull()
    })

    it('goes away after the first hour of 1 January', async () => {
        vi.setSystemTime(new Date(2027, 0, 1, 0, 59, 59, 0))
        const w = pill()
        expect(w.find('.newyear-countdown').exists()).toBe(true)

        vi.advanceTimersByTime(1000)
        await w.vm.$nextTick()
        expect(w.find('.newyear-countdown').exists()).toBe(false)
    })

    it('counts to the next midnight in a preview, on any day', async () => {
        setSeasonPreview('newyear')
        vi.setSystemTime(new Date(2026, 5, 15, 12, 0, 0, 0))
        const w = pill()
        expect(w.text()).toBe('12:00:00')
        expect(celebrateNewYear).not.toHaveBeenCalled()
    })

    it('stops ticking while the tab is hidden, and catches up the moment it is visible', async () => {
        vi.setSystemTime(new Date(2026, 11, 31, 20, 0, 0, 0))
        const w = pill()
        expect(w.text()).toBe('04:00:00')

        setVisibility('hidden')
        await w.vm.$nextTick()
        vi.advanceTimersByTime(3000)
        await w.vm.$nextTick()
        expect(w.text()).toBe('04:00:00')

        setVisibility('visible')
        await w.vm.$nextTick()
        expect(w.text()).toBe('03:59:57')
    })

    it('runs one interval, and clears it when the pill goes', () => {
        vi.setSystemTime(new Date(2026, 11, 31, 20, 0, 0, 0))
        const before = vi.getTimerCount()
        const w = pill()
        expect(vi.getTimerCount()).toBe(before + 1)
        w.unmount()
        expect(vi.getTimerCount()).toBe(before)
    })

    // "Happy New Year 🎉" pushed the avatar past the edge of a 390 px phone.
    it('says just "🎉 2027" in the compact (phone) form', async () => {
        vi.setSystemTime(new Date(2027, 0, 1, 0, 10, 0, 0))
        const w = pill({ compact: true })
        await w.vm.$nextTick()
        expect(w.text()).toBe('🎉 2027')
    })
})
