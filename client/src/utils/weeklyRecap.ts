import type { WeeklyRecap } from '@/requests/home'

/**
 * The words of the Home recap card (#530), from what the server counted.
 *
 * "Last week" / "14 hrs, 3 mins" / "mostly Dream.Corp · 3 new albums · top
 * track Stoned". A part with nothing to say is left out, not written as "0".
 */
export function recapLines(recap: WeeklyRecap): { kicker: string; headline: string; detail: string } {
    const detail: string[] = []

    if (recap.top_artist) detail.push(`mostly ${recap.top_artist.name}`)
    if (recap.new_albums > 0) detail.push(`${recap.new_albums} new ${recap.new_albums === 1 ? 'album' : 'albums'}`)
    if (recap.top_track) detail.push(`top track ${recap.top_track.title}`)

    return {
        kicker: recap.kind === 'month' ? 'Last month' : 'Last week',
        headline: recap.listened,
        detail: detail.join(' · '),
    }
}
