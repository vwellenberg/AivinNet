import { describe, expect, it } from 'vitest'

import { accentAt, STAT_ACCENTS } from '@/utils/statAccents'

describe('accentAt', () => {
    it('hands out the accents in turn and starts over after the last', () => {
        expect(accentAt(0)).toBe('var(--mem-teal)')
        expect(accentAt(1)).toBe('var(--mem-coral)')
        expect(accentAt(STAT_ACCENTS.length)).toBe(accentAt(0))
    })

    it('neighbours never share an accent', () => {
        for (let i = 0; i < STAT_ACCENTS.length * 2; i++) expect(accentAt(i)).not.toBe(accentAt(i + 1))
    })
})
