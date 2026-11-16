import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/stores/notification', () => ({
    NotifType: { Success: 'success', Error: 'error' },
    useToast: () => ({ showNotification: vi.fn() }),
}))

import home from '@/settings/home'
import useAuth from '@/stores/auth'
import useSettings from '@/stores/settings'
import { SettingType } from '@/settings/enums'

// Settings → Home (#532) for the guest account: one account shared by every
// guest, refused the layout write by the server (403). The rows would only
// lead to "Could not save your Home rows", so they are not listed; the
// AivinNet FM switch is per device and stays.
describe('Settings → Home', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
    })

    // What the pane lists for an account: Group.vue drops settings whose show_if says no.
    const shownTo = (roles: string[] | undefined) => {
        useAuth().user.roles = roles as string[]
        return home.groups
            .flatMap(group => group.settings)
            .filter(setting => (setting.show_if ? setting.show_if() : true))
            .map(setting => setting.type)
    }

    it('lists the rows to every account of its own', () => {
        for (const roles of [['admin'], ['user'], undefined]) {
            expect(shownTo(roles)).toContain(SettingType.home_rows)
            expect(shownTo(roles)).toContain(SettingType.home_not_interested)
        }
    })

    it('gives the guest account only the per-device AivinNet FM switch', () => {
        expect(home.show_if).toBeUndefined()
        expect(shownTo(['guest'])).toEqual([SettingType.binary])
    })

    it('switches AivinNet FM on and off, off to begin with', () => {
        const radio = home.groups.flatMap(group => group.settings).find(setting => setting.title === 'AivinNet FM')
        expect(radio).toBeDefined()
        expect(radio!.state!()).toBe(false)

        radio!.action()
        expect(radio!.state!()).toBe(true)
        expect(useSettings().show_radio).toBe(true)
    })
})
