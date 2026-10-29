import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { cardKeys } from '@/utils/cardKeys'
import CardScroller from '../CardScroller.vue'

// ---------------------------------------------------------------------------
// Home flickered when you came back to it.
//
// The rows show the cached cards first and the server's answer a moment later.
// The cards were keyed by the item OBJECT, and every fetch hands out new
// objects for the same cards — so Vue threw each card away and built it again:
// artwork reloaded, arrival animation replayed. Measured on the running app
// (~/uitest/homeflicker.js): back to Home at 1920px built 72 of 83 cards twice.
// ---------------------------------------------------------------------------

const row = () => [
    { type: 'album', item: { albumhash: 'a1', title: 'One', image: 'a1.webp', artists: [], versions: [] } },
    { type: 'playlist', item: { id: 7, name: 'Mix', images: [] } },
    { type: 'artist', item: { artisthash: 'r1', name: 'Someone', image: 'r1.webp' } },
    { type: 'track', item: { trackhash: 't1', title: 'Song', artists: [] } },
]

const stubs = {
    AlbumCard: { props: ['album'], template: '<div class="card">{{ album.title }}</div>' },
    PlaylistCard: { props: ['playlist'], template: '<div class="card">{{ playlist.name }}</div>' },
    ArtistCard: { props: ['artist'], template: '<div class="card">{{ artist.name }}</div>' },
    TrackCard: { props: ['track'], template: '<div class="card">{{ track.title }}</div>' },
    RouterLink: { template: '<a><slot /></a>' },
    SeeAll: true,
}

function mountRow() {
    return mount(CardScroller, { props: { title: 'Row', items: row() }, global: { stubs } })
}

describe('CardScroller keys', () => {
    it('keeps the cards when a refetch brings the same items as new objects', async () => {
        const wrapper = mountRow()
        const before = wrapper.findAll('.card').map(c => c.element)
        expect(before).toHaveLength(4)

        await wrapper.setProps({ items: row() })

        const after = wrapper.findAll('.card').map(c => c.element)
        expect(after).toHaveLength(4)
        after.forEach((el, i) => expect(el, `card ${i} was rebuilt`).toBe(before[i]))
    })

    it('still shows what changed on a card it keeps', async () => {
        const wrapper = mountRow()
        const items = row()
        items[1].item.name = 'Mix, refreshed'

        await wrapper.setProps({ items })

        expect(wrapper.findAll('.card')[1].text()).toBe('Mix, refreshed')
    })

    it('keeps the neighbours when a card leaves the row ("Not interested")', async () => {
        const wrapper = mountRow()
        const before = wrapper.findAll('.card').map(c => c.element)

        await wrapper.setProps({ items: row().filter((_, i) => i !== 1) })

        const after = wrapper.findAll('.card').map(c => c.element)
        // Identity, not equality: a rebuilt card looks the same.
        expect(after).toHaveLength(3)
        ;[before[0], before[2], before[3]].forEach((el, i) => expect(after[i], `card ${i} was rebuilt`).toBe(el))
    })

    it('builds a card for an item that is new to the row', async () => {
        const wrapper = mountRow()
        const first = wrapper.findAll('.card')[0].element
        const items = row()
        items[0] = { type: 'album', item: { albumhash: 'a2', title: 'Two', image: '', artists: [], versions: [] } }

        await wrapper.setProps({ items })

        expect(wrapper.findAll('.card')[0].element).not.toBe(first)
        expect(wrapper.findAll('.card')[0].text()).toBe('Two')
    })
})

describe('cardKeys', () => {
    it('names a card by what it shows', () => {
        expect(cardKeys(row())).toEqual(['album:a1', 'playlist:7', 'artist:r1', 'track:t1'])
        expect(cardKeys([{ type: 'folder', item: { path: '/m/x' } }, { type: 'favorite', item: { count: 3 } }])).toEqual([
            'folder:/m/x',
            'favorite:favorites',
        ])
    })

    it('keeps keys unique when a row holds the same card twice', () => {
        const twice = [row()[0], row()[0], row()[0]]
        expect(cardKeys(twice)).toEqual(['album:a1', '#1 album:a1', '#2 album:a1'])
    })

    it('cannot collide with an id that looks like a count', () => {
        const folders = [
            { type: 'folder', item: { path: '/m/a' } },
            { type: 'folder', item: { path: '/m/a' } },
            { type: 'folder', item: { path: '/m/a#1' } },
        ]
        expect(new Set(cardKeys(folders)).size).toBe(3)
    })

    it('keys placeholders by their place', () => {
        const empty = [{ type: 'placeholder' }, { type: 'placeholder' }]
        expect(cardKeys(empty)).toEqual(['placeholder@0', 'placeholder@1'])
    })

    it('does not mix a type up with another one of the same id', () => {
        const same = [
            { type: 'album', item: { albumhash: 'x' } },
            { type: 'artist', item: { artisthash: 'x' } },
        ]
        expect(new Set(cardKeys(same)).size).toBe(2)
    })
})
