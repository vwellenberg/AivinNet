import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Downloading an album track by track instead of as one ZIP.
//
// Two properties are worth pinning, and neither is visible by reading the loop:
//
// 1. The downloads are SEQUENTIAL, one every 400ms. A burst of anchor clicks
//    looks to a browser like a popup attack (it throttles or silently drops
//    them), and the server answers one request at a time — a whole album fired
//    at once queues every other listener behind it. A refactor to
//    `Promise.all(...)` would read cleaner and break both.
// 2. Every anchor is put in the document and taken out again. A detached anchor
//    works for ONE click in most browsers but not for a series of them, and an
//    anchor left behind per track litters the DOM of a page that never reloads.
// ---------------------------------------------------------------------------

vi.mock('@/config', () => ({
    getBaseUrl: () => '',
    paths: { api: { download: '/download' } },
}))

const notify = vi.fn()

vi.mock('@/stores/notification', () => ({
    NotifType: { Info: 'info', Error: 'error', Success: 'success' },
    Notification: class {
        constructor(text: string, type = 'info') {
            notify(text, type)
        }
    },
}))

import { downloadTracksIndividually } from '@/helpers/downloadTracks'

const track = (trackhash: string) => ({ trackhash }) as any

/** Anchors are clicked, not navigated — jsdom would otherwise warn per click. */
let clicked: string[] = []
/** How many anchors sat in the document at the moment of each click. */
let anchorsInDom: number[] = []

beforeEach(() => {
    clicked = []
    anchorsInDom = []
    notify.mockClear()
    vi.useFakeTimers()

    // On HTMLElement, where `click` actually lives — an anchor only inherits it.
    vi.spyOn(HTMLElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push(this.getAttribute('href') || '')
        anchorsInDom.push(document.body.querySelectorAll('a').length)
    })
})

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
})

describe('downloadTracksIndividually', () => {
    it('downloads one file per track, in order, from the single-track route', async () => {
        const done = downloadTracksIndividually([track('aaa'), track('bbb'), track('ccc')], 'Test Album')

        await vi.runAllTimersAsync()
        await done

        expect(clicked).toEqual(['/download/track/aaa', '/download/track/bbb', '/download/track/ccc'])
    })

    it('waits between downloads instead of firing them all at once', async () => {
        const done = downloadTracksIndividually([track('aaa'), track('bbb'), track('ccc')], 'Test Album')

        // Let the synchronous part of the loop run: exactly ONE download may
        // have started before any timer fires.
        await Promise.resolve()
        expect(clicked).toEqual(['/download/track/aaa'])

        await vi.advanceTimersByTimeAsync(400)
        expect(clicked).toEqual(['/download/track/aaa', '/download/track/bbb'])

        await vi.runAllTimersAsync()
        await done
    })

    it('clicks each anchor while it is in the document, and leaves none behind', async () => {
        const done = downloadTracksIndividually([track('aaa'), track('bbb')], 'Test Album')

        await vi.runAllTimersAsync()
        await done

        // One anchor present at each click — in the document (so the click
        // counts) and the previous one already removed (so nothing piles up).
        expect(anchorsInDom).toEqual([1, 1])
        expect(document.body.querySelectorAll('a').length).toBe(0)
    })

    it('says so and downloads nothing when there are no tracks', async () => {
        await downloadTracksIndividually([], 'Empty Album')

        expect(clicked).toEqual([])
        expect(notify).toHaveBeenCalledTimes(1)
        expect(notify.mock.calls[0][1]).toBe('error')
    })

    it('counts downloads as STARTED, never as finished', async () => {
        const done = downloadTracksIndividually([track('aaa'), track('bbb')], 'Test Album')

        await vi.runAllTimersAsync()
        await done

        // A browser download started from an anchor is fire-and-forget: the page
        // is never told whether it succeeded. Claiming "2 downloaded" would be a
        // promise this code cannot keep, so both notifications say "start".
        const texts = notify.mock.calls.map(call => String(call[0]))
        expect(texts).toHaveLength(2)
        for (const text of texts) {
            expect(text.toLowerCase()).toMatch(/start/)
            expect(text.toLowerCase()).not.toMatch(/downloaded|complete|finished/)
        }
    })
})

// ---------------------------------------------------------------------------
// Census: wherever a menu offers the ZIP, it must offer the loose files too.
//
// The ZIP is the right shape on a desktop and the wrong one on a phone, where
// it lands in Downloads, needs an unzip app, and leaves the tracks somewhere
// the music player may never index. Offering only the ZIP in a NEW menu would
// be invisible in review — nothing about that file would look unfinished.
//
// Scoped to the context menus: the playlist page header also carries a ZIP
// button, and its sibling lives in the overflow menu on the same header rather
// than as a second button in the row.
// ---------------------------------------------------------------------------
describe('download options', () => {
    const MENUS = import.meta.glob('/src/context_menus/*.ts', { as: 'raw', eager: true }) as Record<string, string>

    // The quoted LABEL, so the prose above these options in the source (which
    // has to say "ZIP" to explain itself) cannot satisfy the rule.
    const ZIP = /label:\s*["']Download as ZIP["']/
    const SEPARATE = /label:\s*["']Download as files["']/

    it('finds the menus it is supposed to be checking', () => {
        const offering = Object.keys(MENUS).filter(file => ZIP.test(MENUS[file]))
        expect(offering).toEqual(expect.arrayContaining(['/src/context_menus/album.ts', '/src/context_menus/playlist.ts']))
    })

    it('pairs every ZIP option with a track-by-track one', () => {
        for (const [file, source] of Object.entries(MENUS)) {
            if (!ZIP.test(source)) continue
            expect(SEPARATE.test(source), `${file} offers the ZIP but no track-by-track download`).toBe(true)
        }
    })
})
