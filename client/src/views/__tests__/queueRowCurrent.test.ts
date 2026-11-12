import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// "ladders" is queued twice, at positions 1 and 5. Each test says which one plays.
const playing = vi.hoisted(() => ({ index: 1 }))
vi.mock('@/stores/queue', () => ({
    default: () => ({ currentindex: playing.index, currenttrackhash: 'ladders', playing: true }),
}))
vi.mock('@/helpers/contextMenuHandler', () => ({
    showTrackContextMenu: () => {},
}))
vi.mock('vue-router', async () => {
    const actual = await vi.importActual<typeof import('vue-router')>('vue-router')
    return { ...actual, useRoute: () => ({ path: '/nowplaying/home' }) }
})

import SongItem from '@/components/shared/SongItem.vue'
import { Track } from '@/interfaces'
import { buildQueueRows, QueueLayout, QueueRow } from '@/views/NowPlaying/queueRow'

// ---------------------------------------------------------------------------
// A queue can hold the same track twice. The Now Playing list then highlighted
// BOTH rows: the view passed `isQueueTrack`, the row's prop is `is_queue_track`,
// and without it the row compares trackhashes instead of positions.
// ---------------------------------------------------------------------------

const track = (hash: string) =>
    ({
        trackhash: hash,
        title: `Track ${hash}`,
        album: 'An album',
        albumhash: 'alb',
        artists: [],
        albumartists: [],
        duration: 120,
    }) as unknown as Track

const QUEUE = ['once', 'ladders', 'perfecto', 'selfcare', 'wings', 'ladders', 'small'].map(track)

const layout = (over: Partial<QueueLayout> = {}): QueueLayout => ({
    split: true,
    historyOpen: false,
    wraps: false,
    showCurrent: true,
    ...over,
})

/** The rows as a reader sees them: captions by label, tracks by number + hash. */
const outline = (rows: QueueRow[]) =>
    rows.map(row => {
        if (row.kind === 'caption') return `# ${row.text}${row.count ? ` (${row.count})` : ''}`
        if (row.kind === 'note') return `~ ${row.text}`
        return `${row.props.index}. ${row.props.track.trackhash}`
    })

/** Which track rows the real component marks as current. */
function currentRows(rows: QueueRow[]) {
    return rows.flatMap(row =>
        row.kind === 'track'
            ? [mount(SongItem, { shallow: true, props: row.props }).classes().includes('current')]
            : []
    )
}

beforeEach(() => setActivePinia(createPinia()))
afterEach(() => vi.restoreAllMocks())

describe('the Now Playing queue', () => {
    it('highlights the playing position only, not every copy of the track', () => {
        playing.index = 1
        // The whole list, as shuffle shows it — both copies are on screen.
        const rows = buildQueueRows(QUEUE, 1, layout({ split: false }))
        expect(currentRows(rows)).toEqual([false, true, false, false, false, false, false])
    })

    it('still highlights one row when the history is unfolded', () => {
        playing.index = 5
        const rows = buildQueueRows(QUEUE, 5, layout({ historyOpen: true }))
        // Position 5 plays; its twin at position 1 sits in the played section.
        expect(currentRows(rows)).toEqual([false, false, false, false, false, true, false])
    })
})

describe('the split queue', () => {
    it('folds what played, then shows the current track and counts what follows from 1', () => {
        expect(outline(buildQueueRows(QUEUE, 2, layout()))).toEqual([
            '# Played (2)',
            '# Now playing',
            '1. perfecto',
            '# Up next (4)',
            '1. selfcare',
            '2. wings',
            '3. ladders',
            '4. small',
        ])
    })

    it('unfolds the played tracks above the current one', () => {
        const rows = buildQueueRows(QUEUE, 2, layout({ historyOpen: true }))
        expect(outline(rows).slice(0, 4)).toEqual(['# Played (2)', '1. once', '2. ladders', '# Now playing'])
        expect(rows[0]).toMatchObject({ open: true })
    })

    it('leaves the current row to the player card on a phone', () => {
        expect(outline(buildQueueRows(QUEUE, 2, layout({ showCurrent: false }))).slice(0, 3)).toEqual([
            '# Played (2)',
            '# Up next (4)',
            '1. selfcare',
        ])
    })

    it('has no played section on the first track', () => {
        expect(outline(buildQueueRows(QUEUE, 0, layout()))[0]).toBe('# Now playing')
    })

    it('says so when nothing follows, and that repeat-all starts over', () => {
        const last = QUEUE.length - 1
        expect(outline(buildQueueRows(QUEUE, last, layout())).slice(-2)).toEqual([
            '# Up next',
            '~ Nothing queued after this one.',
        ])
        expect(outline(buildQueueRows(QUEUE, last, layout({ wraps: true }))).at(-1)).toMatch(/starts over/)
    })

    it('keeps every row addressed by its queue position', () => {
        // Display numbers restart per section; play and drag must not use them.
        const tracks = buildQueueRows(QUEUE, 2, layout({ historyOpen: true })).filter(r => r.kind === 'track')
        expect(tracks.map(r => r.queueIndex)).toEqual([0, 1, 2, 3, 4, 5, 6])
        expect(tracks.map(r => r.props.queue_index)).toEqual([0, 1, 2, 3, 4, 5, 6])
    })

    it('frames each section on its own', () => {
        const tracks = buildQueueRows(QUEUE, 2, layout()).filter(r => r.kind === 'track')
        expect(tracks.map(r => [r.props.is_first, r.props.is_last])).toEqual([
            [true, true],
            [true, false],
            [false, false],
            [false, false],
            [false, true],
        ])
    })

    it('shows the whole list under shuffle, where list order is not play order', () => {
        const rows = buildQueueRows(QUEUE, 2, layout({ split: false }))
        expect(rows.every(r => r.kind === 'track')).toBe(true)
        expect(rows).toHaveLength(QUEUE.length)
    })

    it('does not split on a position outside the list', () => {
        expect(buildQueueRows([], 0, layout())).toEqual([])
        expect(buildQueueRows(QUEUE, 99, layout()).every(r => r.kind === 'track')).toBe(true)
    })
})
