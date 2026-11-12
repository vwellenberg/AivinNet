import type { RouteLocationRaw, Router } from 'vue-router'

/**
 * What a closing modal does with the history entry it pushed when it opened
 * (`modal.vue`: Back closes a modal instead of leaving the page).
 *
 * - Nothing to go to: pop the entry, so history stays as it was.
 * - A destination (`modal.closeAndNavigate`): REPLACE the entry with it. Popping
 *   and then pushing races: the pop's popstate arrives while the push is still
 *   loading the page and cancels it. That is how "Open" in the library check
 *   closed the dialog and stayed where it was.
 */
export function leaveModal(router: Pick<Router, 'push' | 'replace'>, to: RouteLocationRaw | null, pushed: boolean) {
    const onOwnEntry = pushed && !!history.state?.aivinnetModal

    if (to) {
        if (onOwnEntry) {
            // vue-router's replace MERGES the entry's state: without this the
            // destination would carry the mark, and a later close on that page
            // would take it for its own entry and go Back from a real page.
            history.replaceState({ ...history.state, aivinnetModal: false }, '')
            void router.replace(to)
        } else {
            void router.push(to)
        }
        return
    }
    if (onOwnEntry) history.back()
}
