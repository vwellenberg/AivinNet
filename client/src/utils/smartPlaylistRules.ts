import type { SmartPlaylist, SmartPlaylistBody, SmartPlaylistRule, SmartPlaylistSort } from '@/interfaces'

/**
 * Smart playlists (#642): which operators a field takes, how a value is typed,
 * and how a rule reads back as a sentence.
 *
 * Mirrors `src/aivinnet/lib/smart_playlists.py` (OPERATORS, `_parse_value`,
 * `_parse_sort`). The server stays the judge: this only keeps the editor from
 * offering what it would refuse, and gives the editor's own draft a body that
 * the server accepts. Pure, so the fast test lane runs it.
 */

export const STRING_FIELDS = ['genre', 'artist', 'albumartist'] as const
export const NUMBER_FIELDS = ['year', 'playcount'] as const
export const DATE_FIELDS = ['date_added', 'last_played'] as const
export const FIELDS = [...STRING_FIELDS, ...NUMBER_FIELDS, ...DATE_FIELDS, 'favorite'] as const
export type SmartField = (typeof FIELDS)[number]

export type SmartOp =
    | 'is'
    | 'is_not'
    | 'contains'
    | 'eq'
    | 'lt'
    | 'gt'
    | 'between'
    | 'in_last_days'
    | 'not_in_last_days'
    | 'never'

export const OPS_BY_FIELD: Record<SmartField, readonly SmartOp[]> = {
    genre: ['is', 'is_not', 'contains'],
    artist: ['is', 'is_not', 'contains'],
    albumartist: ['is', 'is_not', 'contains'],
    year: ['eq', 'lt', 'gt', 'between'],
    playcount: ['eq', 'lt', 'gt', 'between'],
    date_added: ['in_last_days', 'not_in_last_days'],
    last_played: ['in_last_days', 'not_in_last_days', 'never'],
    favorite: ['is'],
}

export const FIELD_LABELS: Record<SmartField, string> = {
    genre: 'Genre',
    artist: 'Artist',
    albumartist: 'Album artist',
    year: 'Year',
    playcount: 'Play count',
    date_added: 'Date added',
    last_played: 'Last played',
    favorite: 'Favorite',
}

export const OP_LABELS: Record<SmartOp, string> = {
    is: 'is',
    is_not: 'is not',
    contains: 'contains',
    eq: 'is',
    lt: 'is less than',
    gt: 'is more than',
    between: 'is between',
    in_last_days: 'in the last … days',
    not_in_last_days: 'not in the last … days',
    never: 'never',
}

/** The sort field list: every rule field, plus "random" in front of it. */
export const SORT_RANDOM = 'random'

/**
 * What the value input has to look like for one field and operator:
 * text, a whole number, two whole numbers, a count of days, true/false, or
 * nothing at all ("never").
 */
export type ValueKind = 'text' | 'number' | 'range' | 'days' | 'flag' | 'none'

export function valueKind(field: SmartField, op: SmartOp): ValueKind {
    if (op === 'never') return 'none'
    if (field === 'favorite') return 'flag'
    if ((STRING_FIELDS as readonly string[]).includes(field)) return 'text'
    if (op === 'between') return 'range'
    if ((NUMBER_FIELDS as readonly string[]).includes(field)) return 'number'
    return 'days'
}

/** The operator to keep when the field changes, or the field's first one when it does not fit. */
export function opFor(field: SmartField, op: SmartOp): SmartOp {
    const ops = OPS_BY_FIELD[field]
    return ops.includes(op) ? op : ops[0]
}

export function isSmartField(name: string): name is SmartField {
    return (FIELDS as readonly string[]).includes(name)
}

// ---------------------------------------------------------------------------
// Drafts: what the editor holds while the user types. Strings, because an
// input is one; `ruleFromDraft` turns them into the typed rule.
// ---------------------------------------------------------------------------

export interface RuleDraft {
    field: SmartField
    op: SmartOp
    /** The value: text, a number, a count of days, or 'true' / 'false' for favorite. */
    value: string
    /** The upper bound of a `between` rule. */
    high: string
}

export function defaultValue(field: SmartField): string {
    return field === 'favorite' ? 'true' : ''
}

