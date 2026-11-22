import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

vi.mock('@/stores/queue', () => ({ default: () => ({ play: vi.fn(), playTrackNext: vi.fn() }) }))
vi.mock('@/stores/queue/tracklist', () => ({ default: () => ({ setFromSearch: vi.fn() }) }))
vi.mock('@/requests/searchMusic', () => ({ searchTracks: vi.fn() }))

import QuickPlay from '../QuickPlay.vue'
import { closeQuickPlay, openQuickPlay } from '@/stores/quickPlay'

// The footer of the box names its keys, from the same list as the ? overlay.
describe('QuickPlay footer hint', () => {
    let wrapper: VueWrapper | null = null

    afterEach(() => {
        wrapper?.unmount()
        wrapper = null
        document.body.innerHTML = ''
        closeQuickPlay()
    })

    it('shows the box keys with their actions', async () => {
        wrapper = mount(QuickPlay, { attachTo: document.body })
        openQuickPlay()
        await nextTick()

        const hint = document.querySelector('.qp-hint')
        expect(hint).not.toBeNull()
        expect(hint!.textContent).toBe('Enter play · Shift+Enter play next · Esc close')
    })
})
