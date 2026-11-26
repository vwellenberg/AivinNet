import type { LocationQueryRaw, Router } from 'vue-router'

import { Routes } from '@/router'
import { focusAcrossNavigation } from '@/utils/focusAcrossNavigation'

/**
 * Open the search page on a phone with the field focused AND the keyboard up,
 * so the user can type at once.
 *
 * On a phone the search field exists only on the search page (NavBar.vue), so
 * the push comes first and the focus waits for the field to render. iOS opens
 * no keyboard for that late focus — focusAcrossNavigation holds it open with a
 * stand-in input focused inside the tap. Every way into search on a phone
 * goes through here: the page title in the top bar (#603, #916) and the Search
 * entry of the bottom bar, which used to be a plain link and opened the page
 * with the keyboard closed (user, 2026-11-26).
 *
 * Must be called synchronously from the tap/click handler.
 */
export function openSearchFocused(router: Router, query?: LocationQueryRaw): Promise<boolean> {
    return focusAcrossNavigation(
        () => router.push({ name: Routes.search, params: { page: 'top' }, query }),
        () => document.getElementById('globalsearch'),
    )
}
