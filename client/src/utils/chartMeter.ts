/**
 * Chart leaderboard helpers (Stats → Charts).
 *
 * The meter shows each row's play duration relative to the chart's #1 — the
 * backend sends the raw seconds as `extra.playduration` per item and the
 * period's maximum as `max_playduration` on the response root. Both fields
 * are additive: an older backend sends neither, and the meter simply hides
 * (meterPercent → null), so client and backend can deploy independently.
 */

/** Smallest rendered share: a row that charted deserves a visible sliver. */
export const CHART_METER_MIN_PCT = 2

/**
 * The meter width for one row, clamped to [CHART_METER_MIN_PCT, 100].
 * `null` means "render no meter" — missing/invalid data must not draw an
 * empty frame that reads as "zero plays".
 */
export function meterPercent(
    duration: number | null | undefined,
    max: number | null | undefined
): number | null {
    if (typeof duration !== 'number' || !isFinite(duration) || duration <= 0) {
        return null
    }
    if (typeof max !== 'number' || !isFinite(max) || max <= 0) {
        return null
    }

    const pct = Math.round((duration / max) * 100)
    return Math.min(100, Math.max(CHART_METER_MIN_PCT, pct))
}

/**
 * The row's rank-accent class: the top 3 wear their badge colour (yellow /
 * lavender / pink), everything else stays neutral. Rank is the ABSOLUTE
 * chart position — on page 2 of a 10-per-page chart there is no podium.
 */
export function rankBadgeClass(rank: number): string {
    return rank === 1 || rank === 2 || rank === 3 ? `r${rank}` : ''
}

/** The raw play duration of a chart item, or null when the backend omits it. */
export function chartItemDuration(item: { extra?: { playduration?: unknown } }): number | null {
    const duration = item.extra?.playduration
    return typeof duration === 'number' && isFinite(duration) && duration > 0 ? duration : null
}
