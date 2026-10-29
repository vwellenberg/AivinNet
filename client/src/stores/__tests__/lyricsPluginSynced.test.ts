import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The finder can now answer with PLAIN lyrics (LRCLIB has many songs without
// time tags). Those come back as lines without times and `synced: false`;
// `setLyrics` used to force `synced = true`, so the page would have tried to
// follow strings as if they were timed lines.
const { queueState, findLyrics } = vi.hoisted(() => ({
    queueState: {
        duration: { current: 0, full: 200 },
        playing: true,
        currenttrackhash: 'abc123',
        currenttrack: {
            title: 'Stretch (My Friends B',
            artists: [{ name: 'Red Hot Chili Peppers' }],
            filepath: '/music/rhcp/stretch.mp3',
            album: 'B-Side-Tracks',
            trackhash: 'abc123',
        },
    },
    findLyrics: vi.fn(),
}))

vi.mock('@/stores/queue', () => ({ default: () => queueState }))
vi.mock('@/requests/plugins/lyrics', () => ({ findLyrics }))
vi.mock('@/stores/settings', () => ({
    default: () => ({ lyrics_plugin_settings: { auto_download: false, overide_unsynced: false } }),
}))
vi.mock('@/requests/lyrics', () => ({ checkExists: vi.fn(), getLyrics: vi.fn() }))
vi.mock('@/router', () => ({
    router: { currentRoute: { value: { name: 'other' } } },
    Routes: { Lyrics: 'Lyrics' },
}))

import useLyrics from '@/stores/lyrics'
import useLyricsPlugin from '@/stores/plugins/lyrics'

async function search(answer: object) {
    findLyrics.mockResolvedValueOnce(answer)
    useLyricsPlugin().searchLyrics()
    await vi.waitFor(() => expect(useLyricsPlugin().loading).toBe(false))
    return useLyrics()
}

describe('lyrics plugin: synced or not, as the server says', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        vi.useFakeTimers({ toFake: ['setTimeout'] })
    })

    it('keeps plain lyrics unsynced', async () => {
        const lyrics = await search({ trackhash: 'abc123', lyrics: ['Hello there', 'Second line'], synced: false })

        expect(lyrics.synced).toBe(false)
        expect(lyrics.lyrics).toEqual(['Hello there', 'Second line'])
    })

    it('keeps timed lyrics synced', async () => {
        const lyrics = await search({ trackhash: 'abc123', lyrics: [{ time: 12340, text: 'Hello' }], synced: true })

        expect(lyrics.synced).toBe(true)
    })

    it('treats an answer without the flag as synced (an older server only sent those)', async () => {
        const lyrics = await search({ trackhash: 'abc123', lyrics: [{ time: 12340, text: 'Hello' }] })

        expect(lyrics.synced).toBe(true)
    })
})
