import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import RatingStars from '../RatingStars.vue'

// The five-star picker (#777): every star is a 44 px role button with an
// accessible name and a pressed state, and picking the current value clears it.
function stars(value: number | null) {
    return mount(RatingStars, { props: { value } })
}

describe('RatingStars', () => {
    it('renders five named star buttons', () => {
        const wrapper = stars(null)
        const buttons = wrapper.findAll('button')

        expect(buttons).toHaveLength(5)
        expect(buttons[0].attributes('aria-label')).toBe('1 of 5 stars')
        expect(buttons[4].attributes('aria-label')).toBe('5 of 5 stars')
    })

    it('marks the current value as pressed and fills the stars up to it', () => {
        const wrapper = stars(3)
        const buttons = wrapper.findAll('button')

        expect(buttons[2].attributes('aria-pressed')).toBe('true')
        expect(buttons[3].attributes('aria-pressed')).toBe('false')
        expect(buttons.map(b => b.classes('filled'))).toEqual([true, true, true, false, false])
    })

    it('emits the picked value when another star is tapped', async () => {
        const wrapper = stars(2)

        await wrapper.findAll('button')[4].trigger('click')

        expect(wrapper.emitted('pick')).toEqual([[5]])
    })

    it('emits null when the current value is tapped again, which clears the rating', async () => {
        const wrapper = stars(4)

        await wrapper.findAll('button')[3].trigger('click')

        expect(wrapper.emitted('pick')).toEqual([[null]])
    })

    it('sets a first rating from the unrated state', async () => {
        const wrapper = stars(null)

        await wrapper.findAll('button')[0].trigger('click')

        expect(wrapper.emitted('pick')).toEqual([[1]])
    })
})
