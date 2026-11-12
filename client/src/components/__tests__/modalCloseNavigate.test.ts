import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouter, createWebHashHistory, Router } from 'vue-router'

// "Open" in the library check closed the dialog and stayed on the page. The
// modal host pushes a history entry when a modal opens (so Back closes it) and
// popped it with history.back() on close. The dialog closed and then pushed the
// album route: the pop's popstate arrived while the album page was still
// loading and cancelled the navigation. The test runs the real host, the real
// dialog and a real router whose album route loads asynchronously, as it does.
vi.mock('@/requests/metadata', () => ({
    getAuditAlbums: vi.fn().mockResolvedValue({
        albums: [
            {
                key: '/music/Games/Kenshi/\u0000Kenshi',
                albumhash: '55ea5c7acad59b8f',
                title: 'Kenshi',
                albumartists: ['Unknown'],
                folder: '/music/Games/Kenshi/',
                trackcount: 238,
                reasons: ['unknown_artist'],
                fragments: 1,
                merge_candidates: [],
            },
        ],
        ignored: 0,
    }),
    ignoreAuditAlbum: vi.fn(),
    mergeAuditAlbum: vi.fn(),
}))

import ModalHost from '@/components/modal.vue'
import useModal from '@/stores/modal'

const Page = { template: '<div />' }

function makeRouter(): Router {
    return createRouter({
        history: createWebHashHistory(),
        routes: [
            { path: '/', name: 'Home', component: Page },
            {
                path: '/albums/:albumhash',
                name: 'AlbumView',
                component: Page,
                // Like the real route: the page loads before the navigation ends.
                beforeEnter: () => new Promise(resolve => setTimeout(() => resolve(true), 30)),
            },
            { path: '/playlists/:pid', name: 'PlaylistView', component: Page },
            { path: '/refused', name: 'Refused', component: Page, beforeEnter: () => false },
        ],
    })
}

async function settle() {
    for (let i = 0; i < 10; i++) {
        await flushPromises()
        await new Promise(resolve => setTimeout(resolve, 20))
    }
}

describe('closing a modal to go somewhere', () => {
    // ONE router for the file: every router listens to the window's popstate,
    // and one per test left the earlier ones navigating along.
    const router = makeRouter()

    beforeEach(async () => {
        setActivePinia(createPinia())
        await router.push('/')
        await router.isReady()
    })

    afterEach(() => {
        useModal().$reset()
    })

    it('"Open" in the library check lands on the album', async () => {
        const w = mount(ModalHost, { global: { plugins: [router] }, attachTo: document.body })
        useModal().showLibraryAuditModal()
        await settle()

        const open = w.findAll('button').find(b => b.text().startsWith('Open'))
        expect(open).toBeDefined()
        await open!.trigger('click')
        await settle()

        expect(useModal().visible).toBe(false)
        expect(router.currentRoute.value.fullPath).toBe('/albums/55ea5c7acad59b8f')
        w.unmount()
    })

    it('replaces the entry the modal pushed: Back from the album returns to the page under the modal', async () => {
        const w = mount(ModalHost, { global: { plugins: [router] }, attachTo: document.body })
        const modal = useModal()
        modal.showModal(-1 as never)
        await settle()
        expect(history.state?.aivinnetModal).toBe(true)

        modal.closeAndNavigate({ name: 'AlbumView', params: { albumhash: 'aaaaaaaaaaaaaaaa' } })
        await settle()
        expect(router.currentRoute.value.name).toBe('AlbumView')
        // vue-router's replace merges the old state; the mark must not come along.
        expect(history.state?.aivinnetModal).toBeFalsy()

        router.back()
        await settle()
        expect(router.currentRoute.value.fullPath).toBe('/')
        w.unmount()
    })

    it('still pops its own entry when closed with nowhere to go', async () => {
        const w = mount(ModalHost, { global: { plugins: [router] }, attachTo: document.body })
        const modal = useModal()
        modal.showModal(-1 as never)
        await settle()
        expect(history.state?.aivinnetModal).toBe(true)

        modal.hideModal()
        await settle()
        expect(history.state?.aivinnetModal).toBeFalsy()
        expect(router.currentRoute.value.fullPath).toBe('/')
        w.unmount()
    })

    it('a locked modal neither closes nor navigates', async () => {
        const w = mount(ModalHost, { global: { plugins: [router] }, attachTo: document.body })
        const modal = useModal()
        modal.showModal(-1 as never)
        modal.setLocked(true)
        await settle()

        modal.closeAndNavigate({ name: 'PlaylistView', params: { pid: 3 } })
        await settle()

        expect(modal.visible).toBe(true)
        expect(modal.navigateTo).toBeNull()
        expect(router.currentRoute.value.fullPath).toBe('/')
        w.unmount()
    })

    it('a close-and-go on a modal the user already dismissed still goes, and leaves nothing pending', async () => {
        const w = mount(ModalHost, { global: { plugins: [router] }, attachTo: document.body })
        const modal = useModal()
        modal.showModal(-1 as never)
        await settle()
        modal.hideModal() // the backdrop, while the dialog was still saving
        await settle()

        modal.closeAndNavigate({ name: 'PlaylistView', params: { pid: 7 } })
        await settle()
        expect(router.currentRoute.value.fullPath).toBe('/playlists/7')
        expect(modal.navigateTo).toBeNull()

        // The next, unrelated close goes nowhere.
        await router.push('/')
        modal.showModal(-1 as never)
        await settle()
        modal.hideModal()
        await settle()
        expect(router.currentRoute.value.fullPath).toBe('/')
        w.unmount()
    })

    it('a refused destination leaves no copy of the page behind in history', async () => {
        const w = mount(ModalHost, { global: { plugins: [router] }, attachTo: document.body })
        const modal = useModal()
        const before = history.length
        modal.showModal(-1 as never)
        await settle()

        modal.closeAndNavigate({ name: 'Refused' })
        await settle()

        expect(router.currentRoute.value.fullPath).toBe('/')
        expect(history.state?.aivinnetModal).toBeFalsy()
        // Back from here leaves this page instead of landing on a copy of it.
        expect(history.state?.current).toBe('/')
        expect(history.length).toBeGreaterThanOrEqual(before)
        w.unmount()
    })
})
