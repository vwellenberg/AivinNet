/**
 * The Advent calendar on Home: which doors a user may open,
 * and which of them this device has opened.
 *
 * The server decides the day and the albums (`GET /nothome/advent`); the
 * client only knows that a door is openable from its day on, and remembers
 * the opened doors per year in `localStorage`. That memory is a convenience:
 * blocked storage means no remembered doors, never an error.
 */

export const ADVENT_DOORS = 24

/** A door opens on its day and stays openable: today's and the past, never the future. */
export function doorOpenable(door: number, today: number): boolean {
    return Number.isInteger(door) && door >= 1 && door <= Math.min(today, ADVENT_DOORS)
}

export function adventStorageKey(year: number): string {
    return `aivinnet.advent.${year}`
}

/** The doors this device has opened in `year`, as day numbers. */
export function readOpened(year: number): number[] {
    try {
        const raw = localStorage.getItem(adventStorageKey(year))
        const parsed: unknown = raw ? JSON.parse(raw) : []
        if (!Array.isArray(parsed)) return []
        return parsed.filter(
            (door): door is number => Number.isInteger(door) && door >= 1 && door <= ADVENT_DOORS,
        )
    } catch {
        // Blocked or corrupt storage: nothing remembered, the doors start closed.
        return []
    }
}

/** Remember the opened doors of `year`. A failed write only means they start closed next time. */
export function rememberOpened(year: number, opened: readonly number[]): void {
    try {
        const doors = [...new Set(opened)].sort((a, b) => a - b)
        localStorage.setItem(adventStorageKey(year), JSON.stringify(doors))
    } catch {
        // Blocked storage: the doors are still open for this visit.
    }
}
