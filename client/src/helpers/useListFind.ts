import { onBeforeUnmount, onMounted, watch } from 'vue'

import useContextMenu from '@/stores/context'
import useModal from '@/stores/modal'
import { focusWhenVisible } from '@/utils/focusWhenVisible'
import { registerPageFind } from '@/utils/pageFind'

/** How a page's list follows its find. */
export interface ListFindFollow {
    /** The page's query. */
    query: () => string
    /** The rows the page shows for it. */
    rows: () => unknown[]
    /**
     * Where the list is held while a query is set, until the reader scrolls:
     * - `'field'`: the field's row at the top of the list, matches right under
     *   it (the field is a row of the list, below a tall header: going to the
     *   very top would pull the header back and move the field mid-typing);
     * - `'top'`: the very top (the field is pinned and never leaves the screen).
     */
    at: 'field' | 'top'
}

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
 * @param fieldId    the `id` of the page's find `<input>`
 * @param scrollerId the `id` of the page's scroller: when the field has been
 *                   scrolled out of view (recycled), it scrolls back to the top
 * @param canFind    whether the page has something to search right now
 * @param follow     keeps the matches in view while the reader types
 */
export function useListFind(fieldId: string, scrollerId: string, canFind: () => boolean, follow?: ListFindFollow) {
    let disposed = false
    let frame = 0

    if (follow) {
        // Why "held" and not one scroll: when its rows change, vue-virtual-scroller
        // keeps the row that was at the top of the viewport in place
        // (useDynamicScroller's anchor). When the rest of the list arrives for a
        // search, the scroller follows that row into the middle of the matches.
        // Measured on a 150-track folder: typed at the top, landed at 1224 px with
        // the best match out of sight. The anchor is restored in a post-flush
        // watcher of the scroller, which runs after ours — hence the frame.
        let readerMoved = false
        let listening: HTMLElement | null = null
        const moved = (e: Event) => {
            // Keys typed into the find (Enter, arrows, Tab) live inside the
            // scroller too; they are not the reader moving the list.
            if (e.type === 'keydown' && (e.target as HTMLElement | null)?.closest?.('.list-find')) return
            readerMoved = true
        }
        const EVENTS = ['wheel', 'touchmove', 'keydown'] as const
        const listen = (scroller: HTMLElement | null) => {
            if (scroller === listening) return
            for (const ev of EVENTS) {
                listening?.removeEventListener(ev, moved)
                scroller?.addEventListener(ev, moved, { passive: true })
            }
            listening = scroller
        }

        const hold = () => {
            cancelAnimationFrame(frame)
            frame = requestAnimationFrame(() => {
                if (disposed || readerMoved) return
                const scroller = document.getElementById(scrollerId)
                if (!scroller) return
                let top = 0
                if (follow.at === 'field') {
                    const field = document.getElementById(fieldId)?.closest('.list-find')
                    if (field) {
                        const box = field.getBoundingClientRect()
                        const view = scroller.getBoundingClientRect()
                        // A little air above the field, so its frame is not cut.
                        top = Math.max(0, scroller.scrollTop + box.top - view.top - 8)
                    }
                }
                if (Math.abs(scroller.scrollTop - top) > 1) scroller.scrollTo({ top })
            })
        }

        watch(
            follow.query,
            q => {
                readerMoved = false
                listen(document.getElementById(scrollerId))
                if (q) hold()
            },
            { flush: 'post' }
        )

        watch(
            follow.rows,
            () => {
                if (follow.query()) hold()
            },
            { flush: 'post' }
        )

        onBeforeUnmount(() => listen(null))
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
            for (let i = 0; i < 30 && !field && !disposed; i += 1) {
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

    onBeforeUnmount(() => {
        // A frame still pending would scroll the NEXT page: album and favorites
        // share the scroller id `album-scroller`.
        disposed = true
        cancelAnimationFrame(frame)
        unregister()
    })

    return { openFind }
}
