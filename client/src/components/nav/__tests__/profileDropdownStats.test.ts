import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ref } from 'vue'

// ---------------------------------------------------------------------------
// Stats on the phone (user, 2026-11-25/26): the phone's bottom bar has no
// Stats entry, and the only way there was the recap card on Mondays and the
// 1st — the user landed on Stats once and could not find it again. A button at
// the end of Home (#921) read as out of place, so it lives in the account
// menu: Stats is the user's own listening.
// ---------------------------------------------------------------------------

const { push } = vi.hoisted(() => ({ push: vi.fn() }))

vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/router', () => ({ Routes: { Stats: 'StatsView' } }))
vi.mock('@/stores/content-width', async () => {
    const { ref } = await import('vue')
    return { isMobile: ref(false) }
})
vi.mock('@/requests/settings/rootdirs', () => ({ triggerScan: vi.fn() }))
vi.mock('@/assets/icons/chart.svg', () => ({ default: {} }))
vi.mock('@/assets/icons/logout.svg', () => ({ default: {} }))
vi.mock('@/assets/icons/reload.svg', () => ({ default: {} }))
vi.mock('@/assets/icons/settings.svg', () => ({ default: {} }))

import ProfileDropdown from '@/components/nav/ProfileDropdown.vue'
import { isMobile } from '@/stores/content-width'

// A computed in the app, a plain ref in the mock above: writable here.
const phone = isMobile as unknown as Ref<boolean>

beforeEach(() => {
    setActivePinia(createPinia())
    push.mockReset()
    phone.value = false
})

describe('Stats in the account menu', () => {
    it('is an entry on a phone, and opens Stats and closes the menu', async () => {
        phone.value = true
        const w = mount(ProfileDropdown)

        const entry = w.find('button.item.stats')
        expect(entry.exists()).toBe(true)
        expect(entry.text()).toBe('Your stats')

        await entry.trigger('click')
        expect(push).toHaveBeenCalledWith({ name: 'StatsView' })
        expect(w.emitted('close')).toHaveLength(1)
    })

    it('stands first, before Settings', () => {
        phone.value = true
        const labels = mount(ProfileDropdown)
            .findAll('button.item')
            .map(b => b.text())
        expect(labels.indexOf('Your stats')).toBe(0)
        expect(labels.indexOf('Your stats')).toBeLessThan(labels.indexOf('Settings'))
    })

    it('is not there on desktop: the sidebar has Stats', () => {
        expect(mount(ProfileDropdown).find('button.item.stats').exists()).toBe(false)
    })
})
