import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/requests/stats', () => ({ getLibraryStats: vi.fn() }))

// StatItem counts its numbers up on mount; the tiles are checked for what they
// are given, so a plain stand-in shows the props as text.
vi.mock('@/components/Stats/StatItem.vue', async () => {
    const { defineComponent, h } = await import('vue')
    return {
        default: defineComponent({
            props: {
                value: { type: String, default: '' },
                text: { type: String, default: '' },
                icon: { type: String, default: '' },
                detail: { type: String, default: '' },
            },
            render() {
                return h('div', { class: 'tile' }, `${this.value}|${this.text}|${this.detail ?? ''}`)
            },
        }),
    }
})

import LibraryTiles from '@/components/Stats/LibraryTiles.vue'
import { getLibraryStats } from '@/requests/stats'

// As GET /logger/library sends it (#536).
function payload(over: Partial<Record<string, unknown>> = {}) {
    return {
        explored: {
            tracks: { heard: 34, total: 100, share: 0.34 },
            albums: { heard: 5, total: 12, share: 5 / 12 },
        },
        nonstop_seconds: 23 * 86400 + 4000,
        files: 120,
        formats: [
            { format: 'FLAC', files: 54, share: 0.45 },
            { format: 'MP3', files: 48, share: 0.4 },
        ],
        mean_bitrate: 320,
        hires: { files: 6, share: 0.05 },
        ...over,
    }
}

const answer = (data: unknown, status = 200) => ({ status, data }) as any

const tiles = (wrapper: { findAll: (s: string) => { text: () => string }[] }) => wrapper.findAll('.tile').map(t => t.text())

describe('LibraryTiles', () => {
    it('shows the explored share, the nonstop length, the top format, the bitrate and the hi-res share', async () => {
        vi.mocked(getLibraryStats).mockResolvedValue(answer(payload()))

        const wrapper = mount(LibraryTiles)
        await flushPromises()

        expect(tiles(wrapper)).toEqual([
            '34 %|of your tracks heard|34 of 100 tracks · 42 % of albums heard',
            '23 days|nonstop, the whole library|every track of the library once, one after another',
            'FLAC 45 %|your top format|FLAC 45 % · MP3 40 %',
            '320 kbps|mean bitrate|',
            '5 %|hi-res files|6 of 120 files above 48 kHz or 16 bit',
        ])
    })

    it('shows a dash for a bitrate and a share it cannot know', async () => {
        vi.mocked(getLibraryStats).mockResolvedValue(
            answer(
                payload({
                    explored: {
                        tracks: { heard: 0, total: 0, share: null },
                        albums: { heard: 0, total: 0, share: null },
                    },
                    files: 1,
                    formats: [{ format: 'MP3', files: 1, share: 1 }],
                    mean_bitrate: null,
                    hires: { files: 0, share: 0 },
                })
            )
        )

        const wrapper = mount(LibraryTiles)
        await flushPromises()

        const texts = tiles(wrapper)
        expect(texts[0]).toContain('—|of your tracks heard')
        expect(texts[3]).toBe('—|mean bitrate|')
    })

    it('is not shown for an empty library', async () => {
        vi.mocked(getLibraryStats).mockResolvedValue(answer(payload({ files: 0, formats: [] })))

        const wrapper = mount(LibraryTiles)
        await flushPromises()

        expect(wrapper.find('.library-tiles').exists()).toBe(false)
    })

    it('is not shown when the server does not answer 200', async () => {
        vi.mocked(getLibraryStats).mockResolvedValue(answer({}, 500))

        const wrapper = mount(LibraryTiles)
        await flushPromises()

        expect(wrapper.find('.library-tiles').exists()).toBe(false)
    })
})
