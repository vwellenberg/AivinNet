import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// player.ts instantiates <audio> elements and a heavy import chain at module
// load. retagTrack never calls into it, so stub the module to keep the import
// light in jsdom.
vi.mock('@/stores/player', () => ({
    usePlayer: () => ({ clearNextAudio() {} }),
    audioSource: {},
    getUrl: () => '',
}))
// The playlists store transitively imports the router (heavy view chain) —
// stub it; the sidebar-recency hook only needs movePlayedToTop.
const movePlayedToTop = vi.fn()
vi.mock('@/stores/pages/playlists', () => ({
    default: () => ({ movePlayedToTop }),
}))
// setNewList calls focusCurrentInSidebar — irrelevant here.
vi.mock('@/stores/interface', () => ({
    default: () => ({ focusCurrentInSidebar() {} }),
}))

import { Track } from '@/interfaces'
import useTracklist from '@/stores/queue/tracklist'
import useSettings from '@/stores/settings'

const mk = (over: Partial<any> = {}) =>
    ({
        trackhash: '',
        title: '',
        album: '',
        artists: [] as any[],
        albumartists: [] as any[],
        track: 0,
        ...over,
    } as unknown as Track)

describe('tracklist.retagTrack', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
    })

    it('patches every queue copy matching the old hash and leaves others untouched', () => {
        const tl = useTracklist()
        tl.tracklist = [
            mk({ trackhash: 'OLD', title: 'Old' }),
            mk({ trackhash: 'KEEP', title: 'Keep' }),
            mk({ trackhash: 'OLD', title: 'Old too' }),
        ]

        tl.retagTrack('OLD', mk({ trackhash: 'NEW', title: 'New Title', artists: [{ name: 'A' }] }) as any)

        expect(tl.tracklist[0].trackhash).toBe('NEW')
        expect(tl.tracklist[0].title).toBe('New Title')
        expect(tl.tracklist[2].trackhash).toBe('NEW')
        expect(tl.tracklist[2].title).toBe('New Title')
        // unrelated track untouched
        expect(tl.tracklist[1].trackhash).toBe('KEEP')
        expect(tl.tracklist[1].title).toBe('Keep')
    })

    it('no-ops when no queue track matches', () => {
        const tl = useTracklist()
        tl.tracklist = [mk({ trackhash: 'A', title: 'A' })]

        tl.retagTrack('ZZZ', mk({ trackhash: 'NEW', title: 'X' }) as any)

        expect(tl.tracklist[0].trackhash).toBe('A')
        expect(tl.tracklist[0].title).toBe('A')
    })
})

