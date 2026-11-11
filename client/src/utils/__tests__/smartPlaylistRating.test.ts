import { describe, expect, it } from 'vitest'

import type { SmartPlaylist } from '@/interfaces'
import {
    bodyFromForm,
    changeField,
    describeRule,
    formFromPlaylist,
    newDraft,
    ruleFromDraft,
    summarize,
    valueKind,
    type RuleDraft,
} from '../smartPlaylistRules'

// The "My rating" rule (#777): a draft becomes the typed rule the server reads,
// a stored rule becomes a draft again, and both read as a sentence.

const draft = (op: RuleDraft['op'], value = ''): RuleDraft => ({ field: 'rating', op, value, high: '' })

describe('rating rule: the value input', () => {
    it('takes a star count for gte, lte and eq', () => {
        expect(valueKind('rating', 'gte')).toBe('stars')
        expect(valueKind('rating', 'lte')).toBe('stars')
        expect(valueKind('rating', 'eq')).toBe('stars')
    })

    it('takes no value for unrated', () => {
        expect(valueKind('rating', 'unrated')).toBe('none')
    })

    it('is offered as a field with its own first operator', () => {
        const rule = changeField(newDraft('genre'), 'rating')

        expect(rule.field).toBe('rating')
        expect(rule.op).toBe('gte')
        expect(rule.value).toBe('')
    })
})

describe('rating rule: draft to request', () => {
    it.each([
        ['gte', '4', { field: 'rating', op: 'gte', value: 4 }],
        ['lte', '2', { field: 'rating', op: 'lte', value: 2 }],
        ['eq', '5', { field: 'rating', op: 'eq', value: 5 }],
        ['gte', '1', { field: 'rating', op: 'gte', value: 1 }],
    ])('%s %s becomes a whole number rule', (op, value, expected) => {
        expect(ruleFromDraft(draft(op as RuleDraft['op'], value))).toEqual({ rule: expected })
    })

    it('unrated sends no value', () => {
        expect(ruleFromDraft(draft('unrated'))).toEqual({ rule: { field: 'rating', op: 'unrated', value: null } })
    })

    it.each(['', '0', '6', '-1', '4.5', 'five'])('refuses %j as a star count, with a sentence', value => {
        const result = ruleFromDraft(draft('gte', value))

        expect(result).toHaveProperty('error')
        expect((result as { error: string }).error).toMatch(/My rating: choose from 1 to 5 stars/)
    })

    it('a whole form with a rating rule is sent with the number, not the text', () => {
        const result = bodyFromForm({
            name: 'Best of',
            match: 'all',
            rules: [draft('gte', '4')],
            limit: '50',
            sort: { field: 'rating', order: 'desc' },
        })

        expect(result).toEqual({
            body: {
                name: 'Best of',
                match: 'all',
                rules: [{ field: 'rating', op: 'gte', value: 4 }],
                limit: 50,
                sort: { field: 'rating', order: 'desc' },
            },
        })
    })

    it('a rating sort is a field the rule list can sort by', () => {
        const result = bodyFromForm({
            name: 'Ranked',
            match: 'all',
            rules: [draft('unrated')],
            limit: '100',
            sort: { field: 'rating', order: 'asc' },
        })

        expect(result).toHaveProperty('body')
    })
})

describe('rating rule: stored rule to draft', () => {
    const stored = (rule: SmartPlaylist['rules'][number]): SmartPlaylist => ({
        id: 1,
        name: 'Stored',
        created: 0,
        updated: 0,
        match: 'all',
        rules: [rule],
        limit: 100,
        sort: { field: 'date_added', order: 'desc' },
    })

    it('reads a numeric rating rule back into its draft', () => {
        const form = formFromPlaylist(stored({ field: 'rating', op: 'gte', value: 4 }))

        expect(form.rules[0]).toEqual({ field: 'rating', op: 'gte', value: '4', high: '' })
    })

    it('reads unrated back with an empty value', () => {
        const form = formFromPlaylist(stored({ field: 'rating', op: 'unrated', value: null }))

        expect(form.rules[0]).toEqual({ field: 'rating', op: 'unrated', value: '', high: '' })
    })

    it('round-trips: a draft saved and read back gives the same draft', () => {
        const original = draft('lte', '3')
        const body = bodyFromForm({
            name: 'Round trip',
            match: 'any',
            rules: [original],
            limit: '10',
            sort: { field: 'rating', order: 'desc' },
        })
        if (!('body' in body)) throw new Error(body.error)

        const back = formFromPlaylist({ id: 2, created: 0, updated: 0, ...body.body })

        expect(back.rules[0]).toEqual(original)
        expect(back.sort).toEqual({ field: 'rating', order: 'desc' })
    })
})

describe('rating rule: reading it as text', () => {
    it.each([
        [{ field: 'rating', op: 'gte', value: 4 }, 'My rating is at least 4 stars'],
        [{ field: 'rating', op: 'lte', value: 2 }, 'My rating is at most 2 stars'],
        [{ field: 'rating', op: 'eq', value: 1 }, 'My rating is 1'],
        [{ field: 'rating', op: 'unrated', value: null }, 'Not rated'],
    ] as const)('%j reads as %j', (rule, text) => {
        expect(describeRule(rule as SmartPlaylist['rules'][number])).toBe(text)
    })

    it('a whole definition with a rating rule reads as one line', () => {
        const line = summarize({
            match: 'all',
            rules: [{ field: 'rating', op: 'gte', value: 5 }],
            limit: 25,
            sort: { field: 'rating', order: 'desc' },
        })

        expect(line).toBe('My rating is at least 5 stars; sorted by My rating, highest first; up to 25 tracks')
    })
})
