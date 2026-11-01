/**
 * The charts' period as words, for everything on the stats page that is not
 * the period tabs themselves (#523).
 *
 * The tiles under the charts were fixed to the week, and the caption above them
 * said so ("for the past week") whatever the tabs showed. Both follow the tabs
 * now; the server names the period on each tile, this names it in the caption.
 */

export const STATS_PERIODS = ['day', 'week', 'month', 'year', 'alltime', 'lastweek', 'lastmonth'] as const
export type StatsPeriod = (typeof STATS_PERIODS)[number]

/**
 * The tab row. `lastweek` and `lastmonth` are not tabs: the recap card opens
 * them, and the chart header shows them as one extra active tab until the user
 * picks another period (ChartsHeader.vue).
 */
export const STATS_TABS = ['day', 'week', 'month', 'year', 'alltime'] as const

const PHRASE: Record<StatsPeriod, string> = {
    day: 'for today',
    week: 'for this week',
    month: 'for this month',
    year: 'for this year',
    alltime: 'of all time',
    lastweek: 'for last week',
    lastmonth: 'for last month',
}

// The tab's words. The tabs are uppercase on screen, so a bare key would read
// "LASTWEEK"; the others keep their key, as they always have.
const LABEL: Record<StatsPeriod, string> = {
    day: 'day',
    week: 'week',
    month: 'month',
    year: 'year',
    alltime: 'alltime',
    lastweek: 'Last week',
    lastmonth: 'Last month',
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

/** The words on a period tab. */
export function statsPeriodLabel(period: string): string {
    return LABEL[normalizeStatsPeriod(period)]
}

/** The tab row's own periods, in order. */
export function isStatsTab(period: string): boolean {
    return (STATS_TABS as readonly string[]).includes(period)
}
