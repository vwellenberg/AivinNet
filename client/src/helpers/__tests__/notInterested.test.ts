import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// "Not interested" on a Home card (#531): which cards offer it, and what the
// entry does when the server agrees, refuses, or is asked to undo.
const { markNotInterested, unmarkNotInterested, dropCard, putBack, fetchAll, showError, notify, guest } = vi.hoisted(
    () => ({
        markNotInterested: vi.fn(),
        unmarkNotInterested: vi.fn(),
        dropCard: vi.fn(),
        putBack: vi.fn(),
        fetchAll: vi.fn(),
        showError: vi.fn(),
        notify: vi.fn(),
        guest: { value: false },
    })
)

vi.mock('@/requests/home', () => ({ markNotInterested, unmarkNotInterested }))
vi.mock('@/stores/home', () => ({ default: () => ({ dropCard, fetchAll }) }))
vi.mock('@/settings/utils', () => ({ loggedInUserIsGuest: () => guest.value }))
vi.mock('@/stores/notification', () => ({
    NotifType: { Info: 'info', Error: 'error' },
    useToast: () => ({ showError }),
    Notification: class {
        constructor(...args: unknown[]) {
            notify(...args)
        }
    },
}))

import { notInterested, notInterestedMenu } from '@/helpers/notInterested'

const PRIMUS = { type: 'album' as const, hash: 'a0000000000000pr', name: 'Frizzle Fry' }

beforeEach(() => {
    for (const fn of [markNotInterested, unmarkNotInterested, dropCard, putBack, fetchAll, showError, notify]) fn.mockReset()
    dropCard.mockReturnValue(putBack)
    markNotInterested.mockResolvedValue({ status: 200, data: { msg: 'Marked' } })
    unmarkNotInterested.mockResolvedValue({ status: 200, data: { msg: 'Removed' } })
    guest.value = false
})

describe('the menu entry', () => {
    it('is on the cards of the kind a row says it lets the user mark', () => {
        expect(notInterestedMenu('never_played', 'album')!(PRIMUS).map(o => o.label)).toEqual(['Not interested'])
        const artist = { type: 'artist' as const, hash: 'b0000000000000pr', name: 'Primus' }
        expect(notInterestedMenu('artists_you_might_like', 'artist')!(artist).map(o => o.label)).toEqual([
            'Not interested',
        ])
    })

    it('is not on a row that says nothing, nor on a card of the other kind', () => {
        expect(notInterestedMenu('recently_played', undefined)).toBeUndefined()
        expect(notInterestedMenu(undefined, 'album')).toBeUndefined()
        expect(notInterestedMenu('artists_you_might_like', 'artist')!(PRIMUS)).toEqual([])
    })

    it('is not offered to the guest account, which every guest shares', () => {
        guest.value = true
        expect(notInterestedMenu('never_played', 'album')).toBeUndefined()
    })
})

describe('marking a card', () => {
    it('takes it out of the row at once and tells the server', async () => {
        await notInterested('never_played', PRIMUS)

        expect(dropCard).toHaveBeenCalledWith('never_played', PRIMUS.hash)
        expect(markNotInterested).toHaveBeenCalledWith('album', PRIMUS.hash)
        expect(putBack).not.toHaveBeenCalled()
        expect(notify.mock.calls[0][0]).toBe("Won't suggest Frizzle Fry again")
    })

    it('puts the card back when the server refuses', async () => {
        markNotInterested.mockResolvedValue({ status: 500, data: null })

        await notInterested('never_played', PRIMUS)

        expect(putBack).toHaveBeenCalled()
        expect(showError).toHaveBeenCalledWith('Could not hide Frizzle Fry')
        expect(notify).not.toHaveBeenCalled()
    })

    it('undoes from the toast: takes the mark back and fetches Home again', async () => {
        await notInterested('never_played', PRIMUS)
        const action = notify.mock.calls[0][2] as { label: string; handler: () => Promise<void> }
        expect(action.label).toBe('Undo')

        await action.handler()
        await flushPromises()

        expect(unmarkNotInterested).toHaveBeenCalledWith('album', PRIMUS.hash)
        expect(fetchAll).toHaveBeenCalled()
    })

    it('says so when the undo does not go through, and leaves Home as it is', async () => {
        unmarkNotInterested.mockResolvedValue({ status: 500, data: null })
        await notInterested('never_played', PRIMUS)

        await (notify.mock.calls[0][2] as { handler: () => Promise<void> }).handler()

        expect(showError).toHaveBeenCalledWith('Could not bring Frizzle Fry back')
        expect(fetchAll).not.toHaveBeenCalled()
    })
})
