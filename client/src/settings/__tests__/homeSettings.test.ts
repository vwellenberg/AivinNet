import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/stores/notification', () => ({
    NotifType: { Success: 'success', Error: 'error' },
    useToast: () => ({ showNotification: vi.fn() }),
}))

import home from '@/settings/home'
import useAuth from '@/stores/auth'

// Settings → Home (#532) for the guest account: one account shared by every
// guest, refused the layout write by the server (403). The page would only
// lead to "Could not save your Home rows", so it is not listed.
describe('Settings → Home', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
    })

    const shownTo = (roles: string[] | undefined) => {
        useAuth().user.roles = roles as string[]
        return home.show_if!()
    }

    it('is there for every account of its own', () => {
        expect(shownTo(['admin'])).toBe(true)
        expect(shownTo(['user'])).toBe(true)
        // Before /auth/user has answered.
        expect(shownTo(undefined)).toBe(true)
    })

    it('is not there for the guest account', () => {
        expect(shownTo(['guest'])).toBe(false)
    })
})
