import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { settings } = vi.hoisted(() => ({
    settings: { volume: 0.8, use_crossfade: true },
}))
vi.mock('@/stores/settings', () => ({ default: () => settings }))
vi.mock('../../../stores/settings', () => ({ default: () => settings }))

import { cancelFade, crossFade, releaseSource } from '@/utils/audio/crossFade'

function playingElement(src = 'http://host/file/a/legacy?filepath=a.flac') {
    const audio = new Audio()
    audio.src = src
    return audio
}

beforeEach(() => {
    vi.useFakeTimers()
    // jsdom implements neither.
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
})

describe('releaseSource', () => {
    // `src = ""` resolves to the page URL: Firefox requested `/`, got
    // index.html and logged "Content-Type text/html is not supported".
    it('removes the source instead of pointing it at the page', () => {
        const audio = playingElement()

        releaseSource(audio)

        expect(audio.hasAttribute('src')).toBe(false)
        expect(audio.src).toBe('')
        expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled()
        expect(HTMLMediaElement.prototype.load).toHaveBeenCalled()
    })
})

describe('crossFade', () => {
    it('a fade-out with then_destroy releases the element at its end', () => {
        const audio = playingElement()

        crossFade({ audio, duration: 1000, start_volume: 0.8, then_destroy: true })
        vi.advanceTimersByTime(1200)

        expect(audio.hasAttribute('src')).toBe(false)
    })

    // A quick second skip hands the element that is still fading out back to
    // the player. The old fade must neither keep turning it down nor unload
    // the new track at its end.
    it('a cancelled fade-out does not touch the element any more', () => {
        const audio = playingElement()
        crossFade({ audio, duration: 3000, start_volume: 0.8, then_destroy: true })
        vi.advanceTimersByTime(500)

        expect(cancelFade(audio)).toBe(true)
        audio.src = 'http://host/file/b/legacy?filepath=b.flac'
        audio.volume = 0.8
        vi.advanceTimersByTime(5000)

        expect(audio.getAttribute('src')).toBe('http://host/file/b/legacy?filepath=b.flac')
        expect(audio.volume).toBeCloseTo(0.8, 6)
    })

    it('a new fade on the same element replaces the running one', () => {
        const audio = playingElement()
        crossFade({ audio, duration: 3000, start_volume: 0.8, then_destroy: true })
        vi.advanceTimersByTime(500)

        // The fade-in the player starts for the new track on this element.
        audio.src = 'http://host/file/b/legacy?filepath=b.flac'
        crossFade({ audio, duration: 1000, start_volume: 0 })
        vi.advanceTimersByTime(5000)

        expect(audio.hasAttribute('src')).toBe(true)
        expect(audio.volume).toBeCloseTo(0.8, 6)
    })

    it('cancelFade without a running fade reports false', () => {
        expect(cancelFade(playingElement())).toBe(false)
    })
})
