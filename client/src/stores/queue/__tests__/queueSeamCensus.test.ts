import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// Census: every queue mutation has to reach the device-sync seam.
//
// The rule itself is old ("in group mode EVERY queue action goes through
// `ds.intercept()`", CLAUDE.md + .claude/rules/device-sync.md). What was missing
// is a check that counts the mutations instead of naming them: `queue.groupmode`
// asserts a FIXED list of actions, so a new mutation that never learned about
// the seam stays green there. That is exactly how `insertAfterCurrent` — the
// "Play next" of five context menus — kept splicing the local list unnoticed
// while the server's queue_id stayed put: nothing re-mirrored, and the mirrored
// currentindex pointed at the wrong track on every other device (#434).
//
// So this test enumerates the mutations from the SOURCE and demands that each
// one either carries the seam itself or delegates to a sister action that does.
// A source-scanning test goes silently green when its parser breaks, so the
// first describe() below guards its own inputs (.claude/rules/testing.md).
// ---------------------------------------------------------------------------

// Read off disk, not through `import.meta.glob`: the runner's cwd is the
// project root, and the two more principled anchors do not work here —
// `import.meta.url` is left in a shape `fileURLToPath()` rejects, and
// `process.cwd()` trips `no-undef` (test files get no node env from eslint).
const TRACKLIST_FILE = 'src/stores/queue/tracklist.ts'
const QUEUE_FILE = 'src/stores/queue.ts'

const SOURCES: Record<string, string> = {
    [TRACKLIST_FILE]: readFileSync(TRACKLIST_FILE, 'utf-8'),
    [QUEUE_FILE]: readFileSync(QUEUE_FILE, 'utf-8'),
}

/**
 * A structural write to the queue: it changes WHICH tracks are in the list or
 * in what order — i.e. the trackhash list the server identifies by queue_id.
 *
 * Deliberately not matched: `setFav`/`retagTrack` write fields of a track
 * that is already in the list. They leave the trackhash sequence untouched, so
 * they cannot desync the group queue.
 */
const MUTATION = new RegExp(
    'this\\.tracklist\\s*(?:' +
        '=(?!=)' + // whole-list replacement
        '|\\.(?:splice|push|pop|shift|unshift|reverse|sort|fill|copyWithin)\\s*\\(' +
        '|\\[[^\\]]*\\]\\s*=(?!=)' + // writing a slot
        ')'
)

/**
 * The seam, with the guard and the intercept tied to the SAME store handle:
 *
 *     const ds = useDeviceSync()
 *     if (ds.joined && !ds.applying) { ds.intercept('insertTracks', …); return }
 */
