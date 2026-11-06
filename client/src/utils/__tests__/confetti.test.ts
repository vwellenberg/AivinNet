import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { celebrate, celebrateNewYear } from '@/utils/confetti'

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
    it('flies out of a given point, or the middle of the screen without one', () => {
        celebrate(3, { x: 420.4, y: 96.6 })
        const placed = Array.from(document.querySelectorAll<HTMLElement>('.confetti-piece'))
        expect(placed.map(p => [p.style.left, p.style.top])).toEqual(Array(3).fill(['420px', '97px']))

        document.body.innerHTML = ''
        celebrate(2)
        // The stylesheet's 50% / 40% then.
        expect(document.querySelector<HTMLElement>('.confetti-piece')?.style.left).toBe('')
    })

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

describe('celebrateNewYear: the shower of 1 January', () => {
    const layers = () => document.querySelectorAll('.confetti-layer').length

    it('makes several layers over time: a wave every 600 ms, each one alive for its lifetime', () => {
        celebrateNewYear()
        expect(layers()).toBe(1)

        // Waves at 0, 600 and 1200 ms; the first one is gone at 1000 ms.
        vi.advanceTimersByTime(1200)
        expect(layers()).toBe(2)
    })

    it('stops after the last wave: no layer left and no timer pending', () => {
        celebrateNewYear()
        vi.advanceTimersByTime(3500)

        expect(layers()).toBe(0)
        expect(vi.getTimerCount()).toBe(0)
    })

    it('flies the waves from varied points in the upper part of the screen', () => {
        celebrateNewYear()
        const origins = new Set<string>()
        for (let wave = 0; wave < 5; wave++) {
            if (wave > 0) vi.advanceTimersByTime(600)
            // The newest layer is the wave that has just gone up.
            const layer = document.querySelectorAll<HTMLElement>('.confetti-layer')[layers() - 1]
            const piece = layer.querySelector<HTMLElement>('.confetti-piece')!
            origins.add(`${piece.style.left}|${piece.style.top}`)
            expect(parseInt(piece.style.top, 10)).toBeLessThanOrEqual(window.innerHeight * 0.4)
        }
        expect(origins.size).toBeGreaterThan(1)
    })

    it('makes nothing and schedules nothing under reduced motion', () => {
        window.matchMedia = vi.fn(() => ({ matches: true })) as any

        celebrateNewYear()

        expect(layers()).toBe(0)
        expect(vi.getTimerCount()).toBe(0)
    })
})

