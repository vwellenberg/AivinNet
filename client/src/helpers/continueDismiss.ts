/**
 * The ✕ on a "Continue listening" card (#776): the card leaves the row at once,
 * and the server keeps it out until it is played again. Undo takes the
 * dismissal back and fetches Home, which brings the card back where it was.
 * Same shape as "Not interested" (helpers/notInterested.ts).
 */
import { type ContinueType, dismissContinue, undismissContinue } from '@/requests/home'
import useHome from '@/stores/home'
import { NotifType, Notification, useToast } from '@/stores/notification'

export async function removeFromContinue(card: { type: string; hash: string }, name: string) {
    // The server names exactly these two types; anything else is refused by it (400).
    const key = { type: card.type as ContinueType, hash: card.hash }
    const home = useHome()
    const putBack = home.dropContinue(key.type, key.hash)

    const res = await dismissContinue(key.type, key.hash)
    if (res.status !== 200) {
        putBack()
        useToast().showError(`Could not remove ${name}`)
        return
    }

    new Notification(`Removed ${name} from Continue listening`, NotifType.Info, {
        label: 'Undo',
        handler: async () => {
            const back = await undismissContinue(key.type, key.hash)
            if (back.status !== 200) {
                useToast().showError(`Could not bring ${name} back`)
                return
            }
            await home.refreshIfLoaded()
        },
    })
}
