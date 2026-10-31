import { describe, expect, it } from 'vitest'

import type { SmartPlaylist } from '@/interfaces'
import {
    bodyFromForm,
    changeField,
    describeRule,
    describeSort,
    emptyForm,
    formFromPlaylist,
    newDraft,
    OPS_BY_FIELD,
    opFor,
    ruleFromDraft,
    summarize,
    valueKind,
} from '@/utils/smartPlaylistRules'

// The operators per field are the server's (api/..., lib/smart_playlists.py
// OPERATORS). Written out here, so a change on either side shows up as a red
// test instead of an editor that offers what the server refuses.
const SERVER_OPERATORS: Record<string, string[]> = {
    genre: ['is', 'is_not', 'contains'],
    artist: ['is', 'is_not', 'contains'],
    albumartist: ['is', 'is_not', 'contains'],
    year: ['eq', 'lt', 'gt', 'between'],
    playcount: ['eq', 'lt', 'gt', 'between'],
    date_added: ['in_last_days', 'not_in_last_days'],
    last_played: ['in_last_days', 'not_in_last_days', 'never'],
    favorite: ['is'],
}

describe('operators per field', () => {
    it('match the server, field by field', () => {
        expect(OPS_BY_FIELD).toEqual(SERVER_OPERATORS)
    })

    it('keeps the operator when the new field has it, else takes the first one', () => {
        expect(opFor('year', 'between')).toBe('between')
        expect(opFor('year', 'contains')).toBe('eq')
        expect(opFor('favorite', 'between')).toBe('is')
    })
})

describe('value input per field and operator', () => {
    it.each([
        ['genre', 'is', 'text'],
        ['albumartist', 'contains', 'text'],
        ['year', 'eq', 'number'],
        ['playcount', 'gt', 'number'],
        ['year', 'between', 'range'],
        ['date_added', 'in_last_days', 'days'],
        ['last_played', 'not_in_last_days', 'days'],
        ['last_played', 'never', 'none'],
        ['favorite', 'is', 'flag'],
    ] as const)('%s %s takes %s', (field, op, kind) => {
        expect(valueKind(field, op)).toBe(kind)
    })
})

describe('ruleFromDraft: the typed value the server reads', () => {
    it('trims a text and keeps its case', () => {
        expect(ruleFromDraft({ ...newDraft('genre'), value: '  Jazz  ' })).toEqual({
            rule: { field: 'genre', op: 'is', value: 'Jazz' },
        })
    })

    it('refuses an empty text, and says which field', () => {
        expect(ruleFromDraft({ ...newDraft('genre'), value: '   ' })).toEqual({ error: 'Genre: enter a text' })
    })

    it('reads a whole number, and refuses anything else', () => {
        const year = { ...newDraft('year'), op: 'eq' as const }
        expect(ruleFromDraft({ ...year, value: '1999' })).toEqual({ rule: { field: 'year', op: 'eq', value: 1999 } })
        expect(ruleFromDraft({ ...year, value: '19.99' })).toEqual({ error: 'Year needs a whole number' })
        expect(ruleFromDraft({ ...year, value: '-3' })).toEqual({ error: 'Year needs a whole number' })
    })

    it('wants days of at least 1', () => {
        const days = { ...newDraft('date_added'), op: 'in_last_days' as const }
        expect(ruleFromDraft({ ...days, value: '30' })).toEqual({
            rule: { field: 'date_added', op: 'in_last_days', value: 30 },
        })
        expect(ruleFromDraft({ ...days, value: '0' })).toEqual({
            error: expect.stringMatching(/at least 1/),
        })
    })

    it('reads a range as [low, high], and refuses it reversed', () => {
        const range = { ...newDraft('year'), op: 'between' as const }
        expect(ruleFromDraft({ ...range, value: '1990', high: '1999' })).toEqual({
            rule: { field: 'year', op: 'between', value: [1990, 1999] },
        })
        expect(ruleFromDraft({ ...range, value: '2000', high: '1990' })).toEqual({
            error: expect.stringMatching(/above the second/),
        })
        expect(ruleFromDraft({ ...range, value: '1990', high: '' })).toEqual({
            error: expect.stringMatching(/two whole numbers/),
        })
    })

    it('reads favorite as a real boolean, and "never" as no value at all', () => {
        expect(ruleFromDraft({ ...newDraft('favorite'), value: 'false' })).toEqual({
            rule: { field: 'favorite', op: 'is', value: false },
        })
        expect(ruleFromDraft({ field: 'last_played', op: 'never', value: '', high: '' })).toEqual({
            rule: { field: 'last_played', op: 'never', value: null },
        })
    })

    it('changing the field starts the value over', () => {
        const draft = { ...newDraft('genre'), value: 'Jazz' }
        expect(changeField(draft, 'year')).toEqual({ field: 'year', op: 'eq', value: '', high: '' })
        expect(changeField(draft, 'favorite')).toEqual({ field: 'favorite', op: 'is', value: 'true', high: '' })
    })
})

