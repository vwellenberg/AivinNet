import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import QueueCaption from '../QueueCaption.vue'

// ---------------------------------------------------------------------------
// The end note row passes only `note`. Vue casts an absent boolean prop to
// `false`, so `open !== undefined` held and the note row drew the fold button
// of the "Played" caption: an empty plate with a lone "›" above the note.
// ---------------------------------------------------------------------------

describe('QueueCaption', () => {
    it('the end note draws no fold button and no caption', () => {
        const wrapper = mount(QueueCaption, { props: { note: 'Nothing queued after this one.' } })
        expect(wrapper.find('button').exists()).toBe(false)
        expect(wrapper.find('.queue-caption').exists()).toBe(false)
        expect(wrapper.find('.queue-note').text()).toBe('Nothing queued after this one.')
    })

    it('a plain caption draws no fold button', () => {
        const wrapper = mount(QueueCaption, { props: { text: 'Up next', count: 3 } })
        expect(wrapper.find('button').exists()).toBe(false)
        expect(wrapper.find('.queue-caption').text()).toContain('Up next')
    })

    it('a folded section still gets its fold button', () => {
        const wrapper = mount(QueueCaption, { props: { text: 'Played', count: 6, open: false } })
        const button = wrapper.find('button')
        expect(button.exists()).toBe(true)
        expect(button.attributes('aria-expanded')).toBe('false')
    })
})
