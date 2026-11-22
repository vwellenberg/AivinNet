import { describe, expect, it } from 'vitest'

import { swipeDismisses, swipeOpacity } from '@/utils/swipeDismiss'

describe('swipeDismisses', () => {
    it('a slow drag needs a third of the toast', () => {
        expect(swipeDismisses(90, 288, 0)).toBe(false)
        expect(swipeDismisses(101, 288, 0)).toBe(true)
        expect(swipeDismisses(-101, 288, 0)).toBe(true)
    })

    it('never more than 96 px, however wide the toast', () => {
        expect(swipeDismisses(96, 1000, 0)).toBe(true)
        expect(swipeDismisses(95, 1000, 0)).toBe(false)
    })

    it('a flick dismisses early, but not a twitch', () => {
        expect(swipeDismisses(30, 288, 0.8)).toBe(true)
        expect(swipeDismisses(-30, 288, -0.8)).toBe(true)
        expect(swipeDismisses(10, 288, 2)).toBe(false)
        expect(swipeDismisses(30, 288, 0.2)).toBe(false)
    })
})

describe('swipeOpacity', () => {
    it('fades with the travel, but stays visible', () => {
        expect(swipeOpacity(0, 288)).toBe(1)
        expect(swipeOpacity(144, 288)).toBeCloseTo(0.5)
        expect(swipeOpacity(-1000, 288)).toBe(0.2)
        expect(swipeOpacity(50, 0)).toBe(1)
    })
})
