import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import brandColors from '@/brand-colors.json'

import type { RewindPayload } from '../rewind'
import { STORY_HEIGHT, STORY_WIDTH, storyFilename } from '../rewindStory'
import { canShareImage, loadCover, readPalette, renderStory, saveBlob, shareImage } from '../rewindStoryImage'

// As GET /logger/rewind sends it (#527), with the artist's cover as the server names it.
const payload = {
    year: 2026,
    years: [2026],
    plays: 4567,
    seconds: 740_700,
    days: 241,
    top_artists: [{ name: 'Red Hot Chili Peppers', artisthash: 'ar1', image: 'ar1.webp', seconds: 38 * 3600 }],
    top_albums: [],
    top_tracks: [
        { title: 'Blue', trackhash: 't1', artists: [{ name: 'The Artist', artisthash: 'ar3' }], seconds: 3 * 3600 + 300, plays: 12 },
    ],
    summer_track: { track: { title: 'Summer', trackhash: 't2', artists: [{ name: 'Primus', artisthash: 'ar2' }] }, plays: 9 },
    first_track: null,
    busiest_day: null,
    new_artists: 0,
    new_artists_top: [],
    listener: { kind: 'album', share: 0.62 },
    time_of_day: null,
} as unknown as RewindPayload

// The colours the live palette sets on <html> (#395): deliberately not the Memphis literals.
const PALETTE: Record<string, string> = {
    '--mem-paper': '#fafafa',
    '--mem-ink': '#111111',
    '--mem-lavender': '#aabbff',
    '--mem-yellow': '#ffee00',
    '--app-font': '"Test Sans", sans-serif',
}

// jsdom has no image decoder: an Image that loads (or fails, or never answers) on demand.
class FakeImage {
    static fail = false
    static hang = false
    static last: FakeImage | null = null
    naturalWidth = 300
    naturalHeight = 300
    crossOrigin: string | null = null
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    private current = ''

    get src() {
        return this.current
    }

    set src(value: string) {
        this.current = value
        FakeImage.last = this
        queueMicrotask(() => {
            if (FakeImage.hang) return
            if (FakeImage.fail) this.onerror?.()
            else this.onload?.()
        })
    }
}

type Ctx = ReturnType<typeof fakeContext>

function fakeContext() {
    const ctx = {
        font: '',
        fillStyle: '' as string,
        textBaseline: '',
        textAlign: '',
        fillRect: vi.fn(),
        fillText: vi.fn(),
        drawImage: vi.fn(),
        measureText: vi.fn((text: string) => ({ width: [...text].length * 10 })),
    }
    return ctx
}

let ctx: Ctx
let drawn: { text: string; fill: string; font: string }[]
let bands: { fill: string }[]
let getContext: ReturnType<typeof vi.spyOn>
const toBlobBefore = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'toBlob')

function setPalette(values: Record<string, string> = PALETTE) {
    vi.spyOn(globalThis, 'getComputedStyle').mockImplementation(
        () => ({ getPropertyValue: (p: string) => values[p] ?? '' }) as unknown as CSSStyleDeclaration
    )
}

beforeEach(() => {
    ctx = fakeContext()
    drawn = []
    bands = []
    // Record what each draw call paints, with the colour and font in force at that moment.
    ctx.fillText = vi.fn((text: string) => drawn.push({ text, fill: ctx.fillStyle, font: ctx.font }))
    ctx.fillRect = vi.fn(() => bands.push({ fill: ctx.fillStyle }))
    getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
    Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
        configurable: true,
        writable: true,
        value(this: HTMLCanvasElement, cb: (blob: Blob | null) => void) {
            cb(new Blob(['png'], { type: 'image/png' }))
        },
    })
    vi.stubGlobal('Image', FakeImage)
    FakeImage.fail = false
    FakeImage.hang = false
    FakeImage.last = null
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } })
    setPalette()
})

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    delete (document as { fonts?: unknown }).fonts
    if (toBlobBefore) Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', toBlobBefore)
    else delete (HTMLCanvasElement.prototype as { toBlob?: unknown }).toBlob
})

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

