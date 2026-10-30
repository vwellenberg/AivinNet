import { mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { describe, expect, it } from 'vitest'

import { logoFor, SEASON_KEY, useSeasonLogo } from '@/utils/seasonLogo'
import type { Season } from '@/utils/seasons'

describe('logoFor', () => {
    it('gives each season its own picture and the planet otherwise', () => {
        const planet = logoFor(null)
        expect(planet).toContain('logo-subspaceradio')
        expect(logoFor('halloween')).toContain('logo-halloween')
        expect(logoFor('christmas')).toContain('logo-christmas')
    })
})

describe('useSeasonLogo', () => {
    const Probe = defineComponent({
        setup() {
            const src = useSeasonLogo()
            return () => h('img', { src: src.value })
        },
    })

    it('follows the season App.vue provides, also when it changes', async () => {
        const season = ref<Season | null>('halloween')
        const wrapper = mount(Probe, { global: { provide: { [SEASON_KEY as symbol]: season } } })
        expect(wrapper.find('img').attributes('src')).toContain('logo-halloween')
        season.value = null
        await wrapper.vm.$nextTick()
        expect(wrapper.find('img').attributes('src')).toContain('logo-subspaceradio')
    })

    it('shows the planet where nothing provides a season', () => {
        expect(mount(Probe).find('img').attributes('src')).toContain('logo-subspaceradio')
    })
})
