import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { celebrate } from '@/utils/confetti'

// The burst is a layer that appears once and is gone after its lifetime. The
// movement is CSS (Global/confetti.scss), so these tests check what is made
// and aimed, not how it moves.

beforeEach(() => {
    vi.useFakeTimers()
    document.body.innerHTML = ''
    window.matchMedia = vi.fn(() => ({ matches: false })) as any
})

afterEach(() => {
    vi.useRealTimers()
})

describe('celebrate', () => {
    it('bursts once: a layer of pieces that is gone after its lifetime', () => {
        celebrate(12)

        const layer = document.querySelector('.confetti-layer')
        expect(layer).not.toBeNull()
        expect(layer?.querySelectorAll('.confetti-piece')).toHaveLength(12)
        expect(layer?.getAttribute('aria-hidden')).toBe('true')

        vi.advanceTimersByTime(1100)
        expect(document.querySelector('.confetti-layer')).toBeNull()
    })

    it('aims every piece on its own, with its own spin', () => {
        celebrate(8)

        const pieces = Array.from(document.querySelectorAll<HTMLElement>('.confetti-piece'))
        expect(new Set(pieces.map(p => p.style.getPropertyValue('--x'))).size).toBeGreaterThan(1)
        for (const piece of pieces) {
            expect(piece.style.getPropertyValue('--r')).toMatch(/deg$/)
            expect(piece.style.getPropertyValue('--y')).toMatch(/px$/)
        }
    })

    it('mixes three shapes, so the burst does not read as one shape repeated', () => {
        celebrate(9)

        const shapes = new Set(
            Array.from(document.querySelectorAll('.confetti-piece')).map(p =>
                ['square', 'circle', 'triangle'].find(s => p.classList.contains(`confetti-${s}`))
            )
        )
        expect(shapes.size).toBe(3)
    })

    it('makes nothing under reduced motion', () => {
        window.matchMedia = vi.fn(() => ({ matches: true })) as any

        celebrate()

        expect(document.querySelector('.confetti-layer')).toBeNull()
    })
})
