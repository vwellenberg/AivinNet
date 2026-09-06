/**
 * Pager math for the stats charts (ChartItemGroup).
 *
 * The backend windows its sorted chart list via offset/limit and reports the
 * pre-slice `total`; the client only needs page arithmetic. Pages are 0-based
 * here and rendered 1-based.
 */

export const CHART_PAGE_SIZES = [10, 50] as const
export type ChartPageSize = (typeof CHART_PAGE_SIZES)[number]

export function pageCount(total: number, pageSize: number): number {
    if (pageSize <= 0) return 1
    return Math.max(1, Math.ceil(total / pageSize))
}

/** Clamp a 0-based page into the range the total actually has. */
export function clampPage(page: number, total: number, pageSize: number): number {
    return Math.min(Math.max(0, page), pageCount(total, pageSize) - 1)
}
