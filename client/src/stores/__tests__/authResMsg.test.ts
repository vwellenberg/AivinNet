import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/stores/notification', () => ({
    NotifType: { Success: 'success', Error: 'error' },
    useToast: () => ({ showNotification: vi.fn() }),
}))

import useAuth from '@/stores/auth'

// `useAxios` resolves with no `data` when the request never got an answer
// (server restarting). The error path read `res.data.msg` and threw, so the
// login form just looked dead.
describe('showResMsgOrGenericError', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
    })

    it('falls back to the generic error when there is no answer at all', () => {
        const auth = useAuth()
        const generic = vi.spyOn(auth, 'showGenericError')

        expect(() => auth.showResMsgOrGenericError({ status: 0 })).not.toThrow()
        expect(generic).toHaveBeenCalled()
    })

    it('still shows the server message when there is one', () => {
        const auth = useAuth()
        const error = vi.spyOn(auth, 'showError')

        auth.showResMsgOrGenericError({ status: 401, data: { msg: 'Wrong password' } })

        expect(error).toHaveBeenCalledWith('Wrong password')
    })
})
