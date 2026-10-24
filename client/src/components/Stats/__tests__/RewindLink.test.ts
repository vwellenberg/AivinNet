import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/router', () => ({ Routes: { Rewind: 'RewindView' } }))

import RewindLink from '@/components/Stats/RewindLink.vue'

// RouterLink as a plain anchor that shows where it goes.
const stubs = { RouterLink: { props: ['to'], template: '<a :data-to="JSON.stringify(to)"><slot /></a>' } }

const link = (year: number | null | undefined) => mount(RewindLink, { props: { year }, global: { stubs } })

// The stats page hands down the latest finished year: the way to Rewind stays
// at the foot of the page, seen or not (#572).
describe('RewindLink', () => {
    it('names the latest finished year and goes there', () => {
        const a = link(2025).find('a')

        expect(a.text()).toBe('Your 2025 Rewind')
        expect(JSON.parse(a.attributes('data-to')!)).toEqual({ name: 'RewindView', params: { year: 2025 } })
    })

    it('is not there before a year with music has ended, or while the years are unknown', () => {
        expect(link(undefined).find('a').exists()).toBe(false)
        expect(link(null).find('a').exists()).toBe(false)
    })
})
