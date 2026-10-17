import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// #299: a write that partly fails. The dialog used to close on a toast saying
// "91 updated, 3 failed" — which files, and why, the admin had to find out by
// running the preview again. Now it stays on the preview and lists them; what
// went through is done, what failed stays ticked for the next attempt.
// ---------------------------------------------------------------------------

const { requests, fetchTracksAndArtists } = vi.hoisted(() => ({
    fetchTracksAndArtists: vi.fn(),
    requests: {
        fetchPreview: vi.fn(),
        fetchReleaseCandidates: vi.fn(),
        applyChanges: vi.fn(),
    },
}))

vi.mock('@/requests/metadata', () => requests)
vi.mock('@/stores/pages/album', () => ({ default: () => ({ fetchTracksAndArtists }) }))
vi.mock('@/stores/queue/tracklist', () => ({ default: () => ({ followFileChanges: vi.fn() }) }))
const { Notification } = vi.hoisted(() => ({ Notification: vi.fn() }))
vi.mock('@/stores/notification', () => ({ Notification, NotifType: {} }))

import FetchMetadata from '@/components/modals/FetchMetadata.vue'

const NIGHT = '/music/Game OST/68. Night Woods1.mp3'
const GAME_WON = '/music/Game OST/02. Game Won.mp3'

const side = (filepath: string, title: string, track: number) => ({
    trackhash: 'h',
    filepath,
    title,
    track,
    disc: 1,
    duration: 100,
})

const preview = {
    rows: [
        {
            current: side(NIGHT, '68', 1),
            proposed: { title: 'Night Woods1', track: 68, disc: null, duration: 100 },
            delta: null,
            confident: false,
            filename: { current: '68. Night Woods1.mp3', proposed: '68 - Night Woods1.mp3', status: 'rename' },
        },
        {
            current: side(GAME_WON, '02', 1),
            proposed: { title: 'Game Won', track: 2, disc: null, duration: 100 },
            delta: null,
            confident: false,
            filename: { current: '02. Game Won.mp3', proposed: '02 - Game Won.mp3', status: 'rename' },
        },
    ],
    summary: { matched: 2, confident: 0, unmatched_local: 0, unmatched_remote: 0, ordered_by_filepath: false },
}

async function openAndWrite(answer: { result: unknown; error: string | null }) {
    requests.fetchPreview.mockResolvedValue({ result: structuredClone(preview), error: null })
    requests.applyChanges.mockResolvedValueOnce(answer)
    const w = mount(FetchMetadata, { props: { albumhash: 'a', albumTitle: 'Game OST' } })
    await w.findAll('button.source')[1].trigger('click') // "Tags from the file names"
    await flushPromises()
    await w.find('button.apply').trigger('click')
    await flushPromises()
    return w
}

const sent = () => (requests.applyChanges.mock.calls.at(-1) as any)[0]
const writableRows = (w: ReturnType<typeof mount>) => w.findAll('.table .row:not(.skip)')

