import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The toast is the part every user sees, so it is the part under test; the
// burst goes through the real confetti helper, which decides for itself
// whether "less motion" lets it fly.
const { showSuccess } = vi.hoisted(() => ({ showSuccess: vi.fn() }))
vi.mock('@/stores/notification', () => ({ useToast: () => ({ showSuccess }) }))

import { celebrateMilestone, milestoneText } from '@/utils/milestones'

function setReducedMotion(reduce: boolean) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: reduce && query === '(prefers-reduced-motion: reduce)',
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
    })) as any
}

beforeEach(() => {
    showSuccess.mockClear()
    document.body.innerHTML = '<div class="b-bar" style="position:absolute;left:0;top:500px;width:800px;height:80px"></div>'
})

afterEach(() => {
    document.body.innerHTML = ''
})

describe('milestoneText — the toast (#545)', () => {
    it('names the play with its number and its track', () => {
        expect(milestoneText({ number: 10_000, track: 'Blue' })).toBe('Play #10,000: Blue')
    })

    it('reads the 1,337th play as the number, not as a word', () => {
        expect(milestoneText({ number: 1_337, track: 'Leet' })).toBe('Play #1,337: Leet')
    })

    it('still says something when the track has left the library', () => {
        expect(milestoneText({ number: 1_000, track: null })).toBe('Play #1,000: Unknown track')
    })
})

describe('celebrateMilestone', () => {
    it('shows the toast and bursts shapes over the player bar', () => {
        setReducedMotion(false)

        celebrateMilestone({ number: 1_000, track: 'Blue' })

        expect(showSuccess).toHaveBeenCalledWith('Play #1,000: Blue')
        const layer = document.querySelector('.confetti-layer')
        expect(layer).not.toBeNull()
        expect(layer?.querySelectorAll('.confetti-piece').length).toBe(40)
    })

    it('under reduced motion only the toast is left: no shapes at all', () => {
        setReducedMotion(true)

        celebrateMilestone({ number: 100_000, track: 'Blue' })

        expect(showSuccess).toHaveBeenCalledWith('Play #100,000: Blue')
        expect(document.querySelector('.confetti-layer')).toBeNull()
    })
})
