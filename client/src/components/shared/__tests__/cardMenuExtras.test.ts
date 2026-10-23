import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Component, defineComponent, h, inject } from 'vue'

// A row's own entries in its cards' menus (utils/cardMenu.ts, #531): the row
// provides them, the album and artist cards hand them to their menu. The same
// card outside such a row keeps its plain menu.
const { showAlbumContextMenu, showArtistContextMenu } = vi.hoisted(() => ({
    showAlbumContextMenu: vi.fn(),
    showArtistContextMenu: vi.fn(),
}))
vi.mock('@/helpers/contextMenuHandler', () => ({ showAlbumContextMenu, showArtistContextMenu }))

import AlbumCard from '@/components/shared/AlbumCard.vue'
import ArtistCard from '@/components/shared/ArtistCard.vue'
import CardScroller from '@/components/shared/CardScroller.vue'
import vContextMenu from '@/directives/vContextMenu'
import { CARD_MENU_EXTRAS, CardMenuExtras } from '@/utils/cardMenu'

const ALBUM = {
    albumhash: 'a0000000000000pr',
    title: 'Frizzle Fry',
    image: 'a0000000000000pr.webp?pathhash=ph',
    albumartists: [{ name: 'Primus', artisthash: 'b0000000000000pr' }],
    date: 1990,
    type: 'album',
    versions: [],
    genres: [],
    is_favorite: false,
}
const ARTIST = { artisthash: 'b0000000000000pr', name: 'Primus', image: 'b0000000000000pr.webp' }

const NOT_INTERESTED = [{ label: 'Not interested' }]
const extras: CardMenuExtras = card => (card.hash ? NOT_INTERESTED : [])

function mountCard(component: Component, props: Record<string, unknown>, provide?: CardMenuExtras) {
    return mount(component, {
        props,
        global: {
            directives: { 'context-menu': vContextMenu },
            provide: provide ? { [CARD_MENU_EXTRAS as symbol]: provide } : {},
            stubs: { RouterLink: { template: '<a><slot /></a>' } },
        },
    })
}

beforeEach(() => {
    setActivePinia(createPinia())
    showAlbumContextMenu.mockReset()
    showArtistContextMenu.mockReset()
})

describe('the album and artist cards', () => {
    it('hand the row entries to the album menu', async () => {
        const w = mountCard(AlbumCard, { album: ALBUM }, extras)

        await w.trigger('contextmenu')

        expect(showAlbumContextMenu).toHaveBeenCalledTimes(1)
        expect(showAlbumContextMenu.mock.calls[0][3]).toEqual(NOT_INTERESTED)
    })

    it('hand the row entries to the artist menu', async () => {
        const w = mountCard(ArtistCard, { artist: ARTIST }, extras)

        await w.trigger('contextmenu')

        expect(showArtistContextMenu.mock.calls[0][4]).toEqual(NOT_INTERESTED)
    })

    it('keep the plain menu outside such a row', async () => {
        const w = mountCard(AlbumCard, { album: ALBUM })

        await w.trigger('contextmenu')

        expect(showAlbumContextMenu.mock.calls[0][3]).toBeUndefined()
    })

    it('name the card they are on', async () => {
        const seen = vi.fn(() => [])
        await mountCard(AlbumCard, { album: ALBUM }, seen).trigger('contextmenu')
        await mountCard(ArtistCard, { artist: ARTIST }, seen).trigger('contextmenu')

        expect(seen.mock.calls).toEqual([
            [{ type: 'album', hash: ALBUM.albumhash, name: 'Frizzle Fry' }],
            [{ type: 'artist', hash: ARTIST.artisthash, name: 'Primus' }],
        ])
    })
})

describe('the row', () => {
    // What the row provides, read from inside it (its caption slot).
    const Probe = defineComponent({
        setup() {
            const provided = inject(CARD_MENU_EXTRAS, null)
            return () => h('i', { 'data-entries': JSON.stringify(provided?.({ type: 'album', hash: 'x', name: 'X' })) })
        },
    })

    const mountRow = (cardMenu?: CardMenuExtras) =>
        mount(CardScroller, {
            props: { title: 'Never played', items: [], cardMenu },
            slots: { actions: () => h(Probe) },
            global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
        })

    it('provides its entries to what it holds', () => {
        expect(mountRow(extras).find('i').attributes('data-entries')).toBe(JSON.stringify(NOT_INTERESTED))
    })

    it('provides none without a cardMenu', () => {
        expect(mountRow().find('i').attributes('data-entries')).toBe('[]')
    })
})
