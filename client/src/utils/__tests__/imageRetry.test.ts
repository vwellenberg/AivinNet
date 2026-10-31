import { readFileSync } from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { paths } from '@/config'
import { installImageRetry, isRetryableImage, JITTER, RETRY_DELAYS_MS } from '@/utils/imageRetry'

// ---------------------------------------------------------------------------
// A cover that failed once stayed broken until the tab reloaded. The server
// restarts on every backend deploy; a client that loaded its covers in those
// few seconds — measured: a 3 s outage at boot — kept all 75 sidebar covers as
// broken-image icons for good, even with the server long back.
// ---------------------------------------------------------------------------

// From the app's own config, as the components build them (under vitest that
// is the dev server's backend origin, not the page's).
const IMG = paths.images
// Realistic: album thumbnails carry the `?pathhash=` suffix.
const COVER = `${IMG.thumb.small}d51775c990ea70c8.webp?pathhash=fe465f1dc2cc6dee`

function mountImg(src: string) {
    const img = document.createElement('img')
    img.src = src
    document.body.appendChild(img)
    return img
}

function fail(img: HTMLImageElement) {
    img.dispatchEvent(new Event('error'))
}

/** The longest a retry can wait, jitter included. */
const longest = (delay: number) => delay * (1 + JITTER)

describe('isRetryableImage', () => {
    it('covers album, artist and playlist images', () => {
        expect(isRetryableImage(COVER)).toBe(true)
        expect(isRetryableImage(`${IMG.thumb.medium}a.webp`)).toBe(true)
        expect(isRetryableImage(`${IMG.artist.small}a.webp`)).toBe(true)
        expect(isRetryableImage(`${IMG.playlist}35BeLPM.webp`)).toBe(true)
    })

    it('leaves user avatars alone — their 404 is a real answer', () => {
        // api/imgserver.py answers a missing user image with 404 on purpose so
        // Avatar.vue can fall back to the generated one. Retrying would only
        // knock on that door again.
        expect(isRetryableImage(`${IMG.user}1.webp`)).toBe(false)
    })

    it('leaves foreign and bundled images alone', () => {
        expect(isRetryableImage('https://example.com/img/thumbnail/a.webp')).toBe(false)
        expect(isRetryableImage('/assets/logo.svg')).toBe(false)
        expect(isRetryableImage('')).toBe(false)
    })
})

describe('installImageRetry', () => {
    let uninstall: () => void
    let srcSet: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        vi.useFakeTimers()
        uninstall = installImageRetry()
        srcSet = vi.spyOn(HTMLImageElement.prototype, 'src', 'set')
    })

    afterEach(() => {
        uninstall()
        srcSet.mockRestore()
        vi.useRealTimers()
        document.body.innerHTML = ''
    })

    it('loads a failed cover again once the server is back', () => {
        const img = mountImg(COVER)
        srcSet.mockClear()

        fail(img)
        // Never sooner than the first wait…
        vi.advanceTimersByTime(RETRY_DELAYS_MS[0] - 1)
        expect(srcSet).not.toHaveBeenCalled()

        // …and never later than the first wait plus its jitter.
        vi.advanceTimersByTime(longest(RETRY_DELAYS_MS[0]))
        expect(srcSet).toHaveBeenCalledWith(COVER)
    })

    it('backs off, then gives up', () => {
        const img = mountImg(COVER)
        srcSet.mockClear()

        for (const delay of RETRY_DELAYS_MS) {
            fail(img)
            vi.advanceTimersByTime(longest(delay))
        }
        expect(srcSet).toHaveBeenCalledTimes(RETRY_DELAYS_MS.length)

        fail(img)
        vi.advanceTimersByTime(60 * 60_000)
        expect(srcSet).toHaveBeenCalledTimes(RETRY_DELAYS_MS.length)
    })

    it('starts over after a success', () => {
        const img = mountImg(COVER)
        fail(img)
        vi.advanceTimersByTime(longest(RETRY_DELAYS_MS[0]))
        img.dispatchEvent(new Event('load'))
        srcSet.mockClear()

        // The next outage gets the full budget again, starting with the short wait.
        fail(img)
        vi.advanceTimersByTime(longest(RETRY_DELAYS_MS[0]))
        expect(srcSet).toHaveBeenCalledTimes(1)
    })

    it('does not touch an image that moved on or left the page', () => {
        const moved = mountImg(COVER)
        const gone = mountImg(COVER)
        fail(moved)
        fail(gone)

        // Vue re-bound the first one to another cover, and unmounted the second.
        const other = `${IMG.thumb.small}bf76e7a5d3b52f50.webp?pathhash=bf77521f8fe24fb4`
        moved.src = other
        gone.remove()
        srcSet.mockClear()

        vi.advanceTimersByTime(longest(RETRY_DELAYS_MS[0]))
        expect(srcSet).not.toHaveBeenCalled()
    })

    it('tries a spent image again when the user comes back', () => {
        // An outage longer than the budget — laptop asleep, phone off the
        // network — must not bring the permanent broken icon back.
        const img = mountImg(COVER)
        for (const delay of RETRY_DELAYS_MS) {
            fail(img)
            vi.advanceTimersByTime(longest(delay))
        }
        fail(img)
        srcSet.mockClear()

        document.dispatchEvent(new Event('visibilitychange'))
        expect(srcSet).toHaveBeenCalledWith(COVER)

        // With a fresh budget: the next failure is retried again.
        srcSet.mockClear()
        fail(img)
        vi.advanceTimersByTime(longest(RETRY_DELAYS_MS[0]))
        expect(srcSet).toHaveBeenCalledTimes(1)
    })

    it('ignores avatars and other elements', () => {
        const avatar = mountImg(`${IMG.user}1.webp`)
        srcSet.mockClear()
        fail(avatar)
        document.body.dispatchEvent(new Event('error'))

        vi.advanceTimersByTime(60 * 60_000)
        expect(srcSet).not.toHaveBeenCalled()
    })

    it('is installed when the app starts', () => {
        // A unit test of the helper proves nothing if nobody calls it.
        const main = readFileSync('src/main.ts', 'utf8')
            .split('\n')
            .filter(line => !/^\s*(import|\/\/)/.test(line))
            .join('\n')
        expect(main).toMatch(/installImageRetry\s*\(\s*\)/)
    })
})
