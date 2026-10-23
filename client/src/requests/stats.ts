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

/** The years a Rewind opens for: finished years with plays, oldest first (#527). */
export async function getRewindYears() {
    return await useAxios({
        url: paths.api.stats.base + '/rewind/years',
        method: 'GET',
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