export function newDraft(field: SmartField = 'genre'): RuleDraft {
    return { field, op: OPS_BY_FIELD[field][0], value: defaultValue(field), high: '' }
}

/** Switching the field starts the value over: a text does not become a number. */
export function changeField(draft: RuleDraft, field: SmartField): RuleDraft {
    return { field, op: opFor(field, draft.op), value: defaultValue(field), high: '' }
}

export type RuleResult = { rule: SmartPlaylistRule } | { error: string }

function whole(text: string): number | null {
    return /^\d+$/.test(text) ? Number(text) : null
}

/** A draft as the typed rule the server reads, or the one sentence that says what is wrong with it. */
export function ruleFromDraft(draft: RuleDraft): RuleResult {
    const name = FIELD_LABELS[draft.field]
    const kind = valueKind(draft.field, draft.op)
    // A `type="number"` input hands its value back as a number: read it as text.
    const value = String(draft.value ?? '').trim()
    const high = String(draft.high ?? '').trim()
    const base = { field: draft.field, op: draft.op }

    switch (kind) {
        case 'none':
            return { rule: { ...base, value: null } }

        case 'flag':
            if (value !== 'true' && value !== 'false') return { error: `${name}: choose yes or no` }
            return { rule: { ...base, value: value === 'true' } }

        case 'text':
            if (!value) return { error: `${name}: enter a text` }
            return { rule: { ...base, value } }

        case 'number': {
            const n = whole(value)
            if (n === null) return { error: `${name} needs a whole number` }
            return { rule: { ...base, value: n } }
        }

        case 'days': {
            const n = whole(value)
            if (n === null || n < 1) return { error: `${name}: enter a whole number of days, at least 1` }
            return { rule: { ...base, value: n } }
        }

        case 'range': {
            const low = whole(value)
            const top = whole(high)
            if (low === null || top === null) return { error: `${name}: enter two whole numbers` }
            if (low > top) return { error: `${name}: the first number (${low}) is above the second (${top})` }
            return { rule: { ...base, value: [low, top] } }
        }
    }
}

// ---------------------------------------------------------------------------
// The sort and the whole form.
// ---------------------------------------------------------------------------

export interface SortDraft {
    /** A rule field, or 'random'. */
    field: SmartField | typeof SORT_RANDOM
    order: 'asc' | 'desc'
}

/** The server's own default: newest added first. */
export const DEFAULT_SORT: SortDraft = { field: 'date_added', order: 'desc' }

export const DEFAULT_LIMIT = 100
export const MAX_LIMIT = 1000

export interface SmartPlaylistForm {
    name: string
    match: 'all' | 'any'
    rules: RuleDraft[]
    /** Kept as text: an input's value. */
    limit: string
    sort: SortDraft
}

export function emptyForm(): SmartPlaylistForm {
    return {
        name: '',
        match: 'all',
        rules: [newDraft()],
        limit: String(DEFAULT_LIMIT),
        sort: { ...DEFAULT_SORT },
    }
}

export function sortFromDraft(sort: SortDraft): SmartPlaylistSort {
    return sort.field === SORT_RANDOM ? SORT_RANDOM : { field: sort.field, order: sort.order }
}

export type FormResult = { body: SmartPlaylistBody } | { error: string }

/** The request body for the whole form, or the first thing that keeps it from being sent. */
export function bodyFromForm(form: SmartPlaylistForm): FormResult {
    const name = form.name.trim()
    if (!name) return { error: 'Give the smart playlist a name' }
    if (form.rules.length === 0) return { error: 'Add at least one rule' }

    const rules: SmartPlaylistRule[] = []
    for (let i = 0; i < form.rules.length; i++) {
        const result = ruleFromDraft(form.rules[i])
        if ('error' in result) return { error: `Rule ${i + 1}: ${result.error}` }
        rules.push(result.rule)
    }

    const limit = whole(String(form.limit ?? '').trim())
    if (limit === null || limit < 1 || limit > MAX_LIMIT) {
        return { error: `The limit must be a whole number from 1 to ${MAX_LIMIT}` }
    }

    return {
        body: {
            name,
            match: form.match,
            rules,
            limit,
            sort: sortFromDraft(form.sort),
        },
    }
}

