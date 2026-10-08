import { beforeEach, describe, expect, it, vi } from 'vitest'

// The placeholder cover is an ink glyph on a transparent tile (#395). Read as a
// cover, node-vibrant skips the clear pixels and finds only the glyph — a
// near-black page gradient behind every album without artwork. So when the
// server marks the image as its placeholder: no colours, the extractor does not
// even run, and the store says so (`colors.placeholder`, read by the album head).

const clear = vi.fn<[string], Promise<boolean>>()
vi.mock('../placeholderCover', () => ({ coverIsPlaceholder: (url: string) => clear(url) }))

const vibrantCalls: string[] = []
vi.mock('node-vibrant', () => ({
    default: class {
        constructor(url: string) {
            vibrantCalls.push(url)
        }
        getPalette() {
            // A dark blue cover, as node-vibrant reports it.
            const swatch = (rgb: number[], pop: number) => ({ getRgb: () => rgb, rgb, population: pop, getPopulation: () => pop, getHsl: () => [0.6, 0.6, 0.3] })
            return Promise.resolve({ Vibrant: swatch([40, 90, 160], 900), DarkVibrant: swatch([20, 45, 80], 300) })
        }
    },
}))

const { default: setColorsToStore } = await import('../setColorsToStore')

const flush = () => new Promise((r) => setTimeout(r, 0))
const freshStore = () => ({ colors: { bg: '#123456', bg2: '#123456', btn: 'rgb(1,2,3)', placeholder: false } }) as any

describe('setColorsToStore and the placeholder cover', () => {
    beforeEach(() => {
        clear.mockReset()
        vibrantCalls.length = 0
    })

    it('the placeholder clears the colours, says so, and skips the extractor', async () => {
        clear.mockResolvedValue(true)
        const store = freshStore()
        setColorsToStore(store, '/img/thumbnail/large/x.webp')
        await flush()
        expect(store.colors).toEqual({ bg: '', bg2: '', btn: '', placeholder: true })
        expect(vibrantCalls).toEqual([])
    })

    it('btn_only clears just the button colour', async () => {
        clear.mockResolvedValue(true)
        const store = freshStore()
        setColorsToStore(store, '/img/artist/x.webp', true)
        await flush()
        expect(store.colors).toEqual({ bg: '#123456', bg2: '#123456', btn: '', placeholder: true })
    })

    it('a real cover still goes through the extractor', async () => {
        clear.mockResolvedValue(false)
        const store = freshStore()
        setColorsToStore(store, '/img/thumbnail/large/real.webp')
        await flush()
        await flush()
        expect(vibrantCalls).toEqual(['/img/thumbnail/large/real.webp'])
        expect(store.colors.btn).not.toBe('')
        expect(store.colors.placeholder).toBe(false)
    })

    it('a newer call wins over a slower placeholder check', async () => {
        let release!: (v: boolean) => void
        clear.mockReturnValueOnce(new Promise((r) => (release = r))).mockResolvedValueOnce(false)
        const store = freshStore()
        setColorsToStore(store, '/img/thumbnail/large/first.webp')
        setColorsToStore(store, '/img/thumbnail/large/second.webp')
        release(true)
        await flush()
        await flush()
        // The first (placeholder) answer arrived late and must not wipe the second.
        expect(store.colors.btn).not.toBe('')
        expect(store.colors.placeholder).toBe(false)
        expect(vibrantCalls).toEqual(['/img/thumbnail/large/second.webp'])
    })
})
