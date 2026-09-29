import { describe, expect, it, vi } from 'vitest'

// The window is small (900 px) on a 2560 px screen: the row must still be
// fetched for the screen, or dragging the window wider leaves it short.
vi.mock('@vueuse/core', () => ({
    useWindowSize: () => ({ width: { value: 900 }, height: { value: 700 } }),
}))

describe('fetchCardCount', () => {
    it('is sized for the screen, not the current window, and capped', async () => {
        vi.stubGlobal('window', { screen: { width: 2560 } })
        vi.resetModules()
        const { fetchCardCount, maxAbumCards } = await import('../content-width')

        expect(fetchCardCount.value).toBeGreaterThan(maxAbumCards.value)
        expect(fetchCardCount.value).toBe(Math.ceil(2560 / 192))
    })

    it('never asks for fewer than the window needs', async () => {
        vi.stubGlobal('window', { screen: { width: 0 } })
        vi.resetModules()
        const { fetchCardCount, maxAbumCards } = await import('../content-width')

        expect(fetchCardCount.value).toBe(maxAbumCards.value)
    })
})