describe('tracklist.followFileChanges', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
    })

    // The metadata dialog retitles AND renames: afterwards neither the old
    // trackhash nor the old path exists on the server, so a queue that still
    // carries them cannot play a single one of those tracks — every entry
    // 404s and the player skips through the whole queue.
    it('moves a queued track to its new path, hash and tags, matched by the OLD path', () => {
        const tl = useTracklist()
        tl.tracklist = [
            mk({ filepath: '/m/W - Freedom Combat.mp3', trackhash: 'aaaaaaaaaaaaaaaa', title: 'W - Freedom Combat', track: 0 }),
            mk({ filepath: '/m/other.mp3', trackhash: 'bbbbbbbbbbbbbbbb', title: 'Other' }),
        ]

        tl.followFileChanges([
            {
                filepath: '/m/W - Freedom Combat.mp3',
                new_filepath: '/m/38 - Wolf - Freedom Combat.mp3',
                new_trackhash: 'cccccccccccccccc',
                title: 'Wolf - Freedom Combat',
                track: 38,
            },
        ])

        expect(tl.tracklist[0]).toMatchObject({
            filepath: '/m/38 - Wolf - Freedom Combat.mp3',
            trackhash: 'cccccccccccccccc',
            title: 'Wolf - Freedom Combat',
            track: 38,
        })
        expect(tl.tracklist[1]).toMatchObject({ filepath: '/m/other.mp3', trackhash: 'bbbbbbbbbbbbbbbb', title: 'Other' })
    })

    it('matches by path, not by hash: files sharing one hash each keep their own change', () => {
        // An album whose files all said "Track 1" has ONE trackhash for all of
        // them — the very album the dialog exists to repair.
        const tl = useTracklist()
        tl.tracklist = [
            mk({ filepath: '/m/a.mp3', trackhash: 'dddddddddddddddd', title: 'Track 1' }),
            mk({ filepath: '/m/b.mp3', trackhash: 'dddddddddddddddd', title: 'Track 1' }),
        ]

        tl.followFileChanges([
            { filepath: '/m/a.mp3', new_trackhash: '1111111111111111', title: 'Alpha' },
            { filepath: '/m/b.mp3', new_trackhash: '2222222222222222', title: 'Beta' },
        ])

        expect(tl.tracklist.map(t => [t.filepath, t.trackhash, t.title])).toEqual([
            ['/m/a.mp3', '1111111111111111', 'Alpha'],
            ['/m/b.mp3', '2222222222222222', 'Beta'],
        ])
    })

    it('a rename alone moves only the path; the same track twice in the queue both follow', () => {
        const tl = useTracklist()
        const before = { filepath: '/m/old.mp3', trackhash: 'eeeeeeeeeeeeeeee', title: 'Same' }
        tl.tracklist = [mk(before), mk(before)]

        tl.followFileChanges([{ filepath: '/m/old.mp3', new_filepath: '/m/01 - Same.mp3' }])

        for (const t of tl.tracklist) {
            expect(t).toMatchObject({ filepath: '/m/01 - Same.mp3', trackhash: 'eeeeeeeeeeeeeeee', title: 'Same' })
        }
    })
})

describe('tracklist.setFromPlaylist sidebar recency hook', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        movePlayedToTop.mockReset()
    })

    it('bubbles the played playlist when the setting is on (default)', () => {
        const tl = useTracklist()
        tl.setFromPlaylist('My List', 42, [mk({ trackhash: 'A' })])

        expect(movePlayedToTop).toHaveBeenCalledTimes(1)
        expect(movePlayedToTop).toHaveBeenCalledWith(42)
    })

    it('does nothing when the setting is off', () => {
        useSettings().move_played_playlist_to_top = false

        const tl = useTracklist()
        tl.setFromPlaylist('My List', 42, [mk({ trackhash: 'A' })])

        expect(movePlayedToTop).not.toHaveBeenCalled()
    })
})

describe('tracklist.shuffleList', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
    })

    const list = () => ['a', 'b', 'c', 'd', 'e', 'f'].map(h => mk({ trackhash: h, title: h }))

    it('keeps the playing track out of the front row', () => {
        // The queue panel's "Shuffle" restarts playback at index 0, so whatever
        // lands there is what you hear next — and hearing the same song again
        // from 0:00 is the one thing that button must not do.
        const tl = useTracklist()

        for (let i = 0; i < 60; i++) {
            tl.tracklist = list()
            const playingIndex = i % 6
            const playing = tl.tracklist[playingIndex]

            tl.shuffleList(playingIndex)

            expect(tl.tracklist[0].trackhash).not.toBe(playing.trackhash)
        }
    })

    it('keeps every track, just in another order', () => {
        const tl = useTracklist()
        tl.tracklist = list()

        tl.shuffleList(2)

        expect([...tl.tracklist].map(t => t.trackhash).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    })

    it('is a plain shuffle without an index to protect', () => {
        const tl = useTracklist()
        tl.tracklist = list()

        tl.shuffleList()

        expect(tl.tracklist).toHaveLength(6)
    })

    it('leaves a single-track queue alone', () => {
        const tl = useTracklist()
        tl.tracklist = [mk({ trackhash: 'only' })]

        tl.shuffleList(0)

        expect(tl.tracklist[0].trackhash).toBe('only')
    })
})
