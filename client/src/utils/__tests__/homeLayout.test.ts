import { describe, expect, it } from 'vitest'

import type { HomeLayoutRow } from '@/requests/home'
import { layoutPayload, movableRows, moveRow, toggleRow } from '../homeLayout'

// As GET /nothome/layout sends them (#532).
function row(key: string, extra: Partial<HomeLayoutRow> = {}): HomeLayoutRow {
    return { key, title: key, description: '', visible: true, pinned: false, ...extra }
}

const ROWS = [
    row('continue_listening', { pinned: true }),
    row('your_mixes'),
    row('recently_played'),
    row('collections'),
    row('recently_added'),
]

const keys = (rows: HomeLayoutRow[]) => rows.map(r => r.key)

describe('moveRow', () => {
    it('moves among the movable rows, the pinned one stays first', () => {
        expect(keys(moveRow(ROWS, 3, 0))).toEqual([
            'continue_listening',
            'recently_added',
            'your_mixes',
            'recently_played',
            'collections',
        ])
    })

    it('moves down as well as up', () => {
        expect(keys(moveRow(ROWS, 0, 2))).toEqual([
            'continue_listening',
            'recently_played',
            'collections',
            'your_mixes',
            'recently_added',
        ])
    })

    it('leaves the rows alone for a move to nowhere', () => {
        expect(moveRow(ROWS, 1, 1)).toBe(ROWS)
        expect(moveRow(ROWS, -1, 0)).toBe(ROWS)
        expect(moveRow(ROWS, 0, movableRows(ROWS).length)).toBe(ROWS)
    })

    it('does not change the list it was given', () => {
        moveRow(ROWS, 3, 0)
        expect(keys(ROWS)[1]).toBe('your_mixes')
    })
})

describe('toggleRow and the payload', () => {
    it('hides and shows one row', () => {
        const hidden = toggleRow(ROWS, 'recently_played')
        expect(hidden.find(r => r.key === 'recently_played')!.visible).toBe(false)
        expect(toggleRow(hidden, 'recently_played').find(r => r.key === 'recently_played')!.visible).toBe(true)
        expect(ROWS.every(r => r.visible)).toBe(true)
    })

    it('sends every key in order and names the hidden ones', () => {
        const rows = toggleRow(moveRow(ROWS, 3, 0), 'continue_listening')

        expect(layoutPayload(rows)).toEqual({
            order: ['continue_listening', 'recently_added', 'your_mixes', 'recently_played', 'collections'],
            hidden: ['continue_listening'],
        })
    })
})
