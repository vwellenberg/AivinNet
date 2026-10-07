import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import Select from '../Select.vue'

// A segmented select cannot shrink, and four segments (the Colour scheme,
// #395) are wider than a phone's settings row: measured 428px of content in a
// 340px pane, every row cut off on the right. `is-many` is what lets the
// stylesheet stack them two by two there — no class, no stacking.
const options = (n: number) =>
    ['memphis', 'lagune', 'terrakotta', 'eierschale'].slice(0, n).map((v) => ({ title: v, value: v }))

function render(n: number) {
    return mount(Select, { props: { options: options(n), source: () => 'memphis', setterFn: () => {} } })
}

describe('Select', () => {
    it('marks a select with more than three options', () => {
        expect(render(4).classes()).toContain('is-many')
    })

    it('leaves two and three options a plain strip', () => {
        expect(render(2).classes()).not.toContain('is-many')
        expect(render(3).classes()).not.toContain('is-many')
    })

    it('still renders one pressable segment per option', () => {
        const buttons = render(4).findAll('button.option')
        expect(buttons).toHaveLength(4)
        expect(buttons[0].attributes('aria-pressed')).toBe('true')
    })
})
