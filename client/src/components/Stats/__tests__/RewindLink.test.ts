import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/router', () => ({ Routes: { Rewind: 'RewindView' } }))

import RewindLink from '@/components/Stats/RewindLink.vue'

// RouterLink as a plain anchor that shows where it goes.
const stubs = { RouterLink: { props: ['to'], template: '<a :data-to="JSON.stringify(to)"><slot /></a>' } }

const link = (fresh: number | null | undefined) => mount(RewindLink, { props: { fresh }, global: { stubs } })

// The stats page asks `/rewind/years` once and hands down `fresh`: the latest
// finished year while it is unseen (#572).
describe('RewindLink', () => {
    it('names the year still news and goes there', () => {
        const a = link(2025).find('a')

        expect(a.text()).toBe('Your 2025 Rewind')
        expect(JSON.parse(a.attributes('data-to')!)).toEqual({ name: 'RewindView', params: { year: 2025 } })
    })

    it('is gone once that year was seen to the end, before a year has ended, or without an answer', () => {
        // `fresh` is null when seen (or no finished year), undefined while the years are unknown.
        expect(link(null).find('a').exists()).toBe(false)
        expect(link(undefined).find('a').exists()).toBe(false)
    })
})
