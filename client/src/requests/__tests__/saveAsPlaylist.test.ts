import { beforeEach, describe, expect, it, vi } from 'vitest'

// The four save*AsPlaylist wrappers all hit POST /playlists/save-item, and the
// server dispatches on the itemtype LITERAL — 'tracks' (plural!) for
// tracks/queue but 'album'/'folder'/'artist' (singular). A renamed literal
// would not error: the server's else-branch returns "No tracks found" and the
// playlist is silently never created. This is the contract the save-item 500
// (AivinNet#82) was found behind; these tests pin it down client-side.

const useAxiosMock = vi.fn()
vi.mock('@/requests/useAxios', () => ({
    default: (...args: any[]) => useAxiosMock(...args),
}))

const showNotification = vi.fn()
vi.mock('@/stores/notification', () => ({
    NotifType: { Success: 0, Error: 1, Info: 2 },
    Notification: vi.fn(),
    useToast: () => ({ showNotification }),
}))

vi.mock('@/stores/pages/folder', () => ({
    default: () => ({ trackSortBy: 'default', trackSortReverse: false }),
}))
vi.mock('@/utils/recentPlaylists', () => ({ recordRecentPlaylist: vi.fn() }))

import {
    saveAlbumAsPlaylist,
    saveArtistAsPlaylist,
    saveFolderAsPlaylist,
    saveTrackAsPlaylist,
} from '@/requests/playlists'

const PLAYLIST = { id: 9, name: 'new-pl' }

beforeEach(() => {
    useAxiosMock.mockReset()
    showNotification.mockClear()
})

const wrappers = [
    {
        name: 'saveTrackAsPlaylist',
        call: () => saveTrackAsPlaylist('new-pl', 'HASH1,HASH2'),
        itemtype: 'tracks',
        itemhash: 'HASH1,HASH2',
    },
    {
        name: 'saveAlbumAsPlaylist',
        call: () => saveAlbumAsPlaylist('new-pl', 'ALBUMHASH'),
        itemtype: 'album',
        itemhash: 'ALBUMHASH',
    },
    {
        name: 'saveArtistAsPlaylist',
        call: () => saveArtistAsPlaylist('new-pl', 'ARTISTHASH'),
        itemtype: 'artist',
        itemhash: 'ARTISTHASH',
    },
    {
        name: 'saveFolderAsPlaylist',
        call: () => saveFolderAsPlaylist('new-pl', '/music/albums'),
        itemtype: 'folder',
        itemhash: '/music/albums',
    },
]

describe.each(wrappers)('$name', ({ call, itemtype, itemhash }) => {
    it(`sends itemtype '${itemtype}' to /save-item`, async () => {
        useAxiosMock.mockResolvedValue({ data: { playlist: PLAYLIST }, status: 201 })

        const res = await call()

        expect(useAxiosMock).toHaveBeenCalledTimes(1)
        const arg = useAxiosMock.mock.calls[0][0]
        expect(arg.url).toContain('/save-item')
        expect(arg.props.itemtype).toBe(itemtype)
        expect(arg.props.itemhash).toBe(itemhash)
        expect(arg.props.playlist_name).toBe('new-pl')
        expect(res).toEqual(PLAYLIST)
    })

    it('returns false on 409 so the modal keeps its state', async () => {
        // NewPlaylist.vue only calls store.addPlaylist(res) when res is truthy —
        // a 409 ("already exists") must come back as false, not as a Playlist.
        useAxiosMock.mockResolvedValue({ data: { error: 'exists' }, status: 409 })

        expect(await call()).toBe(false)
        expect(showNotification).toHaveBeenCalledWith('Playlist already exists!', 1)
    })

    it('returns false on a server error', async () => {
        useAxiosMock.mockResolvedValue({ data: { error: 'boom' }, status: 500 })

        expect(await call()).toBe(false)
        expect(showNotification).toHaveBeenCalledWith('Something went wrong!', 1)
    })
})

describe('saveFolderAsPlaylist sort options', () => {
    it('carries the folder view sort so the playlist keeps the visible order', async () => {
        useAxiosMock.mockResolvedValue({ data: { playlist: PLAYLIST }, status: 201 })

        await saveFolderAsPlaylist('new-pl', '/music/albums')

        expect(useAxiosMock.mock.calls[0][0].props.sortoptions).toEqual({
            tracksortby: 'default',
            tracksortreverse: false,
        })
    })
})