describe('a write that partly fails', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        vi.clearAllMocks()
    })

    it('keeps the dialog open and says which files failed, and why', async () => {
        const w = await openAndWrite({
            result: {
                applied: [{ filepath: NIGHT, new_trackhash: 'c1', new_filepath: '/music/Game OST/68 - Night Woods1.mp3' }],
                failed: [{ filepath: GAME_WON, error: '[Errno 13] Permission denied' }],
            },
            error: null,
        })

        expect(w.emitted('hideModal')).toBeUndefined()
        const box = w.find('.failures')
        expect(box.exists()).toBe(true)
        expect(box.text()).toContain('02. Game Won.mp3')
        expect(box.text()).toContain('Permission denied')
        // The name, not the whole path: the folder is the album's own.
        expect(box.text()).not.toContain('/music/')
        // The dialog says it; a toast on top would only cover its buttons.
        expect(Notification).not.toHaveBeenCalled()
        // The page refreshes regardless — one file did change.
        expect(fetchTracksAndArtists).toHaveBeenCalledWith('a')
    })

    it('marks what went through as done and leaves what failed ticked, so writing again retries only that', async () => {
        const w = await openAndWrite({
            result: {
                applied: [{ filepath: NIGHT, new_trackhash: 'c1', new_filepath: '/music/Game OST/68 - Night Woods1.mp3' }],
                failed: [{ filepath: GAME_WON, error: 'read-only' }],
            },
            error: null,
        })

        expect(writableRows(w)).toHaveLength(1)
        expect(writableRows(w)[0].text()).toContain('Game Won')
        expect(w.find('button.apply').text()).toBe('Write 1 file(s)')

        requests.applyChanges.mockResolvedValueOnce({ result: { applied: [], failed: [] }, error: null })
        await w.find('button.apply').trigger('click')
        await flushPromises()

        expect(sent().map((change: { filepath: string }) => change.filepath)).toEqual([GAME_WON])
    })

    it('keeps a file whose tags went through but whose rename failed — writing again is the retry', async () => {
        const w = await openAndWrite({
            result: {
                applied: [{ filepath: NIGHT, new_trackhash: 'c1' }],
                failed: [{ filepath: NIGHT, error: '68 - Night Woods1.mp3 already exists' }],
            },
            error: null,
        })

        // GAME_WON was never reported, so it is neither done nor failed — it
        // stays as it was, and so does NIGHT.
        expect(writableRows(w)).toHaveLength(2)
        expect(w.find('.failures').text()).toContain('already exists')
    })

    it('shows a failure that belongs to no file without a file name', async () => {
        const w = await openAndWrite({
            result: {
                applied: [{ filepath: NIGHT, new_trackhash: 'c1' }, { filepath: GAME_WON, new_trackhash: 'c2' }],
                failed: [{ filepath: '', error: 'Playlists and favourites could not follow the new titles: locked' }],
            },
            error: null,
        })

        expect(w.emitted('hideModal')).toBeUndefined()
        expect(w.findAll('.failures li .file')).toHaveLength(0)
        expect(w.find('.failures').text()).toContain('could not follow the new titles')
        expect(w.find('button.apply').attributes('disabled')).toBeDefined()
    })

    it('does not claim the rest was written when every change failed', async () => {
        const w = await openAndWrite({
            result: {
                applied: [],
                failed: [
                    { filepath: NIGHT, error: 'read-only' },
                    { filepath: GAME_WON, error: 'read-only' },
                ],
            },
            error: null,
        })

        expect(w.find('.failures-lead').text()).toBe('2 change(s) could not be made. Nothing was written.')
        expect(writableRows(w)).toHaveLength(2)
    })

    it('says how much was written when only some failed', async () => {
        const w = await openAndWrite({
            result: { applied: [{ filepath: NIGHT, new_trackhash: 'c1' }], failed: [{ filepath: GAME_WON, error: 'read-only' }] },
            error: null,
        })

        expect(w.find('.failures-lead').text()).toBe('1 change(s) could not be made. 1 file(s) were written.')
    })

    it('keeps the rows of an earlier write done when a retry fails again', async () => {
        const w = await openAndWrite({
            result: {
                applied: [{ filepath: NIGHT, new_trackhash: 'c1', new_filepath: '/music/Game OST/68 - Night Woods1.mp3' }],
                failed: [{ filepath: GAME_WON, error: 'read-only' }],
            },
            error: null,
        })

        requests.applyChanges.mockResolvedValueOnce({
            result: { applied: [], failed: [{ filepath: GAME_WON, error: 'still read-only' }] },
            error: null,
        })
        await w.find('button.apply').trigger('click')
        await flushPromises()

        // NIGHT is renamed: its row names a path that is gone and must not come back.
        expect(writableRows(w)).toHaveLength(1)
        expect(writableRows(w)[0].text()).toContain('Game Won')
        expect(w.find('.failures').text()).toContain('still read-only')
    })

    it('keeps the lyrics note the toast used to carry', async () => {
        const w = await openAndWrite({
            result: {
                applied: [{ filepath: NIGHT, new_filepath: '/music/Game OST/68 - Night Woods1.mp3', warning: 'taken' }],
                failed: [{ filepath: GAME_WON, error: 'read-only' }],
            },
            error: null,
        })

        expect(w.find('.failures-lead').text()).toBe(
            '1 change(s) could not be made. 1 file(s) were written — 1 lyrics file(s) kept the old name.'
        )
    })

    it('still closes when everything went through', async () => {
        const w = await openAndWrite({
            result: { applied: [{ filepath: NIGHT, new_trackhash: 'c1' }, { filepath: GAME_WON, new_trackhash: 'c2' }], failed: [] },
            error: null,
        })

        expect(w.emitted('hideModal')).toHaveLength(1)
        expect(w.find('.failures').exists()).toBe(false)
        expect(Notification).toHaveBeenCalledTimes(1)
    })

    // The other half of the poll fix (#305): a write that was lost or ran out
    // of time may still have changed files on the server.
    it('refreshes the album even when the write was lost', async () => {
        const w = await openAndWrite({ result: null, error: 'Lost contact with the write' })

        expect(fetchTracksAndArtists).toHaveBeenCalledWith('a')
        expect(w.find('.error').text()).toBe('Lost contact with the write')
        expect(w.emitted('hideModal')).toBeUndefined()
    })

    it('forgets the failures once a new preview is loaded', async () => {
        const w = await openAndWrite({
            result: { applied: [], failed: [{ filepath: GAME_WON, error: 'read-only' }] },
            error: null,
        })
        expect(w.find('.failures').exists()).toBe(true)

        await w.find('.buttons button:not(.apply)').trigger('click') // Back
        await w.findAll('button.source')[1].trigger('click')
        await flushPromises()

        expect(w.find('.failures').exists()).toBe(false)
        expect(writableRows(w)).toHaveLength(2)
    })
})