describe('readPalette', () => {
    it('reads each role from the computed style, not from the Memphis literals', () => {
        const style = { getPropertyValue: (p: string) => PALETTE[p] ?? '' } as unknown as CSSStyleDeclaration
        expect(readPalette(style)).toEqual({ ink: '#111111', paper: '#fafafa', lavender: '#aabbff', yellow: '#ffee00' })
        expect(readPalette(style).ink).not.toBe(brandColors.memphis.ink)
    })

    it('trims the value the stylesheet gives', () => {
        const style = { getPropertyValue: () => '  #123456 ' } as unknown as CSSStyleDeclaration
        expect(readPalette(style).paper).toBe('#123456')
    })

    it('falls back to the Memphis literal only where no stylesheet sets the property', () => {
        const style = { getPropertyValue: () => '' } as unknown as CSSStyleDeclaration
        expect(readPalette(style)).toEqual({
            ink: brandColors.memphis.ink,
            paper: brandColors.memphis.paper,
            lavender: brandColors.memphis.lavender,
            yellow: brandColors.memphis.yellow,
        })
    })
})

describe('renderStory', () => {
    it('waits for the fonts before it measures or draws anything', async () => {
        let ready!: () => void
        Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: new Promise<void>(r => (ready = r)) } })

        const pending = renderStory(payload)
        await tick()
        expect(getContext).not.toHaveBeenCalled()
        expect(ctx.fillText).not.toHaveBeenCalled()

        ready()
        await pending
        expect(ctx.fillText).toHaveBeenCalled()
    })

    it('paints the card at the story size and returns a PNG', async () => {
        const blob = await renderStory(payload)
        expect(blob.type).toBe('image/png')
        // The full ground, first: the card is 1080 x 1920 whatever the page is.
        expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, STORY_WIDTH, STORY_HEIGHT)
    })

    it('paints with the palette read from the page and the app font', async () => {
        await renderStory(payload)
        expect(bands.map(b => b.fill)).toEqual(['#fafafa', '#aabbff', '#ffee00'])
        const year = drawn.find(d => d.text === '2026')
        expect(year).toEqual({ text: '2026', fill: '#111111', font: '900 260px "Test Sans", sans-serif' })
    })

    it('draws the year, the minutes, the artist and the track', async () => {
        await renderStory(payload)
        const words = drawn.map(d => d.text)
        expect(words).toEqual(expect.arrayContaining(['2026', '12,345', 'Red Hot Chili Peppers', 'Blue — The Artist', 'The album listener']))
    })

    it('loads the top artist cover from the server and draws it square', async () => {
        await renderStory(payload)
        expect(FakeImage.last?.crossOrigin).toBe('anonymous')
        expect(FakeImage.last?.src).toMatch(/\/img\/artist\/medium\/ar1\.webp$/)
        expect(ctx.drawImage).toHaveBeenCalledWith(FakeImage.last, 0, 0, 300, 300, 96, 760, 260, 260)
    })

    it('draws the card without the cover when the cover fails, and still says everything else', async () => {
        FakeImage.fail = true
        await renderStory(payload)
        expect(ctx.drawImage).not.toHaveBeenCalled()
        const words = drawn.map(d => d.text)
        expect(words).toContain('Red Hot Chili Peppers')
        expect(words).toContain('12,345')
    })

    it('does not hold the card for a cover that never answers', async () => {
        vi.useFakeTimers()
        FakeImage.hang = true
        const pending = renderStory(payload)
        await vi.advanceTimersByTimeAsync(5000)
        const blob = await pending
        expect(blob.type).toBe('image/png')
        expect(ctx.drawImage).not.toHaveBeenCalled()
    })

    it('draws no cover at all for a year without a top artist image', async () => {
        const noImage = { ...payload, top_artists: [{ name: 'Primus', artisthash: 'ar2', seconds: 3600 }] } as unknown as RewindPayload
        await renderStory(noImage)
        expect(FakeImage.last).toBeNull()
        expect(ctx.drawImage).not.toHaveBeenCalled()
    })

    it('rejects when the browser has no 2D canvas', async () => {
        getContext.mockReturnValue(null)
        await expect(renderStory(payload)).rejects.toThrow('2D canvas')
    })

    it('rejects when the PNG cannot be encoded', async () => {
        Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
            configurable: true,
            writable: true,
            value(this: HTMLCanvasElement, cb: (blob: Blob | null) => void) {
                cb(null)
            },
        })
        await expect(renderStory(payload)).rejects.toThrow('PNG encoding failed')
    })
})

