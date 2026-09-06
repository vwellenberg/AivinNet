import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import useBrowseStore, { LETTERS, OTHER, initialOf } from '../searchBrowse'

const get = vi.fn()
vi.mock('@/requests/useAxios', () => ({ default: (...args: unknown[]) => get(...args) }))

/** A page of the /getall/artists shape. */
const page = (names: string[], total = names.length) => ({
    status: 200,
    data: { items: names.map(name => ({ name })), total },
})

describe('initialOf', () => {
    it.each([
        ['Weezer', 'W'],
        ['weezer', 'W'],
        ['  Vulfpeck', 'V'],
        ['01', OTHER],
        ['...Und Null Sekunden', OTHER],
        ['響', OTHER],
        ['', OTHER],
        // Accents fold, or a third of a european library sits under "#" with
        // the digits — and the count on the O and E keys would have lied.
        ['Ólafur Arnalds', 'O'],
        ['Édith Piaf', 'E'],
        ['Ängie', 'A'],
    ])('%s belongs under %s', (name, expected) => {
        expect(initialOf(name)).toBe(expected)
    })
})

describe('the letter band', () => {
    it('offers # plus every letter, in that order', () => {
        expect(LETTERS).toHaveLength(27)
        expect(LETTERS[0]).toBe(OTHER)
        expect(LETTERS[1]).toBe('A')
        expect(LETTERS[26]).toBe('Z')
    })
})

