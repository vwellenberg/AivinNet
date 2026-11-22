import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import KeyboardShortcuts from '../KeyboardShortcuts.vue'
import { SHORTCUTS } from '@/utils/shortcuts'

describe('Settings → General → Keyboard shortcuts', () => {
    it('lists every shortcut from the shared list, and names the ? key', () => {
        const wrapper = mount(KeyboardShortcuts)
        const text = wrapper.text()

        expect(SHORTCUTS.length).toBeGreaterThan(10)
        for (const s of SHORTCUTS) expect(text).toContain(s.description)
        expect(text).toContain('Press ? on any page')
    })

    it('renders its keys as kbd chips, not buttons', () => {
        const wrapper = mount(KeyboardShortcuts)
        expect(wrapper.findAll('kbd').length).toBeGreaterThan(10)
        expect(wrapper.findAll('button')).toHaveLength(0)
    })
})
