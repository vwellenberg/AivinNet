import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Notification, NotifType, useToast } from '@/stores/notification'

describe('notification store', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('shows a plain toast for 3s and removes it by id', () => {
        const store = useToast()

        store.showNotification('Saved', NotifType.Success)
        expect(store.notifs).toHaveLength(1)

        vi.advanceTimersByTime(2999)
        expect(store.notifs).toHaveLength(1)

        vi.advanceTimersByTime(1)
        expect(store.notifs).toHaveLength(0)
    })

    it('keeps action toasts for 8s', () => {
        const store = useToast()

        store.showNotification('Album cover updated', NotifType.Success, {
            label: 'Undo',
            handler: () => undefined,
        })

        vi.advanceTimersByTime(3000)
        expect(store.notifs).toHaveLength(1)

        vi.advanceTimersByTime(5000)
        expect(store.notifs).toHaveLength(0)
    })

    it('removes toasts by id, not FIFO, with mixed timeouts', () => {
        const store = useToast()

        // Action toast (8s) first, then a plain toast (3s). A shift()-based
        // removal would kill the action toast when the plain one expires.
        store.showNotification('With action', NotifType.Info, { label: 'Undo', handler: () => undefined })
        store.showNotification('Plain', NotifType.Info)

        vi.advanceTimersByTime(3000)
        expect(store.notifs).toHaveLength(1)
        expect(store.notifs[0].text).toBe('With action')

        vi.advanceTimersByTime(5000)
        expect(store.notifs).toHaveLength(0)
    })

    it('dismiss removes a specific toast immediately', () => {
        const store = useToast()

        store.showNotification('One', NotifType.Info)
        store.showNotification('Two', NotifType.Info)

        store.dismiss(store.notifs[0].id)

        expect(store.notifs).toHaveLength(1)
        expect(store.notifs[0].text).toBe('Two')
    })

    it('the Notification helper forwards the action', () => {
        const store = useToast()
        const handler = vi.fn()

        new Notification('Undoable', NotifType.Success, { label: 'Undo', handler })

        expect(store.notifs).toHaveLength(1)
        expect(store.notifs[0].action?.label).toBe('Undo')
        store.notifs[0].action?.handler()
        expect(handler).toHaveBeenCalledOnce()
    })
})
