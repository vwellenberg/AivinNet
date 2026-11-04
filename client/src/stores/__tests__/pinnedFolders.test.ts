import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getPinnedFolders = vi.fn()
const reorderPinnedFolders = vi.fn()
const pinUnpinFolder = vi.fn()
const showNotification = vi.fn()

vi.mock('@/requests/folders', () => ({
    getPinnedFolders: (...args: any[]) => getPinnedFolders(...args),
    reorderPinnedFolders: (...args: any[]) => reorderPinnedFolders(...args),
    pinUnpinFolder: (...args: any[]) => pinUnpinFolder(...args),
}))
vi.mock('@/stores/notification', () => ({
    NotifType: { Error: 'error' },
    useToast: () => ({ showNotification }),
}))

import { toggleFolderPin } from '@/helpers/pinFolder'
import usePinnedFolders, { folderKey } from '@/stores/pages/pinnedFolders'

// What GET /folder/pinned answers: resolved, POSIX, one trailing slash.
const pin = (name: string, over: Partial<any> = {}) => ({
    name,
    path: `/music/${name}/`,
    trackcount: 12,
    is_sym: false,
    position: null,
    ...over,
})

beforeEach(() => {
    setActivePinia(createPinia())
    getPinnedFolders.mockReset()
    reorderPinnedFolders.mockReset()
    pinUnpinFolder.mockReset()
    showNotification.mockReset()
})

describe('folderKey', () => {
    it('reads every spelling the client holds as one folder', () => {
        const key = folderKey('/music/Rock/')
        expect(folderKey('/music/Rock')).toBe(key)
        expect(folderKey('/music/Rock//')).toBe(key)
        expect(folderKey('C:\\Music\\Rock\\')).toBe('C:/Music/Rock')
    })

    it('does not make a parent of a sibling', () => {
        expect(folderKey('/music/Rock and Roll/')).not.toBe(folderKey('/music/Rock'))
    })
})

describe('pinnedFolders store', () => {
    it('knows a pin under the breadcrumb and the folder-card spelling', () => {
        const store = usePinnedFolders()
        store.folders = [pin('Rock')]

        expect(store.isPinned('/music/Rock')).toBe(true)
        expect(store.isPinned('/music/Rock/')).toBe(true)
        expect(store.isPinned('/music/Rock and Roll')).toBe(false)
    })

    it('orders explicit positions first, then by name', () => {
        const store = usePinnedFolders()
        store.folders = [pin('Zydeco'), pin('Jazz'), pin('Rock', { position: 3 }), pin('Ambient', { position: 1 })]

        expect(store.sortedFolders.map(f => f.name)).toEqual(['Ambient', 'Rock', 'Jazz', 'Zydeco'])
    })

    it('marks an empty answer as loaded', async () => {
        getPinnedFolders.mockResolvedValue([])
        const store = usePinnedFolders()

        expect(store.loaded).toBe(false)
        await store.fetchAll()
        expect(store.loaded).toBe(true)
    })

    it('does not take a failed read for "nothing pinned"', async () => {
        getPinnedFolders.mockResolvedValue(null)
        const store = usePinnedFolders()

        await store.fetchAll()

        expect(store.loaded).toBe(false)
    })

    it('applies a reorder locally and persists it', async () => {
        const store = usePinnedFolders()
        store.folders = [pin('Rock'), pin('Jazz')]

        await store.reorderTopLevel([{ path: '/music/Jazz/', position: 0 }])

        expect(store.folders.find(f => f.name === 'Jazz')?.position).toBe(0)
        expect(reorderPinnedFolders).toHaveBeenCalledWith([{ path: '/music/Jazz/', position: 0 }])
    })
})

describe('toggleFolderPin', () => {
    it('reads a fresh pin back from the server (name, count, stored spelling)', async () => {
        pinUnpinFolder.mockResolvedValue({ pinned: true, path: '/music/Rock/' })
        getPinnedFolders.mockResolvedValue([pin('Rock')])

        expect(await toggleFolderPin('/music/Rock')).toBe(true)

        expect(pinUnpinFolder).toHaveBeenCalledWith('/music/Rock')
        expect(usePinnedFolders().folders).toEqual([pin('Rock')])
    })

    it('drops an unpinned folder under the path the server answered', async () => {
        const store = usePinnedFolders()
        // A symlinked folder: the client knows the link, the server the target.
        store.folders = [pin('Rock', { path: '/srv/rock/' }), pin('Jazz')]
        pinUnpinFolder.mockResolvedValue({ pinned: false, path: '/srv/rock/' })

        await toggleFolderPin('/music/Rock')

        expect(store.folders.map(f => f.name)).toEqual(['Jazz'])
        expect(getPinnedFolders).not.toHaveBeenCalled()
    })

    it('says so when the server refuses, and changes nothing', async () => {
        const store = usePinnedFolders()
        store.folders = [pin('Jazz')]
        pinUnpinFolder.mockResolvedValue(null)

        expect(await toggleFolderPin('/etc')).toBe(false)

        expect(showNotification).toHaveBeenCalledTimes(1)
        expect(store.folders).toEqual([pin('Jazz')])
    })
})
