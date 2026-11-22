import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Track } from '@/interfaces'
import { createQuickPlay, QUICK_PLAY_DEBOUNCE_MS } from '../quickPlay'

// Realistic enough for the helper: it only reads title and trackhash here.
const track = (title: string): Track =>
    ({
        title,
        trackhash: `hash-${title}`,
        album: 'Some Album',
        artists: [{ name: 'Some Artist', artisthash: 'a', image: '', trackcount: 1, albumcount: 1, duration: 1 }],
    }) as unknown as Track

interface Pending {
    query: string
    resolve: (tracks: Track[]) => void
    reject: (err: unknown) => void
}

// A search that resolves only when the test says so.
function controllableSearch() {
    const pending: Pending[] = []
    const search = vi.fn(
        (query: string) =>
            new Promise<{ results: Track[]; more: boolean }>((resolve, reject) => {
                pending.push({
                    query,
                    resolve: tracks => resolve({ results: tracks, more: false }),
                    reject,
                })
            })
    )
    const last = (query: string) => {
        const hit = [...pending].reverse().find(p => p.query === query)
        if (!hit) throw new Error(`no pending search for "${query}"`)
        return hit
    }
    return { search, pending, last }
}

function setup() {
    const s = controllableSearch()
    const deps = {
        search: s.search,
        playNow: vi.fn(),
        playNext: vi.fn(),
        close: vi.fn(),
    }
    const qp = createQuickPlay(deps)
    return { ...s, deps, qp }
}

