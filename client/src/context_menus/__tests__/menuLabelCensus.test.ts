import { readFileSync, readdirSync, statSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// Census: a menu entry that queues MANY tracks has to name its subject.
//
// Reported 2026-08-15: "Play next" on an album page dropped the whole album
// into the queue. Measured against the deployed app, every path was correct —
// the track row inserts one song, the album header inserts the album, both
// right behind the playing track. What was wrong is that BOTH menus said the
// same four letters. On the album page they are one right-click apart, so the
// container action reads as if it applied to the row under the cursor.
//
// The rule that follows: the bare labels belong to the single track, and every
// container menu (album/artist/folder/playlist/playlist folder) names what it
// is about — "Play album next", "Add playlist to queue".
//
// Enumerated from the SOURCE rather than from a fixed list of files: naming the
// five known menus would stay green for the sixth one somebody adds — which is
// how the sidebar's playlist-folder menu came to carry the bare labels in the
// first place (it is not in `src/context_menus/` at all). A source-scanning
// test goes silently green when its parser breaks, so the first describe()
// guards its own inputs (.claude/rules/testing.md).
// ---------------------------------------------------------------------------

// Read off disk with a project-root-relative path, the same anchor
// `queueSeamCensus` uses and for the same reasons (see its note).
const ROOT = 'src'

function walk(dir: string): string[] {
    return readdirSync(dir).flatMap(entry => {
        const path = `${dir}/${entry}`
        if (statSync(path).isDirectory()) return walk(path)
        return /\.(ts|vue)$/.test(path) && !path.includes('__tests__') ? [path] : []
    })
}

/** Queue calls that take a LIST — the container actions. */
const BULK = /\b(?:insertAfterCurrent|addTracks)\s*\(/

/**
 * Queue calls that take ONE track — the track row's actions.
 *
 * `addTrack` is also a playlist-store action (`stores/pages/playlist.ts`), so
 * this only holds because the bodies below are the OPTION LITERAL and nothing
 * else. Slicing "up to the next label" instead would have run the last option
 * of a file to EOF and swept unrelated calls in with it.
 */
const SINGLE = /\b(?:playTrackNext|addTrack)\s*\(/

/**
 * The labels that mean "the one row you clicked". A container entry carrying
 * one of these is the bug this census exists for.
 *
 * Cased variants included on purpose: the menus wrote "Add to Queue" and
 * "Add to queue" side by side, and a census that only knew one spelling would
 * wave the other one through.
 */
const BARE = ['Play next', 'Add to queue', 'Add to Queue']

interface Entry {
    file: string
    label: string
    body: string
}

/**
 * Comments and strings carry braces, and comments here quote labels verbatim
 * ("…says plain \"Play next\" for a single song"). Blanked rather than removed
 * so every index still points at the same character of the original.
 */
function blank(source: string): string {
    let out = ''
    let i = 0

    while (i < source.length) {
        const rest = source.slice(i)
        const open = /^(\/\/|\/\*|['"`])/.exec(rest)

        if (!open) {
            out += source[i++]
            continue
        }

        const token = open[1]
        const close = token === '//' ? '\n' : token === '/*' ? '*/' : token
        let end = i + token.length

        while (end < source.length && !source.startsWith(close, end)) {
            end += source[end] === '\\' ? 2 : 1
        }
        end = Math.min(end + close.length, source.length)

        // Keep the newlines: line numbers in a failure message should be real.
        out += source.slice(i, end).replace(/[^\n]/g, ' ')
        i = end
    }

    return out
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
 * Every `label: '…'` in the file, paired with the OPTION LITERAL it belongs to
 * — the innermost `{ … }` around it, which is exactly the option object and
 * therefore exactly its `action`.
 *
 * The cheaper "slice up to the next label" costs both ends: the last option of
 * a file runs to EOF and adopts whatever helper follows it, and a `label:` that
 * is not a quoted string (see DYNAMIC below) is invisible, so the option after
 * it gets attributed to the one before.
 */
function entriesOf(file: string): Entry[] {
    const source = readFileSync(file, 'utf-8')
    const clean = blank(source)
    const found: Entry[] = []
    const opens: number[] = []

    for (let i = 0; i < clean.length; i++) {
        if (clean[i] === '{') opens.push(i)
        else if (clean[i] === '}') opens.pop()
        else if (clean.startsWith('label:', i) && opens.length) {
            // The label text itself was blanked out — read it back from the
            // untouched source at the same offset.
            const quoted = /^label:\s*(['"`])([^'"`]*)\1/.exec(source.slice(i))
            if (quoted) {
                found.push({ file, label: quoted[2], body: blockAt(clean, opens[opens.length - 1]) })
            }
        }
    }

    return found
}

const FILES = walk(ROOT)
const ENTRIES = FILES.flatMap(entriesOf)
const BULK_ENTRIES = ENTRIES.filter(entry => BULK.test(entry.body))
const SINGLE_ENTRIES = ENTRIES.filter(entry => SINGLE.test(entry.body))

/**
 * Labels this census cannot read: computed at runtime, so there is no string to
 * judge. Pinned rather than ignored — the exemption stays a decision. None of
 * them queues anything: two are pin/unpin toggles, the rest are names of
 * playlists, folders and artists filled in from data.
 */
const DYNAMIC = ['is_pinned ?', 'playlist.pinned ?', 'playlist.name', 'artist.name', 'f.name']

/**
 * `label:` sites that are NOT a quoted string, in the files this census reads.
 *
 * Only those files: `label: string` in an interface is a type, not a label, and
 * the point here is the menus. Read off the blanked source so a label quoted
 * inside a COMMENT cannot pose as one.
 */
function dynamicLabelsOf(file: string): string[] {
    return [...blank(readFileSync(file, 'utf-8')).matchAll(/label:([^\n,]{0,40})/g)]
        .map(match => match[1].trim())
        .filter(Boolean) // a quoted label blanks out to nothing — that one IS read
}

describe('menu label census — inputs', () => {
    it('walks the source tree and parses labelled options out of it', () => {
        expect(ENTRIES.length).toBeGreaterThan(30)
        expect([...new Set(ENTRIES.map(entry => entry.file))]).toEqual(
            expect.arrayContaining([
                'src/context_menus/album.ts',
                'src/context_menus/track.ts',
                'src/components/LeftSidebar/index.vue',
            ])
        )
        // Bodies are OPTION LITERALS, not slivers and not half the file: a
        // brace-matcher that lost its place would break both checks below
        // without either of them going red on its own.
        expect(ENTRIES.every(entry => entry.body.startsWith('{') && entry.body.endsWith('}'))).toBe(true)
        expect(Math.max(...ENTRIES.map(entry => entry.body.length))).toBeLessThan(2000)
    })

    it('knows every label it cannot read', () => {
        const menus = [...new Set(ENTRIES.map(entry => entry.file))]
        const unread = menus
            .flatMap(dynamicLabelsOf)
            .filter(expression => !DYNAMIC.some(known => expression.startsWith(known)))

        expect(unread).toEqual([])
    })

    it('finds both queue lanes, in every menu that has them', () => {
        // Five containers × two actions. Anchored on the FILES rather than a
        // count, so a menu that loses its entries is loud instead of absent.
        expect([...new Set(BULK_ENTRIES.map(entry => entry.file))].sort()).toEqual([
            'src/components/LeftSidebar/index.vue',
            'src/context_menus/album.ts',
            'src/context_menus/artist.ts',
            'src/context_menus/folder.ts',
            'src/context_menus/playlist.ts',
        ])
        expect(SINGLE_ENTRIES.map(entry => entry.file)).toEqual([
            'src/context_menus/track.ts',
            'src/context_menus/track.ts',
        ])
    })
})

describe('menu label census', () => {
    it('every entry that queues a whole container names its subject', () => {
        const offenders = BULK_ENTRIES.filter(entry => BARE.includes(entry.label)).map(
            entry => `${entry.file}: "${entry.label}"`
        )

        expect(offenders).toEqual([])
    })

    it('the bare labels stay with the single track', () => {
        expect(SINGLE_ENTRIES.map(entry => entry.label).sort()).toEqual(['Add to queue', 'Play next'])
    })

    it('no two menus disagree about the spelling of the same action', () => {
        const spellings = [...new Set([...BULK_ENTRIES, ...SINGLE_ENTRIES].map(entry => entry.label))]
        const collisions = spellings.filter(
            label => spellings.some(other => other !== label && other.toLowerCase() === label.toLowerCase())
        )

        expect(collisions).toEqual([])
    })
})
