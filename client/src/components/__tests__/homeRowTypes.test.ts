import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// Every item type a Home row can receive needs a card (#227).
//
// The server builds "Recently played" out of SIX types
// (src/aivinnet/lib/home/create_items.py + recover_items.py). The client drew
// five. The sixth, `favorite` ("you played from your favourites"), hit the
// `default` of a switch, `getComponent()` answered `undefined`, and
// `<component :is="undefined">` renders NOTHING — no element, no warning. The
// item still used up one of the row's slots, so measured on the running app:
//
//     grid 1472px, 6 columns, received 7 items   ->  5 tiles
//     the rows above and below, same grid         ->  6 tiles
//
// Reported as "album rows have fewer tiles than artist rows", which is how it
// looks from the outside and not at all what it was.
//
// ⚠️ The list below MIRRORS the backend and cannot import it (the client suite
// only sees `client/src`). Adding a type on the server means adding it here —
// this test is the reminder, and the filter in CardScroller is the safety net
// for the time in between.
// ---------------------------------------------------------------------------

const SERVER_HOME_TYPES = ['album', 'artist', 'favorite', 'folder', 'playlist', 'track']

const SOURCES = import.meta.glob('/src/components/shared/CardScroller.vue', { as: 'raw', eager: true }) as Record<
    string,
    string
>
const SCROLLER = SOURCES['/src/components/shared/CardScroller.vue']

/** The body of a named function in the <script> block. */
function functionBody(name: string): string {
    const start = SCROLLER.indexOf(`function ${name}(`)
    expect(start, `${name}() not found in CardScroller.vue`).toBeGreaterThan(-1)
    const next = SCROLLER.indexOf('\nfunction ', start + 1)
    return SCROLLER.slice(start, next === -1 ? undefined : next)
}

describe('Home rows', () => {
    it.each(SERVER_HOME_TYPES)('draw a card for "%s"', type => {
        expect(functionBody('getComponent')).toContain(`case '${type}':`)
        expect(functionBody('getProps')).toContain(`case '${type}':`)
    })

    it('give a column only to items they can draw', () => {
        // Slicing the raw list is exactly the bug: an undrawable item eats a
        // slot and the row comes up short. The slice must run on the filtered
        // list.
        expect(SCROLLER).toMatch(/v-for="[^"]*\brenderable\.slice\(0, columns\)"/)
        expect(SCROLLER).not.toMatch(/v-for="[^"]*\bitemlist\.slice\(/)
    })

    it('still report the position in the list the page handed over', () => {
        // Filtering shifts indices. `playThis` tells the page which item to
        // play by position, so it has to be the position in THAT list.
        expect(SCROLLER).toMatch(/\$emit\('playThis', itemlist\.indexOf\(i\)\)/)
    })
})
