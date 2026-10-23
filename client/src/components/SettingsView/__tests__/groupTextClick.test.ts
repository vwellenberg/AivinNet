import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Group from '@/components/SettingsView/Group.vue'
import { SettingGroup } from '@/interfaces/settings'
import { SettingType } from '@/settings/enums'

// A setting's title and description are clickable: they run its action. A
// panel setting that only shows a title over its panel has none — Settings →
// Home's "Not interested" (#531) was the first, and a click on its title threw
// "setting.action is not a function".
describe('the text of a setting', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
    })

    it('does nothing on a click when the setting has no action', async () => {
        const errorHandler = vi.fn()
        const w = mount(Group, {
            props: {
                // As settings/home.ts declares it: a title, and no action.
                group: {
                    title: 'Home',
                    settings: [{ type: SettingType.home_not_interested, title: 'Not interested', desc: 'What you hid' }],
                } as unknown as SettingGroup,
            },
            shallow: true,
            global: { config: { errorHandler } },
        })

        await w.find('.text').trigger('click')

        expect(errorHandler).not.toHaveBeenCalled()
    })

    it('runs the action of one that has one', async () => {
        const action = vi.fn()
        const w = mount(Group, {
            props: {
                group: {
                    title: 'Audio',
                    settings: [{ type: SettingType.binary, title: 'Crossfade', action, state: () => false }],
                } as SettingGroup,
            },
            shallow: true,
        })

        await w.find('.text').trigger('click')

        expect(action).toHaveBeenCalled()
    })
})
