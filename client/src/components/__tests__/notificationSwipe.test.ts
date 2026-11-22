import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Notification from '@/components/Notification.vue'
import { NotifType, useToast } from '@/stores/notification'

// Swipe a toast aside (phones): far enough and it is gone, a short drag springs
// back, and the click that ends a swipe never counts as a tap on the toast.

function pointer(type: string, clientX: number, target: EventTarget = window, clientY = 500) {
    const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY })
    Object.defineProperty(ev, 'pointerId', { value: 1 })
    Object.defineProperty(ev, 'pointerType', { value: 'touch' })
    target.dispatchEvent(ev)
    return ev
}

async function showToast(text: string, onClick?: () => void) {
    const store = useToast()
    const wrapper = mount(Notification, { attachTo: document.body })
    store.showNotification(text, NotifType.Success, undefined, onClick)
    await wrapper.vm.$nextTick()
    const el = wrapper.get('.new-notif').element as HTMLElement
    // jsdom lays nothing out; the toast is 18rem wide on screen.
    Object.defineProperty(el, 'offsetWidth', { value: 288 })
    return { store, wrapper, el }
}

describe('swiping a toast', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
        document.body.innerHTML = ''
    })

    it('far enough sideways throws it away', async () => {
        const { store, wrapper, el } = await showToast('Song removed')

        pointer('pointerdown', 100, el)
        for (let x = 110; x <= 220; x += 10) pointer('pointermove', x)
        await wrapper.vm.$nextTick()
        expect(el.style.transform).toBe('translateX(120px)')
        expect(el.classList).toContain('is-swiping')

        pointer('pointerup', 220)
        await wrapper.vm.$nextTick()
        // It slides out first, then leaves the store.
        expect(el.classList).not.toContain('is-swiping')
        expect(store.notifs).toHaveLength(1)
        vi.advanceTimersByTime(250)
        expect(store.notifs).toHaveLength(0)
    })

    it('works to the left as well', async () => {
        const { store, el } = await showToast('Song removed')

        pointer('pointerdown', 300, el)
        for (let x = 290; x >= 180; x -= 10) pointer('pointermove', x)
        pointer('pointerup', 180)
        vi.advanceTimersByTime(250)
        expect(store.notifs).toHaveLength(0)
    })

    it('a short drag springs back and keeps the toast', async () => {
        const { store, wrapper, el } = await showToast('Song removed')

        pointer('pointerdown', 100, el)
        pointer('pointermove', 110)
        pointer('pointermove', 120)
        pointer('pointerup', 120)
        await wrapper.vm.$nextTick()
        vi.advanceTimersByTime(250)

        expect(store.notifs).toHaveLength(1)
        expect(el.style.transform).toBe('')
    })

    it('the click that ends a swipe does not open a clickable toast', async () => {
        const onClick = vi.fn()
        const { store, wrapper, el } = await showToast('Playlist created', onClick)

        pointer('pointerdown', 100, el)
        pointer('pointermove', 110)
        pointer('pointermove', 120)
        pointer('pointerup', 120)
        // The browser fires the click after pointerup (a pointer click: detail 1).
        await wrapper.get('.new-notif').trigger('click', { detail: 1 })

        expect(onClick).not.toHaveBeenCalled()
        expect(store.notifs).toHaveLength(1)

        // A real tap afterwards still works.
        pointer('pointerdown', 100, el)
        pointer('pointerup', 100)
        await wrapper.get('.new-notif').trigger('click', { detail: 1 })
        expect(onClick).toHaveBeenCalledOnce()
    })

    it('a toast that timed out under the finger does not hand the release click to the next one', async () => {
        const onClick = vi.fn()
        const store = useToast()
        const wrapper = mount(Notification, { attachTo: document.body })
        store.showNotification('Playlist created', NotifType.Success, undefined, onClick)
        const goneId = store.showNotification('Song removed', NotifType.Success)
        await wrapper.vm.$nextTick()
        const dragged = wrapper.findAll('.new-notif')[1].element as HTMLElement

        pointer('pointerdown', 100, dragged)
        pointer('pointermove', 115)
        pointer('pointermove', 125)
        store.dismiss(goneId) // its timeout fires mid-drag
        await wrapper.vm.$nextTick()
        pointer('pointerup', 125)
        await wrapper.get('.new-notif').trigger('click', { detail: 1 })

        expect(onClick).not.toHaveBeenCalled()
        expect(store.notifs).toHaveLength(1)
    })

    it('a keyboard click is never swallowed by a leftover gesture', async () => {
        const onClick = vi.fn()
        const { el, wrapper } = await showToast('Playlist created', onClick)

        // A short swipe whose release click never arrives.
        pointer('pointerdown', 100, el)
        pointer('pointermove', 115)
        pointer('pointerup', 115)
        await wrapper.get('.new-notif').trigger('click', { detail: 0 })
        expect(onClick).toHaveBeenCalledOnce()
    })

    it('the click after a rejected vertical drag does not dismiss', async () => {
        const { store, wrapper, el } = await showToast('Song removed')

        pointer('pointerdown', 100, el, 500)
        pointer('pointermove', 101, window, 470)
        pointer('pointerup', 101, window, 470)
        await wrapper.get('.new-notif').trigger('click', { detail: 1 })
        expect(store.notifs).toHaveLength(1)
    })

    it('a vertical move is not a swipe', async () => {
        const { store, wrapper, el } = await showToast('Song removed')

        pointer('pointerdown', 100, el, 500)
        pointer('pointermove', 102, window, 440)
        pointer('pointermove', 200, window, 440)
        pointer('pointerup', 200, window, 440)
        await wrapper.vm.$nextTick()
        vi.advanceTimersByTime(250)

        expect(el.style.transform).toBe('')
        expect(store.notifs).toHaveLength(1)
    })

    it('a cancelled gesture springs back', async () => {
        const { store, wrapper, el } = await showToast('Song removed')

        pointer('pointerdown', 100, el)
        for (let x = 110; x <= 250; x += 10) pointer('pointermove', x)
        pointer('pointercancel', 250)
        await wrapper.vm.$nextTick()
        vi.advanceTimersByTime(250)

        expect(store.notifs).toHaveLength(1)
        expect(el.style.transform).toBe('')
    })
})
