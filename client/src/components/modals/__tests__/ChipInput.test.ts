import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ChipInput from '@/components/modals/ChipInput.vue'

describe('ChipInput', () => {
    it('renders the existing chips', () => {
        const w = mount(ChipInput, { props: { modelValue: ['Alpha', 'Beta'] } })
        expect(w.findAll('.chip').length).toBe(2)
    })

    it('adds a trimmed chip on Enter and emits the new array', async () => {
        const w = mount(ChipInput, { props: { modelValue: [] } })
        const input = w.find('input')
        await input.setValue('  Queen  ')
        await input.trigger('keydown', { key: 'Enter' })
        expect(w.emitted('update:modelValue')?.[0]).toEqual([['Queen']])
    })

    it('adds a chip on comma too', async () => {
        const w = mount(ChipInput, { props: { modelValue: ['Queen'] } })
        const input = w.find('input')
        await input.setValue('Bowie')
        await input.trigger('keydown', { key: ',' })
        expect(w.emitted('update:modelValue')?.[0]).toEqual([['Queen', 'Bowie']])
    })

    it('ignores empty and duplicate values', async () => {
        const w = mount(ChipInput, { props: { modelValue: ['Queen'] } })
        const input = w.find('input')
        await input.setValue('Queen')
        await input.trigger('keydown', { key: 'Enter' })
        await input.setValue('   ')
        await input.trigger('keydown', { key: 'Enter' })
        expect(w.emitted('update:modelValue')).toBeUndefined()
    })

    it('removes a chip via its × button', async () => {
        const w = mount(ChipInput, { props: { modelValue: ['Alpha', 'Beta'] } })
        await w.findAll('.chip-x')[0].trigger('click')
        expect(w.emitted('update:modelValue')?.[0]).toEqual([['Beta']])
    })

    it('removes the last chip on Backspace when the input is empty', async () => {
        const w = mount(ChipInput, { props: { modelValue: ['Alpha', 'Beta'] } })
        await w.find('input').trigger('keydown', { key: 'Backspace' })
        expect(w.emitted('update:modelValue')?.[0]).toEqual([['Alpha']])
    })
})
