import { afterEach, describe, expect, it, vi } from 'vitest'

import { ADVENT_DOORS, adventStorageKey, doorOpenable, readOpened, rememberOpened } from '@/utils/advent'

afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
})

describe('doorOpenable', () => {
    it('opens today’s door and the past ones, never the future', () => {
        expect(doorOpenable(1, 5)).toBe(true)
        expect(doorOpenable(5, 5)).toBe(true)
        expect(doorOpenable(6, 5)).toBe(false)
    })

    it('has no door without a day, and none beyond the 24th', () => {
        expect(doorOpenable(1, 0)).toBe(false)
        expect(doorOpenable(ADVENT_DOORS + 1, 99)).toBe(false)
        expect(doorOpenable(0, 5)).toBe(false)
        expect(doorOpenable(2.5, 5)).toBe(false)
    })
})

describe('remembered doors', () => {
    it('keeps the opened doors of one year, sorted and without repeats', () => {
        rememberOpened(2026, [5, 2, 5, 1])

        expect(readOpened(2026)).toEqual([1, 2, 5])
        expect(readOpened(2027)).toEqual([])
        expect(localStorage.getItem(adventStorageKey(2026))).toBe('[1,2,5]')
    })

    it('ignores what is not a door', () => {
        localStorage.setItem(adventStorageKey(2026), JSON.stringify([0, 3, 25, 'x', 7.5, 24]))

        expect(readOpened(2026)).toEqual([3, 24])
    })

    it('reads nothing and writes nothing when storage is blocked', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked')
        })
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('blocked')
        })

        expect(readOpened(2026)).toEqual([])
        expect(() => rememberOpened(2026, [1])).not.toThrow()
    })
})
