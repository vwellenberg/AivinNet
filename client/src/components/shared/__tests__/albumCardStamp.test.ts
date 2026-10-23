import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

// "Recently added" stamps the albums this user has not played (#533). The row
// is the same for everyone; the server marks the card per user with
// `home.unheard`, and only then does the card carry the stamp.
import AlbumCard from '@/components/shared/AlbumCard.vue'
import CardStamp from '@/components/shared/CardStamp.vue'
import vContextMenu from '@/directives/vContextMenu'
import { Album } from '@/interfaces'

// As GET /nothome sends a card of the row (`recover_items`).
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
    help_text: 'NEW ALBUM',
    time: '2 days ago',
}

const card = (album: Record<string, unknown>) =>
    mount(AlbumCard, {
        props: { album: album as unknown as Album },
        global: {
            directives: { 'context-menu': vContextMenu },
            stubs: { RouterLink: { template: '<a><slot /></a>' } },
        },
    })

beforeEach(() => {
    setActivePinia(createPinia())
})

describe('the NEW stamp on an album card', () => {
    it('is on an album the user has not played, inside an art box that lets it hang over', () => {
        const w = card({ ...ALBUM, home: { unheard: true } })

        const stamp = w.findComponent(CardStamp)
        expect(stamp.exists()).toBe(true)
        expect(stamp.props()).toMatchObject({ value: 'NEW', caption: 'to you' })
        expect(w.find('.card-art').classes()).toContain('has-stamp')
    })

    it('is not on an album the user has heard, nor on a card outside the row', () => {
        for (const album of [{ ...ALBUM, home: { unheard: false } }, ALBUM]) {
            const w = card(album)
            expect(w.findComponent(CardStamp).exists()).toBe(false)
            expect(w.find('.card-art').classes()).not.toContain('has-stamp')
        }
    })
})
