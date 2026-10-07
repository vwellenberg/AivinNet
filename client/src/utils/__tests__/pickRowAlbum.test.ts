import { describe, expect, it } from 'vitest'
import { pickRowAlbum } from '../pickRowAlbum'

const album = (albumhash: string, title = albumhash) => ({ type: 'album', item: { albumhash, title } })

describe('pickRowAlbum', () => {
    it('picks among the album cards only', () => {
        const items = [{ type: 'track', item: { title: 'x' } }, album('a'), album('b')]

        expect(pickRowAlbum(items, () => 0)).toEqual({ albumhash: 'a', title: 'a' })
        expect(pickRowAlbum(items, () => 0.99)).toEqual({ albumhash: 'b', title: 'b' })
    })

    it('stays in range at the top end of random()', () => {
        expect(pickRowAlbum([album('a')], () => 1)).toEqual({ albumhash: 'a', title: 'a' })
    })

    it('answers null for a row without albums', () => {
        expect(pickRowAlbum([], () => 0)).toBeNull()
        expect(pickRowAlbum([{ type: 'track' }], () => 0)).toBeNull()
    })
})