describe('searchBrowse store', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        get.mockReset()
    })

    it('counts artists per key and leaves empty keys absent', async () => {
        get.mockResolvedValueOnce(page(['Air', 'Alt-J', 'Bite', '01']))

        const store = useBrowseStore()
        await store.fetchArtists()

        expect(store.counts).toEqual({ A: 2, B: 1, [OTHER]: 1 })
        expect(store.counts['Z']).toBeUndefined()
    })

    it('fetches every page until the total is reached', async () => {
        const first = Array.from({ length: 500 }, (_, i) => `A${i}`)
        get.mockResolvedValueOnce(page(first, 501)).mockResolvedValueOnce(page(['Bite'], 501))

        const store = useBrowseStore()
        await store.fetchArtists()

        expect(get).toHaveBeenCalledTimes(2)
        expect(store.artists).toHaveLength(501)
        expect(get.mock.calls[1][0].url).toContain('start=500')
    })

    // A total the pages never reach would otherwise spin here forever — but a
    // truncated list committed as a good one is cached for the whole TTL, with
    // every letter past the cut refusing to be pressed and nothing to retry.
    it('shows a truncated list without calling it loaded', async () => {
        get.mockResolvedValueOnce(page(['Bite'], 9999)).mockResolvedValueOnce(page([], 9999))

        const store = useBrowseStore()
        await store.fetchArtists()

        expect(get).toHaveBeenCalledTimes(2)
        expect(store.artists).toHaveLength(1)
        expect(store.loaded).toBe(false)
    })

    it('treats an empty library as an answer, not as a failure', async () => {
        get.mockResolvedValueOnce(page([], 0))

        const store = useBrowseStore()
        await store.fetchArtists()

        expect(store.failed).toBe(false)
        expect(store.loaded).toBe(true)
        expect(store.artists).toEqual([])
        expect(store.letter).toBeNull()
    })

    it('treats a body without a total as a failure', async () => {
        get.mockResolvedValueOnce({ status: 200, data: { items: [{ name: 'Bite' }] } })

        const store = useBrowseStore()
        await store.fetchArtists()

        expect(store.failed).toBe(true)
        expect(store.loaded).toBe(false)
    })

    it('fetches once, however often it is asked', async () => {
        get.mockResolvedValue(page(['Bite']))

        const store = useBrowseStore()
        await store.fetchArtists()
        await store.fetchArtists()

        expect(get).toHaveBeenCalledTimes(1)
    })

    // `useAxios` does NOT throw — it resolves with the status and whatever body
    // came back. Read as an empty page, a 500 would leave the band absent for
    // the rest of the session AND marked loaded, so it never retried.
    it('treats a non-200 as a failure, not as an empty library', async () => {
        get.mockResolvedValueOnce({ status: 500, error: 'boom', data: undefined })

        const store = useBrowseStore()
        await store.fetchArtists()

        expect(store.failed).toBe(true)
        expect(store.loading).toBe(false)
        expect(store.artists).toEqual([])
        // Not marked loaded, so opening the page again retries.
        expect(store.loaded).toBe(false)
    })

    // Clearing it at the START of the attempt unmounted the notice the retry
    // button lives in, so the block went blank for the whole retry and the
    // button's disabled state was unreachable.
    it('keeps failed set while the retry is in flight', async () => {
        get.mockResolvedValueOnce({ status: 500, data: undefined })
        const store = useBrowseStore()
        await store.fetchArtists()

        let resolve: (value: unknown) => void = () => {}
        get.mockReturnValueOnce(new Promise(r => (resolve = r)))
        const inFlight = store.fetchArtists()

        expect(store.failed).toBe(true)
        expect(store.loading).toBe(true)

        resolve(page(['Bite']))
        await inFlight
        expect(store.failed).toBe(false)
    })

    it('retries after a failure', async () => {
        get.mockResolvedValueOnce({ status: 500, data: undefined })
        const store = useBrowseStore()
        await store.fetchArtists()

        get.mockResolvedValueOnce(page(['Bite']))
        await store.fetchArtists()

        expect(store.failed).toBe(false)
        expect(store.artists).toHaveLength(1)
    })

    it('keeps what it had when a LATER page fails', async () => {
        const first = Array.from({ length: 500 }, (_, i) => `A${i}`)
        get.mockResolvedValueOnce(page(first, 900)).mockResolvedValueOnce({ status: 500, data: undefined })

        const store = useBrowseStore()
        await store.fetchArtists()

        expect(store.failed).toBe(true)
        expect(store.loaded).toBe(false)
    })

    it('shows the picked letter, and only that', async () => {
        get.mockResolvedValueOnce(page(['Air', 'Bite', 'Cake']))

        const store = useBrowseStore()
        await store.fetchArtists()

        store.selectLetter('B')
        expect(store.shown.map(a => a.name)).toEqual(['Bite'])
    })

    // Opening on "no letter" means opening on whatever sorts first, and in a
    // real library that is the "#" group — "…Und Null Sekunden, 01, 02, 03".
    it('opens on the first LETTER that has anyone, never on #', async () => {
        get.mockResolvedValueOnce(page(['01', '...Und Null Sekunden', 'Bite', 'Cake']))

        const store = useBrowseStore()
        await store.fetchArtists()

        expect(store.letter).toBe('B')
        expect(store.shown.map(a => a.name)).toEqual(['Bite'])
    })

    it('falls back to # when the library has no latin initials at all', async () => {
        get.mockResolvedValueOnce(page(['01', '響']))

        const store = useBrowseStore()
        await store.fetchArtists()

        expect(store.letter).toBe(OTHER)
        expect(store.shown).toHaveLength(2)
    })

    // A band whose second press empties the page below it is a trap.
    it('keeps the letter selected when its key is pressed again', async () => {
        get.mockResolvedValueOnce(page(['Air', 'Bite']))

        const store = useBrowseStore()
        await store.fetchArtists()

        store.selectLetter('A')
        store.selectLetter('A')

        expect(store.letter).toBe('A')
        expect(store.shown.map(a => a.name)).toEqual(['Air'])
    })

    it('ignores a press on a letter that has nobody', async () => {
        get.mockResolvedValueOnce(page(['Air']))

        const store = useBrowseStore()
        await store.fetchArtists()

        store.selectLetter('Z')
        expect(store.letter).toBe('A')
    })
})
