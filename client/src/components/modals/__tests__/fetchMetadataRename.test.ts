import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// #144: the metadata dialog renames the FILES too. The server works every name
// out and the dialog only echoes what it showed, so what matters here is what
// reaches `applyChanges`: a name only for a row the person ticked, only when
// renaming is on, and never for a row whose name is taken.
// ---------------------------------------------------------------------------

const { requests } = vi.hoisted(() => ({
    requests: {
        fetchPreview: vi.fn(),
        fetchReleaseCandidates: vi.fn(),
        applyChanges: vi.fn(() => Promise.resolve({ result: { applied: [], failed: [] }, error: null })),
    },
}))

vi.mock('@/requests/metadata', () => requests)
vi.mock('@/stores/pages/album', () => ({ default: () => ({ fetchTracksAndArtists: vi.fn() }) }))
vi.mock('@/stores/notification', () => ({ Notification: vi.fn(), NotifType: {} }))

import FetchMetadata from '@/components/modals/FetchMetadata.vue'

const side = (filepath: string, title: string, track: number) => ({
    trackhash: 'h',
    filepath,
    title,
    track,
    disc: 1,
    duration: 100,
})

/** The Guild 2 case: titles and numbers from the file names, names to match. */
const guildPreview = {
    rows: [
        {
            current: side('/m/68. Night Woods1.mp3', '68', 1),
            proposed: { title: 'Night Woods1', track: 68, disc: null, duration: 100 },
            delta: null,
            confident: false,
            filename: { current: '68. Night Woods1.mp3', proposed: '68 - Night Woods1.mp3', status: 'rename' },
        },
        {
            current: side('/m/02. Game Won.mp3', '02', 1),
            proposed: { title: 'Game Won', track: 2, disc: null, duration: 100 },
            delta: null,
            confident: false,
            // Taken by a file outside the album: shown, never sent.
            filename: { current: '02. Game Won.mp3', proposed: '02 - Game Won.mp3', status: 'conflict' },
        },
    ],
    summary: { matched: 2, confident: 0, unmatched_local: 0, unmatched_remote: 0, ordered_by_filepath: false },
}

async function openWithFilenames() {
    requests.fetchPreview.mockResolvedValue({ result: structuredClone(guildPreview), error: null })
    const w = mount(FetchMetadata, { props: { albumhash: 'a', albumTitle: 'The Guild 2' } })
    const plates = w.findAll('button.source')
    await plates[1].trigger('click') // "Read the file names"
    await flushPromises()
    return w
}

const sent = () => (requests.applyChanges.mock.calls.at(-1) as any)[0]

describe('the metadata dialog renames files (#144)', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        vi.clearAllMocks()
    })

    it('sends the name the preview showed, with the tags, for a ticked row', async () => {
        const w = await openWithFilenames()

        expect(w.text()).toContain('68 - Night Woods1.mp3')
        await w.find('button.apply').trigger('click')
        await flushPromises()

        expect(sent()).toEqual([
            { filepath: '/m/68. Night Woods1.mp3', title: 'Night Woods1', track: 68, filename: '68 - Night Woods1.mp3' },
            // The conflicting row still gets its tags — only the name stays.
            { filepath: '/m/02. Game Won.mp3', title: 'Game Won', track: 2 },
        ])
    })

    it('titles itself after what it is doing, not after how it was opened', async () => {
        requests.fetchPreview.mockResolvedValue({ result: structuredClone(guildPreview), error: null })
        const w = mount(FetchMetadata, { props: { albumhash: 'a', albumTitle: 'A', startWith: 'tags' } })
        await flushPromises()
        expect(w.emitted('setTitle')?.at(-1)).toEqual(['Rename files'])

        // Back to the sources, then a source that rewrites tags.
        await w.find('.buttons button:not(.apply)').trigger('click')
        expect(w.emitted('setTitle')?.at(-1)).toEqual(['Fetch titles & numbers'])
        await w.findAll('button.source')[1].trigger('click')
        await flushPromises()
        expect(w.emitted('setTitle')?.at(-1)).toEqual(['Fetch titles & numbers'])
    })

    it('says so when a lyrics file could not follow its track', async () => {
        const { Notification } = await import('@/stores/notification')
        requests.applyChanges.mockResolvedValueOnce({
            result: {
                applied: [
                    { filepath: '/m/68. Night Woods1.mp3', new_filepath: '/m/68 - Night Woods1.mp3', warning: 'taken' },
                ],
                failed: [],
            },
            error: null,
        } as any)
        const w = await openWithFilenames()

        await w.find('button.apply').trigger('click')
        await flushPromises()

        expect((Notification as any).mock.calls.at(-1)[0]).toContain('1 lyrics file(s) kept the old name')
    })

    it('sends no name at all when the person unticks "Rename the files too"', async () => {
        const w = await openWithFilenames()

        await w.find('.rename-toggle input').setValue(false)
        expect(w.text()).not.toContain('68 - Night Woods1.mp3')
        await w.find('button.apply').trigger('click')
        await flushPromises()

        expect(sent().every((change: any) => !('filename' in change))).toBe(true)
    })

    it('opens straight into renaming from the album menu and sends names only', async () => {
        requests.fetchPreview.mockResolvedValue({
            result: {
                rows: [
                    {
                        current: side('/m/track1.mp3', 'Night Woods', 68),
                        proposed: null,
                        delta: null,
                        confident: false,
                        filename: { current: 'track1.mp3', proposed: '68 - Night Woods.mp3', status: 'rename' },
                    },
                    {
                        current: side('/m/02 - Right.mp3', 'Right', 2),
                        proposed: null,
                        delta: null,
                        confident: false,
                        filename: { current: '02 - Right.mp3', proposed: '02 - Right.mp3', status: 'unchanged' },
                    },
                ],
            },
            error: null,
        })

        const w = mount(FetchMetadata, { props: { albumhash: 'a', albumTitle: 'A', startWith: 'tags' } })
        await flushPromises()

        expect(requests.fetchPreview).toHaveBeenCalledWith('a', 'tags')
        expect(w.emitted('setTitle')?.[0]).toEqual(['Rename files'])
        // Renaming is the whole point here, so there is no box to untick.
        expect(w.find('.rename-toggle').exists()).toBe(false)
        expect(w.find('button.apply').text()).toBe('Rename 1 file(s)')

        await w.find('button.apply').trigger('click')
        await flushPromises()

        expect(sent()).toEqual([{ filepath: '/m/track1.mp3', filename: '68 - Night Woods.mp3' }])
    })
})