describe('loadCover', () => {
    it('resolves to the image once it loads', async () => {
        const img = await loadCover('/img/artist/medium/ar1.webp')
        expect(img).toBe(FakeImage.last)
    })

    it('resolves to null when the image fails', async () => {
        FakeImage.fail = true
        expect(await loadCover('/img/artist/medium/missing.webp')).toBeNull()
    })

    it('resolves to null after the timeout when the image never answers', async () => {
        vi.useFakeTimers()
        FakeImage.hang = true
        const pending = loadCover('/img/artist/medium/slow.webp', 1000)
        await vi.advanceTimersByTimeAsync(1000)
        expect(await pending).toBeNull()
    })
})

describe('saving', () => {
    it('names the download after the year and clicks a link to the PNG once', () => {
        const clicks: { download: string; href: string }[] = []
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
            clicks.push({ download: this.download, href: this.href })
        })
        URL.createObjectURL = vi.fn(() => 'blob:rewind-2026')
        URL.revokeObjectURL = vi.fn()

        saveBlob(new Blob(['png']), storyFilename(2026))

        expect(clicks).toEqual([{ download: 'aivinnet-rewind-2026.png', href: 'blob:rewind-2026' }])
        expect(document.querySelector('a[download]')).toBeNull()
    })

    it('frees the object URL after the download has had time to start', () => {
        vi.useFakeTimers()
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
        URL.createObjectURL = vi.fn(() => 'blob:rewind-2026')
        URL.revokeObjectURL = vi.fn()

        saveBlob(new Blob(['png']), storyFilename(2026))
        expect(URL.revokeObjectURL).not.toHaveBeenCalled()
        vi.advanceTimersByTime(10_000)
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:rewind-2026')
    })

    it('offers sharing only where the browser can share a PNG file', () => {
        expect(canShareImage()).toBe(false)

        Object.defineProperty(navigator, 'share', { configurable: true, value: vi.fn() })
        Object.defineProperty(navigator, 'canShare', { configurable: true, value: vi.fn(() => true) })
        expect(canShareImage()).toBe(true)

        Object.defineProperty(navigator, 'canShare', {
            configurable: true,
            value: vi.fn(() => {
                throw new TypeError('not supported')
            }),
        })
        expect(canShareImage()).toBe(false)

        delete (navigator as { share?: unknown }).share
        delete (navigator as { canShare?: unknown }).canShare
    })

    it('hands the PNG to the share sheet under its file name', async () => {
        const share = vi.fn(async (_data: { files: File[]; title: string }) => {})
        Object.defineProperty(navigator, 'share', { configurable: true, value: share })

        await shareImage(new Blob(['png'], { type: 'image/png' }), storyFilename(2026), 'AivinNet Rewind 2026')

        const arg = share.mock.calls[0][0] as { files: File[]; title: string }
        expect(arg.title).toBe('AivinNet Rewind 2026')
        expect(arg.files[0].name).toBe('aivinnet-rewind-2026.png')
        expect(arg.files[0].type).toBe('image/png')

        delete (navigator as { share?: unknown }).share
    })
})
