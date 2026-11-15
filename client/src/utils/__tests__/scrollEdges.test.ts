import { describe, expect, it } from 'vitest'

import { scrollEdges } from '../scrollEdges'

describe('scrollEdges', () => {
    it('at rest at the top with overflow: only the bottom edge has content beyond it', () => {
        expect(scrollEdges(0, 300, 1000)).toEqual({ top: false, bottom: true })
    })

    it('in the middle of the list: both edges have content beyond them', () => {
        expect(scrollEdges(300, 300, 1000)).toEqual({ top: true, bottom: true })
    })

    it('at the end of the list: only the top edge has content beyond it', () => {
        expect(scrollEdges(700, 300, 1000)).toEqual({ top: true, bottom: false })
    })

    it('no overflow: neither edge has content beyond it', () => {
        expect(scrollEdges(0, 300, 300)).toEqual({ top: false, bottom: false })
    })

    it('a sub-pixel remainder at the end is not an edge', () => {
        // Resting at the end with a fractional scrollTop: 699.5 + 300 is within 1px of 1000.
        expect(scrollEdges(699.5, 300, 1000)).toEqual({ top: true, bottom: false })
    })
})
