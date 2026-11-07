import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// A new source the user starts leaves repeat-one. The tracklist and queue
// stores are real; the device sync, player and the rest are stubbed, as in
// queueShuffle.test.ts. `dsMock` is reactive so each case flips `joined` and
// `applying` the way the real store does.
const { dsMock } = vi.hoisted(() => ({
    dsMock: { joined: false, applying: false, intercept: vi.fn() },
}))

vi.mock('@/stores/devicesync', async () => {
    const { reactive } = await import('vue')
    const state = reactive(dsMock)
    return { default: () => state }
})
vi.mock('@/stores/player', () => ({
    audioSource: {
        playingSource: { src: '', currentTime: 0 },
        pausePlayingSource: vi.fn(),
        playPlayingSource: vi.fn(),
    },
    getUrl: () => '',
    usePlayer: () => ({
        playCurrent: vi.fn(),
        clearNextAudio: vi.fn(),
        clearMovingNextTimeout: vi.fn(),
        loadedTrackhash: () => '',
    }),
}))
vi.mock('@/stores/interface', () => ({ default: () => ({ focusCurrentInSidebar: vi.fn() }) }))
vi.mock('@/stores/notification', () => ({
    NotifType: { Success: 0, Error: 1, Info: 2 },
    useToast: () => ({ showNotification: vi.fn() }),
}))
vi.mock('@/stores/pages/playlists', () => ({ default: () => ({ movePlayedToTop: vi.fn() }) }))
vi.mock('@/helpers/mediaNotification', () => ({ default: vi.fn() }))
vi.mock('@/requests/favorite', () => ({ isFavorite: () => Promise.resolve(false) }))
vi.mock('@/router', () => ({
    router: { currentRoute: { value: { name: 'other' } } },
    Routes: { Lyrics: 'Lyrics' },
}))

import useSettings from '@/stores/settings'
import useTracklist from '@/stores/queue/tracklist'

const track = (i: number, folder = '/music/a') =>
    ({ trackhash: `h${i}`, filepath: `${folder}/${i}.mp3`, folder, title: `t${i}`, album: 'A' }) as any

const tracks = () => [track(0), track(1), track(2)]

// Every way the user starts a new source. Each entry runs one `setFromX`.
const SOURCES: [string, (t: ReturnType<typeof useTracklist>) => void][] = [
    ['setFromFolder', t => t.setFromFolder('/music/a', tracks())],
    ['setFromAlbum', t => t.setFromAlbum('A', 'alb1', tracks())],
    ['setFromPlaylist', t => t.setFromPlaylist('P', 7, tracks())],
    ['setFromPlaylistFolder', t => t.setFromPlaylistFolder('F', 3, tracks())],
    ['setFromSearch', t => t.setFromSearch('q', tracks())],
    ['setFromArtist', t => t.setFromArtist('art1', 'Artist', tracks())],
    ['setFromFav', t => t.setFromFav(tracks())],
    ['setFromSmartPlaylist', t => t.setFromSmartPlaylist('S', 9, tracks())],
]

beforeEach(() => {
    setActivePinia(createPinia())
    dsMock.joined = false
    dsMock.applying = false
    dsMock.intercept.mockClear()
})

describe('a new source leaves repeat-one', () => {
    it.each(SOURCES)('%s switches repeat one back to all', (_name, start) => {
        const settings = useSettings()
        settings.repeat = 'one'

        start(useTracklist())

        expect(settings.repeat).toBe('all')
    })

    it.each(SOURCES)('%s leaves repeat all alone', (_name, start) => {
        const settings = useSettings()
        settings.repeat = 'all'

        start(useTracklist())

        expect(settings.repeat).toBe('all')
        expect(dsMock.intercept).not.toHaveBeenCalled()
    })

    it.each(SOURCES)('%s leaves repeat none alone', (_name, start) => {
        const settings = useSettings()
        settings.repeat = 'none'

        start(useTracklist())

        expect(settings.repeat).toBe('none')
    })

    it.each(SOURCES)('%s does not touch shuffle', (_name, start) => {
        const settings = useSettings()
        settings.repeat = 'one'
        settings.shuffle = true

        start(useTracklist())

        expect(settings.shuffle).toBe(true)
    })

    it('goes through the group when joined, so the others follow', () => {
        const settings = useSettings()
        settings.repeat = 'one'
        dsMock.joined = true

        useTracklist().setFromAlbum('A', 'alb1', tracks())

        expect(dsMock.intercept).toHaveBeenCalledWith('toggleRepeat', 'all')
        // Repeat is shared state: it changes when the command comes back, not here.
        expect(settings.repeat).toBe('one')
    })

    it('does not reset while the device is mirroring another device', () => {
        const settings = useSettings()
        settings.repeat = 'one'
        dsMock.joined = true
        dsMock.applying = true

        useTracklist().setFromAlbum('A', 'alb1', tracks())

        expect(settings.repeat).toBe('one')
        expect(dsMock.intercept).not.toHaveBeenCalled()
    })

    it('does not reset when a mirrored list is swapped in with setNewList', () => {
        const settings = useSettings()
        settings.repeat = 'one'

        useTracklist().setNewList(tracks())

        expect(settings.repeat).toBe('one')
    })

    it('does not reset on add-to-queue', () => {
        const settings = useSettings()
        settings.repeat = 'one'
        const tl = useTracklist()
        tl.setNewList(tracks())

        tl.addTracks([track(9)])

        expect(settings.repeat).toBe('one')
    })

    it('does not reset on insert (play next)', () => {
        const settings = useSettings()
        settings.repeat = 'one'
        const tl = useTracklist()
        tl.setNewList(tracks())

        tl.insertAt([track(9)], 1)

        expect(settings.repeat).toBe('one')
    })
})
