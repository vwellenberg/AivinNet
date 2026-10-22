import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// NewPlaylist.vue's create() is a priority chain — path → albumhash →
// artisthash → trackhash → is_queue → empty — fed by whatever props the
// opening call site passed through the modal store. Two props set at once, or
// one renamed prop, silently pick the WRONG branch: the user gets an empty
// playlist instead of a filled one, with a success toast on top. These tests
// pin the dispatch table down.

const saveTrackAsPlaylist = vi.fn()
const saveAlbumAsPlaylist = vi.fn()
const saveArtistAsPlaylist = vi.fn()
const saveFolderAsPlaylist = vi.fn()
const createNewPlaylist = vi.fn()

vi.mock('@/requests/playlists', () => ({
    saveTrackAsPlaylist: (...a: any[]) => saveTrackAsPlaylist(...a),
    saveAlbumAsPlaylist: (...a: any[]) => saveAlbumAsPlaylist(...a),
    saveArtistAsPlaylist: (...a: any[]) => saveArtistAsPlaylist(...a),
    saveFolderAsPlaylist: (...a: any[]) => saveFolderAsPlaylist(...a),
    createNewPlaylist: (...a: any[]) => createNewPlaylist(...a),
}))

// The store's list is what the server answers for "all playlists" (`fetchAll`).
let storedList: unknown[] = []
let serverList: unknown[] | null = []
const addPlaylist = vi.fn()
// null = the fetch failed: the store keeps its list and says so (`false`).
const fetchAll = vi.fn(async () => {
    if (!serverList) return false
    storedList.splice(0, storedList.length, ...serverList)
    return true
})
vi.mock('@/stores/pages/playlists', () => ({
    default: () => ({ addPlaylist, fetchAll, playlists: storedList }),
}))

const celebrate = vi.fn()
vi.mock('@/utils/confetti', () => ({
    celebrate: (...a: any[]) => celebrate(...a),
}))

vi.mock('@/stores/queue/tracklist', () => ({
    default: () => ({ tracklist: [{ trackhash: 'q1' }, { trackhash: 'q2' }] }),
}))

const notification = vi.fn()
vi.mock('@/stores/notification', () => ({
    NotifType: { Success: 0, Error: 1, Info: 2 },
    // Called with `new` in the component — an arrow function here throws
    // "is not a constructor" and takes the whole submit handler down with it.
    Notification: function (...a: any[]) {
        notification(...a)
    },
}))

import NewPlaylist from '@/components/modals/NewPlaylist.vue'

const PLAYLIST = { id: 5, name: 'typed name' }
const ALL_SAVERS = [saveTrackAsPlaylist, saveAlbumAsPlaylist, saveArtistAsPlaylist, saveFolderAsPlaylist, createNewPlaylist]

// Unmounted in afterEach — tearing down inside submit() raced the .then that
// emits hideModal, so the emit was never recorded.
let mounted: ReturnType<typeof mount>[] = []

async function submit(props: Record<string, unknown>, name = 'typed name') {
    const wrapper = mount(NewPlaylist, { props, attachTo: document.body })
    mounted.push(wrapper)

    const input = wrapper.find('input').element as HTMLInputElement
    input.value = name

    await wrapper.find('form').trigger('submit')
    // create() chains a .then on the mocked request promise.
    await flushPromises()

    return wrapper
}

afterEach(() => {
    mounted.forEach(w => w.unmount())
    mounted = []
})

beforeEach(() => {
    ALL_SAVERS.forEach(saver => {
        saver.mockReset()
        saver.mockResolvedValue(PLAYLIST)
    })
    addPlaylist.mockClear()
    notification.mockClear()
    celebrate.mockClear()
    serverList = []
    storedList.splice(0)
})

describe('NewPlaylist celebrates the first playlist', () => {
    it('bursts when the server list holds only the new playlist', async () => {
        serverList = [PLAYLIST]
        await submit({})
        expect(celebrate).toHaveBeenCalledTimes(1)
    })

    it('stays quiet when the list already held other playlists', async () => {
        serverList = [{ id: 1, name: 'older' }, PLAYLIST]
        await submit({})
        expect(celebrate).not.toHaveBeenCalled()
    })

    it('stays quiet when the refetch failed and the old list holds one playlist', async () => {
        storedList.splice(0, storedList.length, { id: 1, name: 'older' })
        serverList = null
        await submit({})
        expect(celebrate).not.toHaveBeenCalled()
    })
})

describe('NewPlaylist create() dispatch', () => {
    it('albumhash → saveAlbumAsPlaylist (the "Album → New playlist" path)', async () => {
        const wrapper = await submit({ albumhash: 'ALBUM1' })

        expect(saveAlbumAsPlaylist).toHaveBeenCalledWith('typed name', 'ALBUM1')
        expect(addPlaylist).toHaveBeenCalledWith(PLAYLIST)
        expect(wrapper.emitted('hideModal')).toBeTruthy()
        expect(saveTrackAsPlaylist).not.toHaveBeenCalled()
        expect(createNewPlaylist).not.toHaveBeenCalled()
    })

    it('artisthash → saveArtistAsPlaylist', async () => {
        await submit({ artisthash: 'ARTIST1' })
        expect(saveArtistAsPlaylist).toHaveBeenCalledWith('typed name', 'ARTIST1')
    })

    it('trackhash → saveTrackAsPlaylist', async () => {
        await submit({ trackhash: 'TRACK1' })
        expect(saveTrackAsPlaylist).toHaveBeenCalledWith('typed name', 'TRACK1')
    })

    it('is_queue → saveTrackAsPlaylist with the queue hashes joined', async () => {
        await submit({ is_queue: true })
        expect(saveTrackAsPlaylist).toHaveBeenCalledWith('typed name', 'q1,q2')
    })

    it('no props → createNewPlaylist (empty playlist)', async () => {
        await submit({})
        expect(createNewPlaylist).toHaveBeenCalledWith('typed name')
        ALL_SAVERS.filter(s => s !== createNewPlaylist).forEach(s => expect(s).not.toHaveBeenCalled())
    })

    it('path outranks albumhash — the documented precedence order', async () => {
        await submit({ path: '/music/x', albumhash: 'ALBUM1' })

        expect(saveFolderAsPlaylist).toHaveBeenCalledWith('typed name', '/music/x')
        expect(saveAlbumAsPlaylist).not.toHaveBeenCalled()
    })

    it('an empty name never reaches the network', async () => {
        await submit({ albumhash: 'ALBUM1' }, '   ')

        ALL_SAVERS.forEach(s => expect(s).not.toHaveBeenCalled())
        expect(notification).toHaveBeenCalledWith("Playlist name can't be empty", 1)
    })

    it('a failed save (409 → false) never lands in the playlist store', async () => {
        saveAlbumAsPlaylist.mockResolvedValue(false)

        const wrapper = await submit({ albumhash: 'ALBUM1' })

        expect(addPlaylist).not.toHaveBeenCalled()
        // The modal still closes — the toast from the request layer already
        // told the user what happened.
        expect(wrapper.emitted('hideModal')).toBeTruthy()
    })
})
