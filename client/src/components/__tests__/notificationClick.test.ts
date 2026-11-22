import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Notification from '@/components/Notification.vue'
import { NotifType, useToast } from '@/stores/notification'

// A toast with `onClick` is itself the target ("Playlist created" → open it):
// a real <button>, so keyboard and screen reader get it for free. A plain toast
// goes away on a tap, and an action toast never becomes a button around its button.
describe('clickable toast', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
    })

    it('is a button that runs onClick and dismisses itself', async () => {
        const store = useToast()
        const onClick = vi.fn()
        const wrapper = mount(Notification)

        store.showNotification('Playlist created', NotifType.Success, undefined, onClick)
        await wrapper.vm.$nextTick()

        const toast = wrapper.get('.new-notif')
        expect(toast.element.tagName).toBe('BUTTON')
        expect(toast.attributes('type')).toBe('button')
        expect(toast.classes()).toContain('is-link')

        await toast.trigger('click')
        expect(onClick).toHaveBeenCalledOnce()
        expect(store.notifs).toHaveLength(0)
    })

    it('a plain toast is not a button, and a tap dismisses it', async () => {
        const store = useToast()
        const wrapper = mount(Notification)

        store.showNotification('Song removed', NotifType.Success)
        await wrapper.vm.$nextTick()

        const toast = wrapper.get('.new-notif')
        expect(toast.element.tagName).toBe('DIV')
        expect(toast.classes()).not.toContain('is-link')

        await toast.trigger('click')
        expect(store.notifs).toHaveLength(0)
    })

    it('a tap on an action toast outside its button dismisses it without the action', async () => {
        const store = useToast()
        const handler = vi.fn()
        const wrapper = mount(Notification)

        store.showNotification('Removed', NotifType.Info, { label: 'Undo', handler })
        await wrapper.vm.$nextTick()

        await wrapper.get('.notif-text').trigger('click')
        expect(handler).not.toHaveBeenCalled()
        expect(store.notifs).toHaveLength(0)
    })

    it('an action toast stays a div; its button runs only its own handler', async () => {
        const store = useToast()
        const handler = vi.fn()
        const onClick = vi.fn()
        const wrapper = mount(Notification)

        store.showNotification('Removed', NotifType.Info, { label: 'Undo', handler }, onClick)
        await wrapper.vm.$nextTick()

        expect(wrapper.get('.new-notif').element.tagName).toBe('DIV')
        await wrapper.get('.notif-action').trigger('click')
        expect(handler).toHaveBeenCalledOnce()
        expect(onClick).not.toHaveBeenCalled()
        expect(store.notifs).toHaveLength(0)
    })
})