/** A stored playlist back into the form, for editing it. */
export function formFromPlaylist(playlist: SmartPlaylist): SmartPlaylistForm {
    const rules: RuleDraft[] = playlist.rules.map(rule => {
        const field = isSmartField(rule.field) ? rule.field : 'genre'
        const op = opFor(field, rule.op as SmartOp)
        const kind = valueKind(field, op)

        if (kind === 'range' && Array.isArray(rule.value)) {
            return { field, op, value: String(rule.value[0]), high: String(rule.value[1]) }
        }
        if (kind === 'none' || rule.value === null || rule.value === undefined) {
            return { field, op, value: defaultValue(field), high: '' }
        }
        return { field, op, value: String(rule.value), high: '' }
    })

    const sort: SortDraft =
        playlist.sort === SORT_RANDOM
            ? { field: SORT_RANDOM, order: 'desc' }
            : { field: isSmartField(playlist.sort.field) ? playlist.sort.field : DEFAULT_SORT.field, order: playlist.sort.order }

    return {
        name: playlist.name,
        match: playlist.match,
        rules: rules.length ? rules : [newDraft()],
        limit: String(playlist.limit),
        sort,
    }
}

// ---------------------------------------------------------------------------
// Reading a definition back as text.
// ---------------------------------------------------------------------------

function quoted(text: unknown): string {
    return `"${String(text)}"`
}

function daysText(n: unknown): string {
    const count = Number(n)
    return `${count} ${count === 1 ? 'day' : 'days'}`
}

/** One rule as a phrase: `Genre is "Jazz"`, `Year is between 1990 and 2000`. */
export function describeRule(rule: SmartPlaylistRule): string {
    if (!isSmartField(rule.field)) return `${rule.field} ${rule.op}`

    const label = FIELD_LABELS[rule.field]
    const op = rule.op as SmartOp
    const value = rule.value

    switch (op) {
        case 'is':
            if (rule.field === 'favorite') return value ? 'Favorite' : 'Not a favorite'
            return `${label} is ${quoted(value)}`
        case 'is_not':
            return `${label} is not ${quoted(value)}`
        case 'contains':
            return `${label} contains ${quoted(value)}`
        case 'eq':
            return `${label} is ${String(value)}`
        case 'lt':
            return `${label} is below ${String(value)}`
        case 'gt':
            return `${label} is above ${String(value)}`
        case 'between':
            if (Array.isArray(value)) return `${label} is between ${value[0]} and ${value[1]}`
            return `${label} is between`
        case 'in_last_days':
            return `${label} in the last ${daysText(value)}`
        case 'not_in_last_days':
            return `${label} not in the last ${daysText(value)}`
        case 'never':
            return 'Never played'
    }
    return `${label} ${op}`
}

/** The sort as a phrase: "sorted by Date added, newest first", "in random order". */
export function describeSort(sort: SmartPlaylistSort): string {
    if (sort === SORT_RANDOM) return 'in random order'

    const label = FIELD_LABELS[sort.field as SmartField] ?? sort.field
    const desc = sort.order === 'desc'
    let order: string
    if (sort.field === 'favorite') {
        order = desc ? 'favorites first' : 'favorites last'
    } else if ((DATE_FIELDS as readonly string[]).includes(sort.field)) {
        order = desc ? 'newest first' : 'oldest first'
    } else if ((NUMBER_FIELDS as readonly string[]).includes(sort.field)) {
        order = desc ? 'highest first' : 'lowest first'
    } else {
        order = desc ? 'Z to A' : 'A to Z'
    }
    return `sorted by ${label}, ${order}`
}

/** The whole definition as one readable line, for a header or a card. */
export function summarize(definition: Pick<SmartPlaylist, 'match' | 'rules' | 'limit' | 'sort'>): string {
    const joiner = definition.match === 'any' ? ' or ' : ' and '
    const rules = definition.rules.map(describeRule).join(joiner)
    const count = definition.limit === 1 ? 'up to 1 track' : `up to ${definition.limit} tracks`
    return `${rules}; ${describeSort(definition.sort)}; ${count}`
}
