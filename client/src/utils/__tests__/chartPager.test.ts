import { describe, expect, it } from 'vitest'

import { CHART_PAGE_SIZES, clampPage, pageCount } from '../chartPager'

describe('pageCount', () => {
    it('rounds up to whole pages', () => {
        expect(pageCount(23, 10)).toBe(3)
        expect(pageCount(50, 50)).toBe(1)
        expect(pageCount(51, 50)).toBe(2)
    })

    it('reports one page for an empty list', () => {
        expect(pageCount(0, 10)).toBe(1)
    })
})

describe('clampPage', () => {
    it('keeps a valid page', () => {
        expect(clampPage(1, 23, 10)).toBe(1)
    })

    it('clamps beyond-the-end onto the last page', () => {
        // Data shrank underneath the pager (e.g. period switch on page 5).
        expect(clampPage(4, 23, 10)).toBe(2)
    })

    it('clamps negatives to the first page', () => {
        expect(clampPage(-1, 23, 10)).toBe(0)
    })

    it('collapses to the first page when the size grows past the total', () => {
        // Page 3 at 10/page, then "50 per page": everything fits one page.
        expect(clampPage(2, 23, 50)).toBe(0)
    })
})

describe('CHART_PAGE_SIZES', () => {
    it('is 10 by default with 50 one click away', () => {
        expect(CHART_PAGE_SIZES).toEqual([10, 50])
    })
})
