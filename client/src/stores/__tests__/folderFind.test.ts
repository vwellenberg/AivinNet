/**
 * The folder page's find searches every track in the folder, not only the
 * pages the infinite scroll has loaded so far (the same contract as the
 * playlist's find, see playlist.test.ts).
 */

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getFilesMock } = vi.hoisted(() => ({ getFilesMock: vi.fn() }))

vi.mock('@/requests/folders', () => ({ getFiles: getFilesMock }))
vi.mock('@/stores/content-width', () => ({ track_limit: { value: 50 } }))
vi.mock('@/router', () => ({
    router: { currentRoute: { value: { name: 'other' } } },
    Routes: { folder: 'folder' },
}))

import useFolder from '../pages/folder'

const FOLDER = '/music/albums'
const ALL = Array.from({ length: 120 }, (_, i) => ({
    filepath: `${FOLDER}/${i + 1}.mp3`,
    title: `Track ${i + 1}`,
    album: 'Live Sesh',
    artists: [],
    albumartists: [],
    duration: 100,
    trackhash: `h${i + 1}`,
}))

// Stands in for the server: `limit -1` means "everything from `start` on".
// Any other folder is empty: the test can tell the two apart by their tracks.
function serve(path: string, start: number, limit: number) {
    if (path !== FOLDER) return Promise.resolve({ tracks: [], folders: [], path, total: 0 })
    const end = limit === -1 ? ALL.length : start + limit
    return Promise.resolve({ tracks: ALL.slice(start, end), folders: [], path, total: ALL.length })
}

async function loadFirstPage() {
    const folder = useFolder()
    await folder.fetchAll(FOLDER, true)
    expect(folder.allTracks).toHaveLength(50)
    expect(folder.trackTotal).toBe(120)
    return folder
}

describe('folder find', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        getFilesMock.mockReset()
        getFilesMock.mockImplementation(serve)
    })

    it('finds a track that is not on the loaded pages yet', async () => {
        const folder = await loadFirstPage()

        await folder.setQuery('Track 117')

        // The rest of the folder was asked for, from where the loaded pages end.
        expect(getFilesMock).toHaveBeenLastCalledWith(FOLDER, 50, -1, true, expect.any(Object))
        expect(folder.allTracks).toHaveLength(120)
        expect(folder.tracks.map(t => t.title)).toContain('Track 117')
    })

    it('loads the rest once, however many letters are typed while it runs', async () => {
        const folder = await loadFirstPage()
        let release: () => void = () => {}
        const gate = new Promise<void>(resolve => (release = resolve))
        getFilesMock.mockImplementationOnce(async (...args: [string, number, number]) => {
            await gate
            return serve(...args)
        })

        const typing = [folder.setQuery('T'), folder.setQuery('Tr'), folder.setQuery('Tra')]
        release()
        await Promise.all(typing)

        // One first page + one load of the rest.
        expect(getFilesMock).toHaveBeenCalledTimes(2)
        expect(folder.query).toBe('Tra')
        expect(folder.allTracks).toHaveLength(120)
    })

    it('a failed load neither rejects nor blocks the next try', async () => {
        const folder = await loadFirstPage()

        getFilesMock.mockRejectedValueOnce(new Error('offline'))
        await expect(folder.setQuery('Track')).resolves.toBeUndefined()
        expect(folder.allTracks).toHaveLength(50)

        await folder.setQuery('Track 2')
        expect(folder.allTracks).toHaveLength(120)
    })

    it('a load still running for the old folder does not append into the new one', async () => {
        const folder = await loadFirstPage()
        let release: () => void = () => {}
        const gate = new Promise<void>(resolve => (release = resolve))
        getFilesMock.mockImplementationOnce(async (...args: [string, number, number]) => {
            await gate
            return serve(...args)
        })

        const searching = folder.setQuery('Track')
        await folder.fetchAll('/music/other', true)
        release()
        await searching

        expect(folder.path).toBe('/music/other')
        expect(folder.allTracks).toHaveLength(0)
    })

    it('switching folder clears the query', async () => {
        const folder = await loadFirstPage()
        folder.query = 'Track 3'

        await folder.fetchAll('/music/other', true)

        expect(folder.query).toBe('')
    })
})

describe('folder find, page and search racing', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        getFilesMock.mockReset()
        getFilesMock.mockImplementation(serve)
    })

    it('a scroll page that lands after the search loaded the rest does not double its tracks', async () => {
        const folder = await loadFirstPage()

        // The sentinel asks for page 50..100 and that answer is held back…
        let releasePage = () => {}
        getFilesMock.mockImplementationOnce(
            (path: string, start: number, limit: number) =>
                new Promise(resolve => (releasePage = () => resolve(serve(path, start, limit))))
        )
        const page = folder.fetchAll(FOLDER)

        // …while the search loads everything from 50 on, first.
        await folder.setQuery('Track')
        expect(folder.allTracks).toHaveLength(120)

        releasePage()
        await page
        expect(folder.allTracks).toHaveLength(120)
        expect(new Set(folder.allTracks.map(t => t.filepath)).size).toBe(120)
    })
})
