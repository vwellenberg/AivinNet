/**
 * The New Year's review card on Home (components/HomeView/YearInMusicCard.vue, #674):
 * "Your year in music", a door into Rewind for the year that is ending.
 *
 * It shows on 31 December only (1 January is the January Rewind card's day, #572, so
 * the two would otherwise stand one above the other), and only when Rewind has
 * something for this year (`years`, the answer to the Rewind years request in
 * requests/stats.ts). Dismissed for the
 * year, it stays away until the next New Year's Eve. The Appearance preview shows it
 * on any day, as the countdown does.
 */

/** The localStorage key holding the year the card was dismissed for. */
export const DISMISSED_KEY = 'aivinnet.yearInMusicDismissed'

/**
 * The year the card opens Rewind for, or null when it stays hidden: not 31 December
 * (unless previewed), no Rewind for this year yet, or already dismissed for it.
 */
export function yearInMusicYear(
    years: readonly number[],
    dismissedFor: number | null,
    now: Date,
    preview = false,
): number | null {
    const onNewYearsEve = now.getMonth() === 11 && now.getDate() === 31
    if (!preview && !onNewYearsEve) return null
    const year = now.getFullYear()
    if (!years.includes(year)) return null
    if (dismissedFor === year) return null
    return year
}

/** The year the card was dismissed for on this device, or null (also when storage is blocked). */
export function readDismissedYear(): number | null {
    try {
        const raw = window.localStorage.getItem(DISMISSED_KEY)
        if (raw === null) return null
        const year = Number(raw)
        return Number.isInteger(year) ? year : null
    } catch {
        // Private window or blocked site data: the card comes back on the next visit.
        return null
    }
}

/** Remembers the dismissal for `year`. A blocked store just forgets it. */
export function rememberDismissedYear(year: number): void {
    try {
        window.localStorage.setItem(DISMISSED_KEY, String(year))
    } catch {
        // Nothing to remember it in: the card returns, which is the safe side.
    }
}