const SEAM = /(\w+)\.joined\s*&&\s*!\s*\1\.applying[\s\S]{0,300}?\1\.intercept\s*\(/

/**
 * Actions that are allowed to write the list without a seam of their own, and
 * why. Anything not listed here has to carry the guard — the point of the
 * census is that adding a mutation forces a decision instead of a silent pass.
 */
const LOCAL_BY_DESIGN: Record<string, string> = {
    loadFromLocalStorage:
        'Boot hydration from localStorage, not a user edit. A device that reloads while joined ' +
        'is re-adopted by poll(), which resets queueId/lastMirroredHashKey and forces a full ' +
        're-mirror over whatever was hydrated (devicesync.ts::poll).',
    setNewList:
        'The queue-REPLACEMENT primitive, never an entry point. Its callers are the setFromX ' +
        'actions — always followed by queue.play(), whose seam broadcasts the whole new list ' +
        'via sendQueueSet (devicesync.ts::intercept "play") — and applyState, which IS the ' +
        'mirror and runs under `applying`. Broadcasting here as well is the "Queue ersetzen ist ' +
        'nicht Queue leeren" bug from .claude/rules/device-sync.md.',
    clearList:
        'Local primitive with two callers, both seamed: queue.clearQueue (intercept "clearQueue") ' +
        'and removeByIndex (intercept "removeTracks") for the last-track case.',
    shuffleList:
        'Local primitive; its only caller queue.shuffleQueue carries the seam (intercept ' +
        '"shuffleQueue"), which re-shuffles server-side so every device lands on the same order.',
}

interface Action {
    name: string
    body: string
}

/** Comments carry braces and the word `intercept` — strip them before parsing. */
function stripComments(source: string): string {
    return (
        source
            .replace(/\/\*[\s\S]*?\*\//g, '')
            // `[^:]` guards `https://` — a line comment never follows a colon here.
            .replace(/(^|[^:])\/\/.*$/gm, '$1')
    )
}

/** The block starting at the `{` at `open`, up to its matching `}`. */
function blockAt(source: string, open: number): string {
    let depth = 0

    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++
        else if (source[i] === '}' && --depth === 0) return source.slice(open, i + 1)
    }

    return ''
}

/**
 * Every member of the store's `actions: { … }` object.
 *
 * Walks the object skipping whole member bodies, so the only braces it ever
 * inspects are the ones that open a member — an inner arrow function
 * (`autoPlayNext`'s `resetQueue`) or an object literal cannot be mistaken for
 * one. The name is the last `ident(args)` in the preamble before that brace.
 */
function actionsOf(source: string): Action[] {
    const clean = stripComments(source)
    const marker = clean.indexOf('actions: {')
    if (marker === -1) return []

    const body = blockAt(clean, clean.indexOf('{', marker))
    if (!body) return []

    const inner = body.slice(1, -1)
    const found: Action[] = []
    let memberStart = 0
    let i = 0

    while (i < inner.length) {
        if (inner[i] !== '{') {
            i++
            continue
        }

        const block = blockAt(inner, i)
        const name = /([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*$/.exec(inner.slice(memberStart, i).trim())
        if (name && block) found.push({ name: name[1], body: block })

        i += block.length || 1
        memberStart = i
    }

    return found
}

/** Does `body` call action `name` (`this.x()`, `store.x()` or a destructured `x()`)? */
function calls(body: string, name: string): boolean {
    return new RegExp(`\\b${name}\\s*\\(`).test(body)
}

const TRACKLIST_ACTIONS = actionsOf(SOURCES[TRACKLIST_FILE])
const QUEUE_ACTIONS = actionsOf(SOURCES[QUEUE_FILE])

/** Actions that write the list themselves. */
const MUTATORS = TRACKLIST_ACTIONS.filter(action => MUTATION.test(action.body))

/** …of those, the ones that reach the seam BEFORE writing. */
const GUARDED = MUTATORS.filter(action => {
    const seam = SEAM.exec(action.body)
    const mutation = MUTATION.exec(action.body)
    return !!seam && !!mutation && seam.index < mutation.index
})

const GUARDED_NAMES = GUARDED.map(action => action.name)

describe('queue seam census — inputs', () => {
    it('reads both queue stores', () => {
        for (const [file, source] of Object.entries(SOURCES)) {
            expect(source.length, `${file} not readable`).toBeGreaterThan(1000)
        }
        expect(SOURCES[TRACKLIST_FILE]).toContain('this.tracklist')
        expect(SOURCES[QUEUE_FILE]).toContain('useTracklist')
    })

    it('parses the action lists out of both stores', () => {
        expect(TRACKLIST_ACTIONS.map(a => a.name)).toEqual(
            expect.arrayContaining([
                'setNewList',
                'addTracks',
                'insertAt',
                'moveTrack',
                'clearList',
                'shuffleList',
                'removeByIndex',
                'insertAfterCurrent',
            ])
        )
        expect(QUEUE_ACTIONS.map(a => a.name)).toEqual(
            expect.arrayContaining(['play', 'playTrackNext', 'clearQueue', 'shuffleQueue'])
        )
        // Bodies, not empty shells: a brace-matcher that lost its place would
        // hand back slivers and every regex below would miss.
        expect(Math.max(...TRACKLIST_ACTIONS.map(a => a.body.length))).toBeGreaterThan(400)
    })

    it('finds the known mutations and the known guards', () => {
        expect(MUTATORS.map(a => a.name)).toEqual(
            expect.arrayContaining(['setNewList', 'insertAt', 'moveTrack', 'clearList', 'shuffleList', 'removeByIndex'])
        )
        expect(GUARDED_NAMES).toEqual(expect.arrayContaining(['insertAt', 'moveTrack', 'removeByIndex']))
    })

    it('keeps the allowlist honest', () => {
        for (const [name, reason] of Object.entries(LOCAL_BY_DESIGN)) {
            const action = MUTATORS.find(a => a.name === name)
            // A stale entry (renamed action, or one that no longer writes the
            // list) would quietly widen the exemption for nobody's benefit.
            expect(action, `allowlisted "${name}" is not a queue mutation any more`).toBeTruthy()
            expect(GUARDED_NAMES, `allowlisted "${name}" carries the seam — drop the entry`).not.toContain(name)
            expect(reason.length, `allowlisted "${name}" needs a reason`).toBeGreaterThan(40)
        }
    })
})

const MUTATOR_NAMES = MUTATORS.map(action => action.name)

/**
 * Lane two: actions that do not write the list themselves but call one of the
 * writers — in either store, since `queue.ts` reaches the list only that way.
 */
const CALLERS = [
    ...TRACKLIST_ACTIONS.map(action => ({ file: TRACKLIST_FILE, action })),
    ...QUEUE_ACTIONS.map(action => ({ file: QUEUE_FILE, action })),
].filter(
    ({ action }) => !MUTATOR_NAMES.includes(action.name) && MUTATOR_NAMES.some(name => calls(action.body, name))
)

describe('queue seam census', () => {
    it('every list mutation reaches the seam or is allowlisted', () => {
        const offenders = MUTATORS.filter(
            action => !GUARDED_NAMES.includes(action.name) && !(action.name in LOCAL_BY_DESIGN)
        ).map(action => `${TRACKLIST_FILE}::${action.name}`)

        expect(offenders).toEqual([])
    })

    it('every caller of a seamed mutation is seamed itself or delegates to it', () => {
        // Guard over this lane's own input: if `calls()` ever stopped matching,
        // the list would empty out and the check below would pass vacuously.
        expect(CALLERS.map(({ action }) => action.name)).toEqual(
            expect.arrayContaining(['addTracks', 'insertAfterCurrent', 'playTrackNext', 'clearQueue', 'shuffleQueue'])
        )

        const offenders = CALLERS.filter(({ action }) => {
            // Reaching only the local-by-design primitives is sanctioned by
            // THEIR entry (which names the callers it covers); the census for
            // that set is the next test.
            const reachesSeamed = MUTATOR_NAMES.some(
                name => !(name in LOCAL_BY_DESIGN) && calls(action.body, name)
            )
            if (!reachesSeamed) return false

            if (SEAM.test(action.body)) return false
            return !GUARDED_NAMES.some(name => calls(action.body, name))
        }).map(({ file, action }) => `${file}::${action.name}`)

        expect(offenders).toEqual([])
    })

    /**
     * The residual hole, closed by enumeration: an action that only calls a
     * local-by-design primitive slips past the check above, because the
     * primitive's allowlist entry argues about the callers it knows. So the
     * callers are pinned — a new one has to show up here and be argued about,
     * exactly like a new card in the anatomy census.
     */
    it('knows every action that reaches a local-by-design primitive', () => {
        const reachers = CALLERS.filter(({ action }) =>
            Object.keys(LOCAL_BY_DESIGN).some(name => calls(action.body, name))
        )
            .map(({ action }) => action.name)
            .sort()

        expect(reachers).toEqual(
            [
                // Replace the queue, then queue.play() broadcasts the new list.
                'setFromAlbum',
                'setFromArtist',
                'setFromFav',
                'setFromFolder',
                'setFromPlaylist',
                'setFromPlaylistFolder',
                'setFromSearch',
                // Both carry their own seam.
                'clearQueue',
                'shuffleQueue',
            ].sort()
        )
    })
})
