import { paths } from '@/config'
import useAxios from './useAxios'

export async function getChartItem(item: string, duration: string, limit: number, order_by: string, offset = 0) {
    const res = await useAxios({
        url: paths.api.stats.base + `/top-${item}?duration=${duration}&limit=${limit}&offset=${offset}&order_by=${order_by}`,
        method: 'GET',
    })

    return res
}

export async function getTopArtists(duration: string, limit: number, order_by: string) {
    return await getChartItem('artists', duration, limit, order_by)
}

export async function getTopAlbums(duration: string, limit: number, order_by: string) {
    return await getChartItem('albums', duration, limit, order_by)
}

export async function getTopTracks(duration: string, limit: number, order_by: string) {
    return await getChartItem('tracks', duration, limit, order_by)
}

// Without a period the server answers for the week — what the search page's
// library numbers want. The stats page passes the charts' period (#523).
export async function getStats(period?: string) {
    const res = await useAxios({
        url: paths.api.stats.base + '/stats' + (period ? `?period=${encodeURIComponent(period)}` : ''),
        method: 'GET',
    })

    return res
}
/** The listening calendar: a year of days and both streaks (#525). */
export async function getListeningCalendar() {
    return await useAxios({
        url: paths.api.stats.base + '/calendar',
        method: 'GET',
    })
}

/** The listening clock (#535): seconds per weekday (Monday first) and hour. */
export interface ClockPeak {
    day: number
    hour: number
    seconds: number
}

export interface ClockPayload {
    days: number[][]
    total: number
    peak_hour: ClockPeak | null
    peak_day: { day: number; seconds: number } | null
    dates: string
}

/**
 * The skip quote (#537). `share` is the part of a track's plays that were
 * skipped (under `rules.skip_below` of the track) or finished. The overall
 * `rate` is a lower bound: plays under 5 s are never logged.
 */
export interface SkipRow {
    trackhash: string
    plays: number
    share: number
    track: { trackhash: string; title: string; artists: { name: string }[] }
    skipped?: number
    finished?: number
}

export interface SkipRatePayload {
    plays: number
    skipped: number
    rate: number | null
    most_skipped: SkipRow[]
    to_the_end: SkipRow[]
    rules: { skip_below: number; finished_from: number; min_plays: number; always: number }
    dates: string
}

/** How often the period's tracks were skipped, and which were always played to the end (#537). */
export async function getSkipRate(period: string) {
    return await useAxios({
        url: paths.api.stats.base + `/skips?period=${encodeURIComponent(period)}`,
        method: 'GET',
    })
}

/** When in the week the music plays, over the stats page's period (#535). */
export async function getListeningClock(period: string) {
    return await useAxios({
        url: paths.api.stats.base + `/clock?period=${encodeURIComponent(period)}`,
        method: 'GET',
    })
}

/**
 * The years a Rewind opens for: finished years with plays, oldest first
 * (#527); `seen`, the years seen to the end; `fresh`, the latest year while it
 * is unseen (#572) — the one that announces itself.
 */
export interface RewindYears {
    years: number[]
    seen: number[]
    fresh: number | null
}

export async function getRewindYears() {
    return await useAxios({
        url: paths.api.stats.base + '/rewind/years',
        method: 'GET',
    })
}

/** A Rewind seen to the end (#572): it stops announcing itself. The guest account answers 403. */
export async function markRewindSeen(year: number) {
    return await useAxios({
        url: paths.api.stats.base + '/rewind/seen',
        method: 'POST',
        props: { year },
    })
}

/**
 * AivinNet Rewind: one year of listening (#527); without a year, the latest
 * finished one. A year still running answers 404 — it opens on January 1.
 */
export async function getRewind(year?: number) {
    return await useAxios({
        url: paths.api.stats.base + '/rewind' + (year ? `?year=${year}` : ''),
        method: 'GET',
    })
}

/**
 * The records board (#540): the longest session, the day one track was played
 * most, and the plays with a milestone number. Counted hourly on the server.
 */
export async function getRecords() {
    return await useAxios({
        url: paths.api.stats.base + '/records',
        method: 'GET',
    })
}

/**
 * The artists and albums first heard in the period (#539), the latest
 * discovery first, as cards — what the stats page's "new" tile counts.
 */
export async function getDiscoveries(period: string) {
    return await useAxios({
        url: paths.api.stats.base + `/discoveries?period=${encodeURIComponent(period)}`,
        method: 'GET',
    })
}
