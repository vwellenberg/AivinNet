import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The editor is a form over the request functions: the test drives it the way
// a user does (fields, operators, values, submit) and checks the body that
// leaves the component, and what it shows when the server refuses it.
const { createMock, updateMock, pushMock } = vi.hoisted(() => ({
    createMock: vi.fn(),
    updateMock: vi.fn(),
    pushMock: vi.fn(),
}))

vi.mock('@/requests/smartPlaylists', () => ({
    createSmartPlaylist: createMock,
    updateSmartPlaylist: updateMock,
}))

vi.mock('vue-router', async importOriginal => ({
    ...(await importOriginal<typeof import('vue-router')>()),
    useRouter: () => ({ push: pushMock }),
}))

import SmartPlaylistEditor from '@/components/modals/SmartPlaylistEditor.vue'

const saved = {
    id: 9,
    name: 'Jazz from the 90s',
    match: 'all',
    rules: [],
    limit: 100,
    sort: { field: 'date_added', order: 'desc' },
    created: 1_700_000_000,
    updated: 1_700_000_000,
}

beforeEach(() => {
    setActivePinia(createPinia())
    createMock.mockReset()
    updateMock.mockReset()
    pushMock.mockReset()
})

describe('SmartPlaylistEditor', () => {
    it('builds a body with two rules and submits it', async () => {
        createMock.mockResolvedValue({ ok: true, value: saved })
        const w = mount(SmartPlaylistEditor)

        await w.find('#smart-name').setValue('Jazz from the 90s')

        // Rule 1: genre is Jazz (the default row).
        await w.find('[name="rule-1-value"]').setValue('Jazz')

        // Rule 2: year between 1990 and 1999. Changing the field first, then the
        // operator, then the two values, the way the form is used.
        await w.find('.se-add').trigger('click')
        await w.find('[name="rule-2-field"]').setValue('year')
        await w.find('[name="rule-2-op"]').setValue('between')
        await w.find('[name="rule-2-value"]').setValue('1990')
        await w.find('[name="rule-2-high"]').setValue('1999')

        await w.find('form').trigger('submit')
        await flushPromises()

        expect(createMock).toHaveBeenCalledTimes(1)
        expect(createMock).toHaveBeenCalledWith({
            name: 'Jazz from the 90s',
            match: 'all',
            rules: [
                { field: 'genre', op: 'is', value: 'Jazz' },
                { field: 'year', op: 'between', value: [1990, 1999] },
            ],
            limit: 100,
            sort: { field: 'date_added', order: 'desc' },
        })
        // A new playlist opens on its own page.
        expect(pushMock).toHaveBeenCalledWith({ name: 'SmartPlaylistView', params: { smartid: 9 } })
    })

    it('shows the refusal the server answers with, and keeps the form', async () => {
        createMock.mockResolvedValue({
            ok: false,
            error: 'rule 2 (year between): low (2000) is above high (1990)',
        })
        const w = mount(SmartPlaylistEditor)

        await w.find('#smart-name').setValue('Broken')
        await w.find('[name="rule-1-value"]').setValue('Jazz')
        await w.find('form').trigger('submit')
        await flushPromises()

        expect(w.find('[role="alert"]').text()).toBe('rule 2 (year between): low (2000) is above high (1990)')
        expect(pushMock).not.toHaveBeenCalled()
        expect((w.find('#smart-name').element as HTMLInputElement).value).toBe('Broken')
    })

    it('says what is wrong before it sends anything', async () => {
        const w = mount(SmartPlaylistEditor)

        await w.find('form').trigger('submit')
        await flushPromises()

        expect(createMock).not.toHaveBeenCalled()
        expect(w.find('[role="alert"]').text()).toBe('Give the smart playlist a name')
    })
})
