/**
 * The charts' period as words, for everything on the stats page that is not
 * the period tabs themselves (#523).
 *
 * The tiles under the charts were fixed to the week, and the caption above them
 * said so ("for the past week") whatever the tabs showed. Both follow the tabs
 * now; the server names the period on each tile, this names it in the caption.
 */

export const STATS_PERIODS = ['day', 'week', 'month', 'year', 'alltime'] as const
export type StatsPeriod = (typeof STATS_PERIODS)[number]

const PHRASE: Record<StatsPeriod, string> = {
    day: 'for today',
    week: 'for this week',
    month: 'for this month',
    year: 'for this year',
    alltime: 'of all time',
}

export function isStatsPeriod(period: string): period is StatsPeriod {
    return (STATS_PERIODS as readonly string[]).includes(period)
}

/**
 * A period the server accepts. A value persisted by another build would get a
 * 422 for the tiles while the caption named something else; both read this.
 */
export function normalizeStatsPeriod(period: string): StatsPeriod {
    return isStatsPeriod(period) ? period : 'week'
}

/** "Your listening stats …" */
export function statsPeriodPhrase(period: string): string {
    return PHRASE[normalizeStatsPeriod(period)]
}