describe('quick play helper', () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it('debounces the search and lists the best match first', async () => {
        const { qp, search, last } = setup()
        const best = track('Blue Monday')
        const other = track('Blue Velvet')

        qp.setQuery('blue')
        expect(search).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(QUICK_PLAY_DEBOUNCE_MS)
        expect(search).toHaveBeenCalledWith('blue')

        last('blue').resolve([best, other])
        await vi.runAllTimersAsync()
        expect(qp.visible.value[0]).toEqual(best)
        expect(qp.selected.value).toBe(0)
    })

    it('lists at most six rows', async () => {
        const { qp, last } = setup()
        qp.setQuery('x')
        await vi.advanceTimersByTimeAsync(QUICK_PLAY_DEBOUNCE_MS)
        last('x').resolve(Array.from({ length: 9 }, (_, i) => track(`t${i}`)))
        await vi.runAllTimersAsync()
        expect(qp.visible.value).toHaveLength(6)
        expect(qp.results.value).toHaveLength(9)
    })

    it('moves the selection with the arrows and clamps it to the visible rows', async () => {
        const { qp, last } = setup()
        qp.setQuery('x')
        await vi.advanceTimersByTimeAsync(QUICK_PLAY_DEBOUNCE_MS)
        last('x').resolve([track('a'), track('b'), track('c')])
        await vi.runAllTimersAsync()

        qp.move(1)
        expect(qp.selected.value).toBe(1)
        qp.move(10)
        expect(qp.selected.value).toBe(2)
        qp.move(-10)
        expect(qp.selected.value).toBe(0)
    })

    it('ignores a late answer for an older query', async () => {
        const { qp, last } = setup()
        const stale = track('Bad')
        const fresh = track('Blue')

        qp.setQuery('b')
        await vi.advanceTimersByTimeAsync(QUICK_PLAY_DEBOUNCE_MS)
        qp.setQuery('blue')
        await vi.advanceTimersByTimeAsync(QUICK_PLAY_DEBOUNCE_MS)

        last('blue').resolve([fresh])
        await vi.runAllTimersAsync()
        last('b').resolve([stale])
        await vi.runAllTimersAsync()

        expect(qp.results.value).toEqual([fresh])
    })

    it('does not show the old list once the text has changed', async () => {
        const { qp, last } = setup()
        qp.setQuery('a')
        await vi.advanceTimersByTimeAsync(QUICK_PLAY_DEBOUNCE_MS)
        last('a').resolve([track('Apple')])
        await vi.runAllTimersAsync()
        expect(qp.visible.value).toHaveLength(1)

        // Typing again must not leave a stale answer that a late response could overwrite.
        qp.setQuery('ap')
        last('a').resolve([track('Other')])
        await vi.runAllTimersAsync()
        expect(qp.results.value[0]?.title).toBe('Apple')
    })

    it('Enter while the search for the current text is pending plays that search, once it answers', async () => {
        const { qp, deps, last, search } = setup()
        const blue = track('Blue Monday')

        qp.setQuery('blue')
        await vi.advanceTimersByTimeAsync(QUICK_PLAY_DEBOUNCE_MS)
        expect(search).toHaveBeenCalledTimes(1)

        const done = qp.confirm()
        // Still pending: Enter must not send a second request nor play anything yet.
        expect(search).toHaveBeenCalledTimes(1)
        expect(deps.playNow).not.toHaveBeenCalled()

        last('blue').resolve([blue])
        await done
        expect(deps.playNow).toHaveBeenCalledWith('blue', [blue], 0)
        expect(deps.close).toHaveBeenCalledTimes(1)
    })

    it('Enter during the debounce flushes the search for the current text', async () => {
        const { qp, deps, last, search } = setup()
        const blue = track('Blue Monday')

        qp.setQuery('blue')
        const done = qp.confirm()
        expect(search).toHaveBeenCalledWith('blue')

        last('blue').resolve([blue])
        await done
        expect(deps.playNow).toHaveBeenCalledWith('blue', [blue], 0)
    })

    it('never plays a result of an earlier, shorter query when Enter comes first', async () => {
        const { qp, deps, last } = setup()
        const bad = track('Bad Romance')
        const blue = track('Blue Monday')

        qp.setQuery('b')
        await vi.advanceTimersByTimeAsync(QUICK_PLAY_DEBOUNCE_MS)
        last('b').resolve([bad])
        await vi.runAllTimersAsync()

        // The user types on; the debounce for "blue" is still running.
        qp.setQuery('blue')
        const done = qp.confirm()
        last('blue').resolve([blue])
        await done

        expect(deps.playNow).toHaveBeenCalledTimes(1)
        expect(deps.playNow).toHaveBeenCalledWith('blue', [blue], 0)
    })

    it('plays the row the arrows selected', async () => {
        const { qp, deps, last } = setup()
        const [a, b, c] = [track('a'), track('b'), track('c')]
        qp.setQuery('x')
        await vi.advanceTimersByTimeAsync(QUICK_PLAY_DEBOUNCE_MS)
        last('x').resolve([a, b, c])
        await vi.runAllTimersAsync()

        qp.move(1)
        qp.move(1)
        await qp.confirm()
        expect(deps.playNow).toHaveBeenCalledWith('x', [a, b, c], 2)
    })

    it('Shift+Enter inserts the track next instead of playing the list', async () => {
        const { qp, deps, last } = setup()
        const best = track('Best')
        qp.setQuery('best')
        await vi.advanceTimersByTimeAsync(QUICK_PLAY_DEBOUNCE_MS)
        last('best').resolve([best])
        await vi.runAllTimersAsync()

        await qp.confirm(true)
        expect(deps.playNext).toHaveBeenCalledWith(best)
        expect(deps.playNow).not.toHaveBeenCalled()
        expect(deps.close).toHaveBeenCalledTimes(1)
    })

    it('does nothing on empty input', async () => {
        const { qp, deps, search } = setup()
        qp.setQuery('   ')
        await qp.confirm()
        await vi.runAllTimersAsync()
        expect(search).not.toHaveBeenCalled()
        expect(deps.playNow).not.toHaveBeenCalled()
        expect(deps.close).not.toHaveBeenCalled()
    })

    it('does nothing when there is no match, and keeps the box open', async () => {
        const { qp, deps, last } = setup()
        qp.setQuery('zzz')
        await vi.advanceTimersByTimeAsync(QUICK_PLAY_DEBOUNCE_MS)
        const done = qp.confirm()
        last('zzz').resolve([])
        await done

        expect(deps.playNow).not.toHaveBeenCalled()
        expect(deps.playNext).not.toHaveBeenCalled()
        expect(deps.close).not.toHaveBeenCalled()
    })

    it('a failed search plays nothing', async () => {
        const { qp, deps, last } = setup()
        qp.setQuery('boom')
        await vi.advanceTimersByTimeAsync(QUICK_PLAY_DEBOUNCE_MS)
        const done = qp.confirm()
        last('boom').reject(new Error('network'))
        await done
        expect(deps.playNow).not.toHaveBeenCalled()
        expect(qp.results.value).toEqual([])
    })

    // How the REAL search fails: `useAxios` never rejects. It resolves to
    // undefined when offline and to the error body on a 4xx/5xx.
    it.each([
        ['undefined (offline)', undefined],
        ['an error body (500)', { msg: 'Internal Server Error' }],
    ])('a search that resolves to %s reads as no match', async (_label, answer) => {
        const deps = { search: vi.fn(async () => answer as any), playNow: vi.fn(), playNext: vi.fn(), close: vi.fn() }
        const qp = createQuickPlay(deps)

        qp.setQuery('boom')
        await vi.advanceTimersByTimeAsync(QUICK_PLAY_DEBOUNCE_MS)
        await vi.runAllTimersAsync()
        expect(qp.results.value).toEqual([])
        expect(qp.visible.value).toEqual([])
        expect(qp.searching.value).toBe(false)

        await qp.confirm()
        expect(deps.playNow).not.toHaveBeenCalled()
        expect(deps.close).not.toHaveBeenCalled()
    })

    it('reset drops a pending answer so it cannot be played later', async () => {
        const { qp, deps, last } = setup()
        qp.setQuery('blue')
        await vi.advanceTimersByTimeAsync(QUICK_PLAY_DEBOUNCE_MS)
        qp.reset()
        last('blue').resolve([track('Blue')])
        await vi.runAllTimersAsync()
        expect(qp.results.value).toEqual([])
        expect(qp.query.value).toBe('')
        expect(deps.playNow).not.toHaveBeenCalled()
    })

    it('a second Enter while the first waits for its answer plays the song only once', async () => {
        // A held Enter repeats: each repeat started the song again from the top.
        const { qp, deps, last } = setup()
        const blue = track('Blue Monday')
        qp.setQuery('blue')
        await vi.advanceTimersByTimeAsync(QUICK_PLAY_DEBOUNCE_MS)

        const first = qp.confirm()
        const second = qp.confirm()
        last('blue').resolve([blue])
        await Promise.all([first, second])

        expect(deps.playNow).toHaveBeenCalledTimes(1)
        expect(deps.close).toHaveBeenCalledTimes(1)
    })

    it('counts as searching from the first keystroke, so an empty list does not read as "no match"', async () => {
        const { qp, last } = setup()
        qp.setQuery('zz')
        await vi.advanceTimersByTimeAsync(QUICK_PLAY_DEBOUNCE_MS)
        last('zz').resolve([])
        await vi.runAllTimersAsync()
        expect(qp.searching.value).toBe(false)

        // The debounce of the next keystroke: nothing answered yet, still searching.
        qp.setQuery('zzt')
        expect(qp.searching.value).toBe(true)
    })
})
