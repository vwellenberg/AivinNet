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
        // The browser fires the click after pointerup.
        await wrapper.get('.new-notif').trigger('click')

        expect(onClick).not.toHaveBeenCalled()
        expect(store.notifs).toHaveLength(1)

        // A real tap afterwards still works.
        pointer('pointerdown', 100, el)
        pointer('pointerup', 100)
        await wrapper.get('.new-notif').trigger('click')
        expect(onClick).toHaveBeenCalledOnce()
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
