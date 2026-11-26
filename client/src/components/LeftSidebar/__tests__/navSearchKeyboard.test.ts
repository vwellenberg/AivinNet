import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

// ---------------------------------------------------------------------------
// The Search entry of the phone's bottom bar was a plain link: the search page
// opened with its field unfocused and the keyboard closed, so every search took
// a second tap into the field (user, 2026-11-26). The top bar's title already
// opened search with the keyboard up (openSearchFocused, #603). Now the bottom
// bar's entry goes the same way, and only that entry: the others stay links.
// ---------------------------------------------------------------------------

// vi.mock is hoisted above every declaration, so its state is too.
const { mobile, openSearchFocused } = vi.hoisted(() => ({
    mobile: { value: true },
    openSearchFocused: vi.fn((..._args: unknown[]) => Promise.resolve(true)),
}))
vi.mock('@/stores/content-width', () => ({ isMobile: mobile }))
vi.mock('@/utils/openSearch', () => ({ openSearchFocused }))

import { Routes } from '@/router'
import NavButtons from '../NavButtons.vue'

const Blank = { template: '<div />' }

function makeRouter() {
    return createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/', name: Routes.Home, component: Blank },
            { path: '/search/:page', name: Routes.search, component: Blank },
            { path: '/favorites', name: Routes.favorites, component: Blank },
            { path: '/playlists', name: Routes.playlists, component: Blank },
            { path: '/folder/:path', name: Routes.folder, component: Blank },
        ],
    })
}

async function mountNav() {
    const router = makeRouter()
    await router.push('/')
    await router.isReady()
    const wrapper = mount(NavButtons, {
        global: { plugins: [router] },
        attachTo: document.body,
    })
    return { router, wrapper }
}

const link = (wrapper: Awaited<ReturnType<typeof mountNav>>['wrapper'], name: string) =>
    wrapper.findAll('a.nav-item').find((a) => a.text().trim().toLowerCase() === name)!

beforeEach(() => {
    setActivePinia(createPinia())
    mobile.value = true
    openSearchFocused.mockClear()
})

afterEach(() => {
    document.body.innerHTML = ''
})

describe('phone bottom bar: Search opens with the keyboard up', () => {
    it('a tap on Search goes through openSearchFocused, inside the tap', async () => {
        const { router, wrapper } = await mountNav()
        const search = link(wrapper, 'search')
        expect(search, 'Search entry missing from the phone bar').toBeTruthy()

        await search.trigger('click', { button: 0 })

        expect(openSearchFocused).toHaveBeenCalledTimes(1)
        expect(openSearchFocused.mock.calls[0][0]).toBe(router)
        // The link itself did not navigate on top of it (that would be a second push).
        await flushPromises()
        expect(router.currentRoute.value.name).toBe(Routes.Home)
    })

    it('keeps the query, so a search in progress is still there', async () => {
        const { wrapper } = await mountNav()
        await link(wrapper, 'search').trigger('click', { button: 0 })
        expect(openSearchFocused.mock.calls[0][1]).toHaveProperty('q')
    })

    it('every other entry stays a plain link', async () => {
        const { router, wrapper } = await mountNav()
        await link(wrapper, 'favorites').trigger('click', { button: 0 })
        await flushPromises()
        expect(openSearchFocused).not.toHaveBeenCalled()
        expect(router.currentRoute.value.name).toBe(Routes.favorites)
    })

    it('a modified click (new tab) is left to the link', async () => {
        const { wrapper } = await mountNav()
        await link(wrapper, 'search').trigger('click', { button: 0, ctrlKey: true })
        expect(openSearchFocused).not.toHaveBeenCalled()
    })

    it('still marks the current page for assistive tech', async () => {
        const { wrapper } = await mountNav()
        expect(link(wrapper, 'home').attributes('aria-current')).toBe('page')
        expect(link(wrapper, 'search').attributes('aria-current')).toBeUndefined()
    })
})
