/**
 * Entries a row of cards adds to the context menus of its own cards — Home's
 * "Not interested" on "Never played" and "Artists you might like" (#531).
 *
 * A row provides it (`CardScroller`'s `cardMenu`), the album and artist cards
 * inject it: the same card elsewhere (an artist page, the album list) has no
 * such row around it and keeps its plain menu.
 */
import type { InjectionKey } from 'vue'

import type { Option } from '@/interfaces'

export interface MenuCard {
    type: 'album' | 'artist'
    hash: string
    name: string
}

export type CardMenuExtras = (card: MenuCard) => Option[]

export const CARD_MENU_EXTRAS: InjectionKey<CardMenuExtras> = Symbol('cardMenuExtras')
