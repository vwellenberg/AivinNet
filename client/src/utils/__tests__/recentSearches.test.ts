import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
    clearRecentSearches,
    getRecentSearches,
    promoteRecentSearch,
    recordRecentSearch,
    removeRecentSearch,
} from '../recentSearches'

/** Every intermediate state the store sees while a term is typed out. */
function type(term: string) {
    for (let i = 1; i <= term.length; i++) recordRecentSearch(term.slice(0, i))
}

/** …and while it is deleted again, one backspace at a time. */
function backspace(term: string, to = 0) {
    for (let i = term.length - 1; i >= to; i--) recordRecentSearch(term.slice(0, i))
}

describe('recentSearches', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    it('returns an empty list when nothing is stored', () => {
        expect(getRecentSearches()).toEqual([])
    })

    it('ignores terms shorter than two characters', () => {
        recordRecentSearch('a')
        recordRecentSearch(' ')
        expect(getRecentSearches()).toEqual([])
    })

    it('records newest first', () => {
        recordRecentSearch('weezer')
        recordRecentSearch('lion king')
        expect(getRecentSearches()).toEqual(['lion king', 'weezer'])
    })

    it('keeps only the longest term while one is typed out', () => {
        type('weezer')
        expect(getRecentSearches()).toEqual(['weezer'])
    })

    // The bug this list was reported for: "age", "ae", "holiday islan" sitting
    // next to the terms they are fragments of. Deleting backwards produced them
    // — the old filter only folded a query that EXTENDED an existing entry.
    it('leaves no debris when a term is deleted backwards', () => {
        type('holiday island')
        backspace('holiday island', 4)
        expect(getRecentSearches()).toEqual(['holiday island'])
    })

    // The lists this fix exists for are already stored in people's browsers.
    // Folding only on write would leave every fragment on screen until its
    // full term happened to be searched again.
    it('folds a list that was stored before the fix, on read', () => {
        localStorage.setItem(
            'recentSearches',
            JSON.stringify(['age', 'age of empires', 'holiday islan', 'holiday island', 'bite'])
        )
        expect(getRecentSearches()).toEqual(['age of empires', 'holiday island', 'bite'])
    })

    it('normalises the stored list once, not on every read', () => {
        localStorage.setItem('recentSearches', JSON.stringify(['age', 'age of empires']))
        expect(getRecentSearches()).toEqual(['age of empires'])
        // The migration persists, so nothing re-folds afterwards.
        expect(localStorage.getItem('recentSearches')).toBe(JSON.stringify(['age of empires']))

        localStorage.setItem('recentSearches', JSON.stringify(['yes', 'yesterday']))
        expect(getRecentSearches()).toEqual(['yes', 'yesterday'])
    })

    it('survives a stored list that is not an array of strings', () => {
        localStorage.setItem('recentSearches', JSON.stringify({ nope: true }))
        expect(getRecentSearches()).toEqual([])

        localStorage.setItem('recentSearches', JSON.stringify(['weezer', 7, null]))
        expect(getRecentSearches()).toEqual(['weezer'])
    })

    // Reading is the first thing the search page does, and it used to be an
    // unguarded JSON.parse: a corrupt entry threw during setup and took the
    // whole view — and the store's query watcher — down with it.
    it('survives a stored value that is not JSON at all', () => {
        localStorage.setItem('recentSearches', 'not json {')
        expect(() => getRecentSearches()).not.toThrow()
        expect(getRecentSearches()).toEqual([])
    })

    it('folds a shortened term into the one recorded just before it', () => {
        recordRecentSearch('age of empires')
        recordRecentSearch('age')

        expect(getRecentSearches()).toEqual(['age of empires'])
    })

    // Debris is written by the keystroke next to the term it is a fragment of.
    // Two entries that merely share a prefix are two real searches — folding
    // those made the band "Yes" permanently unrecordable for anyone with
    // "yesterday" in their history.
    it('keeps a short term that shares a prefix with a term further down', () => {
        recordRecentSearch('yesterday')
        recordRecentSearch('bite')
        recordRecentSearch('yes')

        expect(getRecentSearches()).toEqual(['yes', 'bite', 'yesterday'])
    })

    // Folding on every read instead of once: deleting the entry between two
    // prefix-related terms makes them adjacent, and the next render collapses
    // them. One click on an X, two chips gone.
    it('does not collapse the survivors when an entry between them is removed', () => {
        recordRecentSearch('yesterday')
        recordRecentSearch('bite')
        recordRecentSearch('yes')

        removeRecentSearch('bite')
        expect(getRecentSearches()).toEqual(['yes', 'yesterday'])
        // …and still there on the read after that.
        expect(getRecentSearches()).toEqual(['yes', 'yesterday'])
    })

    // Typing out a term that is already stored deeper in the list: the last
    // half-typed tick is at the head, and it has to fold away like any other.
    // Skipping the fold for already-stored terms left it there permanently —
    // the migration runs once and never revisits it.
    it('folds the last fragment away when a stored term is typed out again', () => {
        recordRecentSearch('yesterday')
        recordRecentSearch('bite')
        type('yesterday')

        expect(getRecentSearches()).toEqual(['yesterday', 'bite'])
    })

    // The other half of that price, and the sharper one: the adjacency renews
    // itself, so a term that is a prefix of the head cannot be recorded at all
    // until something else is searched. Written down so a future change to the
    // rule is a decision rather than a surprise.
    it('cannot record a term that is a prefix of the head, until the head moves', () => {
        recordRecentSearch('yesterday')

        recordRecentSearch('yes')
        expect(getRecentSearches()).toEqual(['yesterday'])

        recordRecentSearch('bite')
        recordRecentSearch('yes')
        expect(getRecentSearches()).toEqual(['yes', 'bite', 'yesterday'])
    })

    // Without the flag there is nothing keeping the whole-list fold to one
    // run, and a fold on every read collapses the survivors of any deletion.
    // A refusal to store it therefore cancels the migration entirely.
    it('leaves the stored list alone when the migration flag cannot be stored', () => {
        localStorage.setItem('recentSearches', JSON.stringify(['age', 'age of empires']))

        const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('quota exceeded')
        })
        expect(getRecentSearches()).toEqual(['age', 'age of empires'])
        setItem.mockRestore()

        expect(getRecentSearches()).toEqual(['age of empires'])
    })

    // Applying a chip is the one case where the query is KNOWN not to be
    // typing, and promoting it first is what carries that knowledge into the
    // record that the debounce watcher fires a moment later.
    describe('applying a chip', () => {
        it('keeps every other entry, including the one the fold would take', () => {
            recordRecentSearch('yesterday')
            recordRecentSearch('bite')
            recordRecentSearch('yes')

            promoteRecentSearch('yesterday')
            recordRecentSearch('yesterday') // what the watcher does next

            expect(getRecentSearches()).toEqual(['yesterday', 'yes', 'bite'])
        })

        it('ignores a term that is not in the list', () => {
            recordRecentSearch('weezer')

            promoteRecentSearch('nothing stored')
            expect(getRecentSearches()).toEqual(['weezer'])
        })
    })

    // The price of that ordering, stated so a change to it is a decision and
    // not an accident: the head folds even when it was a search of its own.
    it('drops the previous term when it is a prefix of the one now searched', () => {
        recordRecentSearch('yesterday')
        recordRecentSearch('bite')
        recordRecentSearch('yes')

        recordRecentSearch('yesterday')
        expect(getRecentSearches()).toEqual(['yesterday', 'bite'])
    })

    it('keeps a re-searched term instead of folding it away', () => {
        recordRecentSearch('yesterday')
        recordRecentSearch('bite')
        recordRecentSearch('yes')

        recordRecentSearch('yes')
        expect(getRecentSearches()).toEqual(['yes', 'bite', 'yesterday'])
    })

    it('does not collapse the survivors when an unrelated term is re-searched', () => {
        recordRecentSearch('yesterday')
        recordRecentSearch('bite')
        recordRecentSearch('yes')

        recordRecentSearch('bite')
        expect(getRecentSearches()).toEqual(['bite', 'yes', 'yesterday'])
    })

    it('keeps a term that is not a prefix of anything stored', () => {
        recordRecentSearch('age of empires')
        recordRecentSearch('bite')
        expect(getRecentSearches()).toEqual(['bite', 'age of empires'])
    })

    it('folds prefixes case-insensitively', () => {
        recordRecentSearch('Weezer')
        recordRecentSearch('weez')
        expect(getRecentSearches()).toEqual(['Weezer'])
    })

    it('moves an exact repeat back to the front', () => {
        recordRecentSearch('weezer')
        recordRecentSearch('bite')
        recordRecentSearch('weezer')
        expect(getRecentSearches()).toEqual(['weezer', 'bite'])
    })

    it('caps the stored history length', () => {
        for (const term of ['aa', 'bb', 'cc', 'dd', 'ee', 'ff', 'gg', 'hh', 'ii', 'jj']) {
            recordRecentSearch(term)
        }
        const list = getRecentSearches()
        expect(list).toHaveLength(8)
        expect(list[0]).toBe('jj')
        expect(list).not.toContain('aa')
    })

    it('removes a single term and clears the list', () => {
        recordRecentSearch('weezer')
        recordRecentSearch('bite')

        removeRecentSearch('weezer')
        expect(getRecentSearches()).toEqual(['bite'])

        clearRecentSearches()
        expect(getRecentSearches()).toEqual([])
    })
})
