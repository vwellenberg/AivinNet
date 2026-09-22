import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import ContextMenu from '../ContextMenu.vue'
import ContextItem from '../Contextmenu/ContextItem.vue'
import { contextChildrenShowMode } from '@/enums'
import useContextStore from '@/stores/context'

// ---------------------------------------------------------------------------
// The context menu, by keyboard (#137). Before this the `…` buttons were real
// buttons and opened a menu the keyboard could see and never enter: its items
// were <div @click>, with no role, no tab stop and no keys.
// ---------------------------------------------------------------------------

const flush = async () => {
    for (let i = 0; i < 4; i += 1) await nextTick()
    // The menu focuses once the item is visible (utils/focusWhenVisible.ts).
    await new Promise(resolve => setTimeout(resolve, 50))
    await nextTick()
}

function press(el: Element, key: string) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
}

describe('the menu', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
    })

    async function openWith(options: object[]) {
        const trigger = document.createElement('button')
        document.body.appendChild(trigger)
        trigger.focus()

        const wrapper = mount(ContextMenu, { attachTo: document.body })
        const context = useContextStore()
        context.options = options as never
        context.visible = true
        await flush()
        return { wrapper, context, trigger }
    }

    it('takes focus when it opens', async () => {
        const { wrapper } = await openWith([{ label: 'Play next' }, { label: 'Add to queue' }])
        expect(document.activeElement?.textContent).toContain('Play next')
        wrapper.unmount()
    })

    it('moves with the arrows, wraps, and skips separators', async () => {
        const { wrapper } = await openWith([{ label: 'One' }, { type: 'separator' }, { label: 'Two' }])

        press(document.activeElement as Element, 'ArrowDown')
        expect(document.activeElement?.textContent).toContain('Two')
        press(document.activeElement as Element, 'ArrowDown')
        expect(document.activeElement?.textContent).toContain('One')
        press(document.activeElement as Element, 'ArrowUp')
        expect(document.activeElement?.textContent).toContain('Two')

        // The separator is not an item at all.
        expect(wrapper.find('[role="separator"]').attributes('tabindex')).toBeUndefined()
        wrapper.unmount()
    })

    it('does its item on Enter, closes, and hands focus back to what opened it', async () => {
        const action = vi.fn()
        const { wrapper, context, trigger } = await openWith([{ label: 'Play next', action }])

        press(document.activeElement as Element, 'Enter')
        await flush()

        expect(action).toHaveBeenCalledOnce()
        expect(context.visible).toBe(false)
        expect(document.activeElement).toBe(trigger)
        wrapper.unmount()
    })

    it('closes on Escape without doing anything', async () => {
        const action = vi.fn()
        const { wrapper, context, trigger } = await openWith([{ label: 'Delete', action }])

        press(document.activeElement as Element, 'Escape')
        await flush()

        expect(action).not.toHaveBeenCalled()
        expect(context.visible).toBe(false)
        expect(document.activeElement).toBe(trigger)
        wrapper.unmount()
    })

    it('keeps its keys from the global shortcuts', async () => {
        // Arrows seek and change volume in helpers/useKeyboard.ts, on window.
        const { wrapper } = await openWith([{ label: 'One' }, { label: 'Two' }])
        const seen = vi.fn()
        window.addEventListener('keydown', seen)

        press(document.activeElement as Element, 'ArrowDown')

        expect(seen).not.toHaveBeenCalled()
        window.removeEventListener('keydown', seen)
        wrapper.unmount()
    })
})

describe('a submenu', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
    })

    it('opens on ArrowRight into its first item, and ArrowLeft returns one level', async () => {
        const pick = vi.fn()
        const wrapper = mount(ContextItem, {
            attachTo: document.body,
            props: {
                option: {
                    label: 'Add to playlist',
                    children: async () => [{ label: 'Mix' }, { type: 'separator' }, { label: 'Road trip', action: pick }],
                },
                childrenShowMode: contextChildrenShowMode.click,
            },
        })
        const item = wrapper.find('[role="menuitem"]').element as HTMLElement
        item.focus()
        expect(item.getAttribute('aria-haspopup')).toBe('menu')

        press(item, 'ArrowRight')
        await flush()
        expect(document.activeElement?.textContent).toContain('Mix')
        expect(item.getAttribute('aria-expanded')).toBe('true')

        press(document.activeElement as Element, 'ArrowDown')
        expect(document.activeElement?.textContent).toContain('Road trip')

        press(document.activeElement as Element, 'ArrowLeft')
        await flush()
        expect(document.activeElement).toBe(item)

        wrapper.unmount()
    })
})
