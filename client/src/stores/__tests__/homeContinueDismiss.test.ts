import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getHomePageData = vi.fn()

vi.mock('../content-width', async () => {
    const { ref } = await import('vue')

    return { maxAbumCards: ref(6), fetchCardCount: ref(6) }
})
vi.mock('@/requests/home', () => ({ getHomePageData: (...args: unknown[]) => getHomePageData(...args) }))

import useHome from '../home'

/** A Continue card as the server sends it: the album, and the key ✕ dismisses it by (#776). */
const card = (hash: string) => ({
    type: 'album',
    item: { albumhash: hash, title: hash, track_index: 1, track_total: 5 },
    dismiss: { type: 'album', hash },
})

const hashesOf = (items: { dismiss?: { hash: string } }[]) => items.map(item => item.dismiss?.hash)

describe('home store: the ✕ on a Continue card (#776)', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        getHomePageData.mockReset()
        // A fresh answer each time, as the server sends one: the store keeps the
        // objects it is given, and a shared one would carry the drop into the next fetch.
        getHomePageData.mockImplementation(async () => ({
            rows: [{ continue_listening: { title: 'Continue listening', description: '', items: [card('a'), card('b'), card('c')] } }],
            stations: [],
        }))
    })

    it('takes the card out at once, where it stood', async () => {
        const home = useHome()
        await home.fetchAll()

        home.dropContinue('album', 'b')

        expect(hashesOf(home.continueListening)).toEqual(['a', 'c'])
    })

    it('puts the card back where it stood when the server refuses', async () => {
        const home = useHome()
        await home.fetchAll()

        const putBack = home.dropContinue('album', 'b')
        putBack()

        expect(hashesOf(home.continueListening)).toEqual(['a', 'b', 'c'])
    })

    it('puts nothing back after a fetch in between: the server answer is there', async () => {
        const home = useHome()
        await home.fetchAll()

        const putBack = home.dropContinue('album', 'b')
        await home.fetchAll()
        putBack()

        expect(hashesOf(home.continueListening)).toEqual(['a', 'b', 'c'])
    })

    it('leaves the list alone for a key that is not on it', async () => {
        const home = useHome()
        await home.fetchAll()

        home.dropContinue('album', 'nope')

        expect(hashesOf(home.continueListening)).toEqual(['a', 'b', 'c'])
    })

    it('leaves a card without a dismiss key where it is (an older server)', async () => {
        const home = useHome()
        getHomePageData.mockResolvedValue({
            rows: [{ continue_listening: { title: 'Continue listening', description: '', items: [{ type: 'album', item: { albumhash: 'x' } }] } }],
            stations: [],
        })
        await home.fetchAll()

        home.dropContinue('album', 'x')

        expect(home.continueListening).toHaveLength(1)
    })
})
