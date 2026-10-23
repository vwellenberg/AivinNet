/**
 * "Not interested" on the cards of "Never played" and "Artists you might
 * like" (#531): the menu entry, and what it does.
 *
 * The card leaves the row at once; the server leaves it out of Home from now
 * on, and the routines leave it out when they draw the row again. Undo takes
 * the mark back and refetches Home, which brings the card back where it was.
 * The full list, and taking marks back later: Settings → Home.
 */
import { NotInterestedIcon } from '@/icons'
import { markNotInterested, unmarkNotInterested } from '@/requests/home'
import { loggedInUserIsGuest } from '@/settings/utils'
import useHome from '@/stores/home'
import { NotifType, Notification, useToast } from '@/stores/notification'
import { CardMenuExtras, MenuCard } from '@/utils/cardMenu'

/**
 * The menu entries a Home row adds to its cards: "Not interested" on the rows
 * the server sends as `markable` (the kind of card they hold) — "Never
 * played" and "Artists you might like", which draw from the same best guesses
 * every day.
 */
export function notInterestedMenu(
    rowKey: string | undefined,
    kind: MenuCard['type'] | undefined
): CardMenuExtras | undefined {
    // The guest account is every guest's: the server refuses its marks (403).
    if (!rowKey || !kind || loggedInUserIsGuest()) return undefined

    return card =>
        card.type === kind
            ? [{ label: 'Not interested', icon: NotInterestedIcon, action: () => notInterested(rowKey, card) }]
            : []
}

export async function notInterested(rowKey: string, card: MenuCard) {
    const home = useHome()
    const putBack = home.dropCard(rowKey, card.hash)

    const res = await markNotInterested(card.type, card.hash)
    if (res.status !== 200) {
        putBack()
        useToast().showError(`Could not hide ${card.name}`)
        return
    }

    new Notification(`Won't suggest ${card.name} again`, NotifType.Info, {
        label: 'Undo',
        handler: async () => {
            const back = await unmarkNotInterested(card.type, card.hash)
            if (back.status !== 200) {
                useToast().showError(`Could not bring ${card.name} back`)
                return
            }
            await home.fetchAll()
        },
    })
}