describe('bodyFromForm', () => {
    it('builds the body the server takes, with two rules', () => {
        const form = emptyForm()
        form.name = '  Jazz from the 90s '
        form.rules = [
            { field: 'genre', op: 'is', value: 'Jazz', high: '' },
            { field: 'year', op: 'between', value: '1990', high: '1999' },
        ]
        expect(bodyFromForm(form)).toEqual({
            body: {
                name: 'Jazz from the 90s',
                match: 'all',
                rules: [
                    { field: 'genre', op: 'is', value: 'Jazz' },
                    { field: 'year', op: 'between', value: [1990, 1999] },
                ],
                limit: 100,
                sort: { field: 'date_added', order: 'desc' },
            },
        })
    })

    it('names the first problem, and the rule it is in', () => {
        const form = emptyForm()
        form.name = 'x'
        form.rules = [
            { field: 'genre', op: 'is', value: 'Jazz', high: '' },
            { field: 'year', op: 'eq', value: '', high: '' },
        ]
        expect(bodyFromForm(form)).toEqual({ error: 'Rule 2: Year needs a whole number' })
    })

    it('needs a name, a rule and a limit from 1 to 1000', () => {
        // The default rule is empty; a valid one isolates the check under test.
        const form = { ...emptyForm(), rules: [{ ...newDraft('genre'), value: 'Jazz' }] }
        expect(bodyFromForm({ ...form, name: '  ' })).toEqual({ error: 'Give the smart playlist a name' })
        expect(bodyFromForm({ ...form, name: 'a', rules: [] })).toEqual({ error: 'Add at least one rule' })
        expect(bodyFromForm({ ...form, name: 'a', limit: '0' })).toEqual({
            error: expect.stringMatching(/from 1 to 1000/),
        })
        expect(bodyFromForm({ ...form, name: 'a', limit: '1001' })).toEqual({
            error: expect.stringMatching(/from 1 to 1000/),
        })
    })

    it('sends "random" as the sort when it is chosen', () => {
        const result = bodyFromForm({
            ...emptyForm(),
            name: 'a',
            rules: [{ ...newDraft('genre'), value: 'Jazz' }],
            sort: { field: 'random', order: 'asc' },
        })
        expect('body' in result && result.body.sort).toBe('random')
    })
})

describe('formFromPlaylist: a stored playlist back into the form', () => {
    // A row as the server answers it (api/smartplaylists.py `_summary`).
    const stored: SmartPlaylist = {
        id: 4,
        name: 'Jazz from the 90s',
        match: 'all',
        rules: [
            { field: 'genre', op: 'is', value: 'Jazz' },
            { field: 'year', op: 'between', value: [1990, 1999] },
            { field: 'last_played', op: 'never', value: null },
        ],
        limit: 50,
        sort: { field: 'playcount', order: 'desc' },
        created: 1_700_000_000,
        updated: 1_700_000_000,
    }

    it('reads back to the same body it was saved from', () => {
        const result = bodyFromForm(formFromPlaylist(stored))
        expect(result).toEqual({
            body: {
                name: 'Jazz from the 90s',
                match: 'all',
                rules: stored.rules,
                limit: 50,
                sort: { field: 'playcount', order: 'desc' },
            },
        })
    })

    it('takes a random sort back as the random choice', () => {
        const form = formFromPlaylist({ ...stored, sort: 'random' })
        expect(form.sort.field).toBe('random')
    })
})

describe('reading a definition back as text', () => {
    it('describes each rule in words', () => {
        expect(describeRule({ field: 'genre', op: 'is', value: 'Jazz' })).toBe('Genre is "Jazz"')
        expect(describeRule({ field: 'genre', op: 'is_not', value: 'Pop' })).toBe('Genre is not "Pop"')
        expect(describeRule({ field: 'artist', op: 'contains', value: 'miles' })).toBe('Artist contains "miles"')
        expect(describeRule({ field: 'year', op: 'between', value: [1990, 1999] })).toBe('Year is between 1990 and 1999')
        expect(describeRule({ field: 'playcount', op: 'gt', value: 5 })).toBe('Play count is above 5')
        expect(describeRule({ field: 'date_added', op: 'in_last_days', value: 1 })).toBe('Date added in the last 1 day')
        expect(describeRule({ field: 'date_added', op: 'in_last_days', value: 30 })).toBe(
            'Date added in the last 30 days'
        )
        expect(describeRule({ field: 'last_played', op: 'never', value: null })).toBe('Never played')
        expect(describeRule({ field: 'favorite', op: 'is', value: true })).toBe('Favorite')
        expect(describeRule({ field: 'favorite', op: 'is', value: false })).toBe('Not a favorite')
    })

    it('reads the sort, with the words that fit its field', () => {
        expect(describeSort('random')).toBe('in random order')
        expect(describeSort({ field: 'date_added', order: 'desc' })).toBe('sorted by Date added, newest first')
        expect(describeSort({ field: 'playcount', order: 'asc' })).toBe('sorted by Play count, lowest first')
        expect(describeSort({ field: 'genre', order: 'asc' })).toBe('sorted by Genre, A to Z')
        expect(describeSort({ field: 'favorite', order: 'desc' })).toBe('sorted by Favorite, favorites first')
    })

    it('summarizes a whole playlist on one line', () => {
        expect(
            summarize({
                match: 'all',
                rules: [
                    { field: 'genre', op: 'is', value: 'Jazz' },
                    { field: 'year', op: 'between', value: [1990, 1999] },
                ],
                limit: 100,
                sort: { field: 'date_added', order: 'desc' },
            })
        ).toBe('Genre is "Jazz" and Year is between 1990 and 1999; sorted by Date added, newest first; up to 100 tracks')
    })

    it('joins with "or" when any rule may match, and reads a single track', () => {
        expect(
            summarize({
                match: 'any',
                rules: [
                    { field: 'favorite', op: 'is', value: true },
                    { field: 'last_played', op: 'never', value: null },
                ],
                limit: 1,
                sort: 'random',
            })
        ).toBe('Favorite or Never played; in random order; up to 1 track')
    })
})
