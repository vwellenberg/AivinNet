import { onBeforeUnmount, onMounted, watch } from 'vue'

import useContextMenu from '@/stores/context'
import useModal from '@/stores/modal'
import { focusWhenVisible } from '@/utils/focusWhenVisible'
import { registerPageFind } from '@/utils/pageFind'

/**
 * Cmd/Ctrl+F for a page whose list has its own find field (ListFind.vue).
 *
 * The browser's find only sees what is in the DOM, and every long list here is
 * virtual (only the rows in view exist) and often loads page by page — a track
 * further down was reported as not found. A page that calls this hands the
 * shortcut to its own field instead (utils/pageFind.ts).
 *
 * The browser's find stays when `canFind` says no (nothing to search, or a mode
 * whose list is a plain one) and while a modal or menu sits over the list.
 *
 * @param fieldId   the `id` of the page's find `<input>`
 * @param scrollerId the `id` of the page's scroller: when the field has been
 *                   scrolled out of view (recycled), it scrolls back to the top
 * @param canFind   whether the page has something to search right now
 * @param query     the page's query: each change scrolls the list back to the
 *                  top, where the best match is. A field that stays in view
 *                  (the folder head is pinned) would otherwise filter the list
 *                  and leave the reader somewhere in the middle of the matches.
 */
export function useListFind(fieldId: string, scrollerId: string, canFind: () => boolean, query?: () => string) {
    if (query) {
        watch(query, () => document.getElementById(scrollerId)?.scrollTo({ top: 0 }))
    }

    async function openFind(): Promise<void> {
        const scroller = document.getElementById(scrollerId)
        const visibleField = () => {
            const field = document.getElementById(fieldId) as HTMLInputElement | null
            if (!field || !scroller) return field
            // A recycled view can keep the field mounted while it sits outside
            // the viewport, so being in the DOM is not the same as being on screen.
            const box = field.getBoundingClientRect()
            const view = scroller.getBoundingClientRect()
            return box.bottom > view.top && box.top < view.bottom ? field : null
        }

        let field = visibleField()
        if (!field) {
            // Scrolled past the field. Its matches show from the top anyway, so
            // go there and wait for the scroller to render it.
            scroller?.scrollTo({ top: 0 })
            for (let frame = 0; frame < 30 && !field; frame += 1) {
                await new Promise(resolve => requestAnimationFrame(resolve))
                field = visibleField()
            }
        }
        if (await focusWhenVisible(field)) field?.select()
    }

    let unregister = () => {}

    onMounted(() => {
        unregister = registerPageFind(() => {
            if (!canFind()) return false
            // An open modal or menu sits over the list: the field behind it is
            // not what the user is looking at.
            if (useModal().visible || useContextMenu().visible) return false
            void openFind()
            return true
        })
    })

    onBeforeUnmount(() => unregister())

    return { openFind }
}
