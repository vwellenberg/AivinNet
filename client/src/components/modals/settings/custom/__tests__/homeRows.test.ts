import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Settings → Home (#532): what the panel sends, and what it does when the
// server says no.
const { getHomeLayout, setHomeLayout, refreshIfLoaded, showError } = vi.hoisted(() => ({
    getHomeLayout: vi.fn(),
    setHomeLayout: vi.fn(),
    refreshIfLoaded: vi.fn(),
    showError: vi.fn(),
}))

vi.mock('@/requests/home', () => ({ getHomeLayout, setHomeLayout }))
vi.mock('@/stores/home', () => ({ default: () => ({ refreshIfLoaded }) }))
vi.mock('@/stores/notification', () => ({ useToast: () => ({ showError }) }))

import HomeRows from '@/components/modals/settings/custom/HomeRows.vue'

// As GET /nothome/layout sends them.
const ROWS = [
    { key: 'continue_listening', title: 'Continue listening', description: '', visible: true, pinned: true },
    { key: 'your_mixes', title: 'Your mixes', description: 'Made from what you play together', visible: true, pinned: false },
    { key: 'recently_played', title: 'Recently played', description: '', visible: true, pinned: false },
    { key: 'collections', title: 'Collections', description: 'The collection pages you made', visible: true, pinned: false },
]

const ok = (rows: unknown) => ({ status: 200, data: { rows } })
const mounted: ReturnType<typeof mount>[] = []

async function panel() {
    const w = mount(HomeRows, { attachTo: document.body })
    mounted.push(w)
    await flushPromises()
    return w
}

const titles = (w: ReturnType<typeof mount>) => w.findAll('.layout-row-title').map(t => t.text())

// The server answers with what it kept: here, exactly what it was sent.
const kept = (order: string[], hidden: string[]) =>
    ok((order.length ? order : ROWS.map(r => r.key)).map(key => ({ ...ROWS.find(r => r.key === key)!, visible: !hidden.includes(key) })))

/** Holds the next save on its way until the returned function lets it land. */
function holdNextSave() {
    let release!: () => void
    setHomeLayout.mockImplementationOnce(
        (order: string[], hidden: string[]) => new Promise(resolve => (release = () => resolve(kept(order, hidden))))
    )
    return () => release()
}

beforeEach(() => {
    getHomeLayout.mockReset().mockResolvedValue(ok(ROWS))
    setHomeLayout.mockReset().mockImplementation(async (order: string[], hidden: string[]) => kept(order, hidden))
    refreshIfLoaded.mockReset()
    showError.mockReset()
})

afterEach(() => {
    mounted.splice(0).forEach(w => w.unmount())
})

describe('Settings → Home', () => {
    it('lists every row, the pinned one without a grip', async () => {
        const w = await panel()

        expect(titles(w)).toEqual(['Continue listening', 'Your mixes', 'Recently played', 'Collections'])
        expect(w.findAll('.layout-row-grip')).toHaveLength(3)
        expect(w.text()).toContain('Always on top')
    })

    it('hides a row with its switch and sends the whole layout', async () => {
        const w = await panel()

        await w.find('[aria-label="Show Recently played on Home"]').trigger('click')
        await flushPromises()

        expect(setHomeLayout).toHaveBeenLastCalledWith(
            ['continue_listening', 'your_mixes', 'recently_played', 'collections'],
            ['recently_played']
        )
        expect(w.find('[aria-label="Show Recently played on Home"]').attributes('aria-checked')).toBe('false')
    })

    it('moves a row with the arrow keys on its grip', async () => {
        const w = await panel()

        await w.findAll('.layout-row-grip')[2].trigger('keydown', { key: 'ArrowUp' })
        await flushPromises()

        expect(setHomeLayout).toHaveBeenLastCalledWith(
            ['continue_listening', 'your_mixes', 'collections', 'recently_played'],
            []
        )
        expect(titles(w)).toEqual(['Continue listening', 'Your mixes', 'Collections', 'Recently played'])
    })

    it('does not move the first movable row above the pinned one', async () => {
        const w = await panel()

        await w.findAll('.layout-row-grip')[0].trigger('keydown', { key: 'ArrowUp' })
        await flushPromises()

        expect(setHomeLayout).not.toHaveBeenCalled()
    })

    it('puts the last kept layout back when the server refuses', async () => {
        setHomeLayout.mockResolvedValue({ status: 500, data: null })
        const w = await panel()

        await w.find('[aria-label="Show Your mixes on Home"]').trigger('click')
        await flushPromises()

        expect(showError).toHaveBeenCalled()
        expect(w.find('[aria-label="Show Your mixes on Home"]').attributes('aria-checked')).toBe('true')
        expect(refreshIfLoaded).not.toHaveBeenCalled()
    })

    it('sends a quick second change after the first instead of dropping it', async () => {
        const release = holdNextSave()
        const w = await panel()

        await w.find('[aria-label="Show Your mixes on Home"]').trigger('click')
        await w.find('[aria-label="Show Collections on Home"]').trigger('click')
        expect(setHomeLayout).toHaveBeenCalledTimes(1)

        release()
        await flushPromises()

        expect(setHomeLayout).toHaveBeenCalledTimes(2)
        expect(setHomeLayout).toHaveBeenLastCalledWith(
            ['continue_listening', 'your_mixes', 'recently_played', 'collections'],
            ['your_mixes', 'collections']
        )
    })

    it('resets to the default by sending an empty layout', async () => {
        const w = await panel()

        await w.find('.home-rows-reset').trigger('click')
        await flushPromises()

        expect(setHomeLayout).toHaveBeenLastCalledWith([], [])
    })

    it('sends a reset made while a save is on its way as a reset', async () => {
        const release = holdNextSave()
        const w = await panel()

        await w.find('[aria-label="Show Your mixes on Home"]').trigger('click')
        await w.find('.home-rows-reset').trigger('click')
        release()
        await flushPromises()

        expect(setHomeLayout).toHaveBeenCalledTimes(2)
        expect(setHomeLayout).toHaveBeenLastCalledWith([], [])
    })

    it('lets no change undo a reset that is still on its way', async () => {
        const release = holdNextSave()
        const w = await panel()

        await w.find('.home-rows-reset').trigger('click')
        await w.find('[aria-label="Show Your mixes on Home"]').trigger('click')
        await w.findAll('.layout-row-grip')[1].trigger('keydown', { key: 'ArrowUp' })
        release()
        await flushPromises()

        expect(setHomeLayout).toHaveBeenCalledTimes(1)
        expect(setHomeLayout).toHaveBeenLastCalledWith([], [])
        // And once the default is back, the panel takes changes again.
        await w.find('[aria-label="Show Your mixes on Home"]').trigger('click')
        await flushPromises()
        expect(setHomeLayout).toHaveBeenCalledTimes(2)
    })

    it('has Home refreshed, so the change shows without a reload', async () => {
        const w = await panel()

        await w.find('[aria-label="Show Your mixes on Home"]').trigger('click')
        await flushPromises()

        expect(refreshIfLoaded).toHaveBeenCalledTimes(1)
    })

    it('finishes what it was sending when Settings closes', async () => {
        const release = holdNextSave()
        const w = await panel()

        await w.find('[aria-label="Show Your mixes on Home"]').trigger('click')
        await w.find('[aria-label="Show Collections on Home"]').trigger('click')
        w.unmount()
        mounted.splice(mounted.indexOf(w), 1)
        release()
        await flushPromises()

        expect(setHomeLayout).toHaveBeenLastCalledWith(
            ['continue_listening', 'your_mixes', 'recently_played', 'collections'],
            ['your_mixes', 'collections']
        )
        expect(refreshIfLoaded).toHaveBeenCalledTimes(1)
    })

    it('says so when the rows cannot be loaded', async () => {
        getHomeLayout.mockResolvedValue({ status: 500, data: null })

        const w = await panel()

        expect(w.text()).toContain('could not be loaded')
        expect(w.findAll('.layout-row')).toHaveLength(0)
    })
})
