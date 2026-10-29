/**
 * Subspace radio (#542): the dial between stations. Pure, so the component and
 * the tuner share one answer and the tests can pin it without a DOM.
 *
 * A station is a generated playlist. Today those are the local mixes
 * ("Your mixes", `mix1` … `mix4`); genre and decade stations have no playlist
 * on the server yet, so the caller passes none.
 */

export type StationKind = 'mix' | 'genre' | 'decade'

export interface Station {
    /** The playlist the station plays, by the id the playlist endpoint knows. */
    id: string
    name: string
    kind: StationKind
}

/** A card of a home row as the client keeps it (`HomePageItem.items`). */
export interface PlaylistCard {
    type: string
    item?: { id?: string | number; name?: string; count?: number }
}

const MIX_ID = /^mix\d+$/

/** The stations of "Your mixes": playlist cards whose id is a mix slot. */
export function stationsFromMixes(cards: PlaylistCard[]): Station[] {
    return cards.flatMap(card => {
        const id = card.item?.id
        if (card.type !== 'playlist' || typeof id !== 'string' || !MIX_ID.test(id)) return []
        // A slot with no tracks is no station to tune to.
        if (card.item?.count === 0) return []
        return [{ id, name: card.item?.name || id, kind: 'mix' }]
    })
}

/** Mixes, then genres, then decades: the order the dial runs in. No station twice. */
export function buildStations(lists: { mixes?: Station[]; genres?: Station[]; decades?: Station[] }): Station[] {
    const seen = new Set<string>()
    const all = [...(lists.mixes ?? []), ...(lists.genres ?? []), ...(lists.decades ?? [])]

    return all.filter(station => {
        if (!station.id || seen.has(station.id)) return false
        seen.add(station.id)
        return true
    })
}

/** The nearest station index on the dial. An empty dial has index 0. */
export function snapIndex(position: number, count: number): number {
    if (count <= 0 || !Number.isFinite(position)) return 0
    return Math.min(Math.max(Math.round(position), 0), count - 1)
}

/** Where a drag that started on `start` and moved `dx` px lands (fractional). */
export function dragPosition(start: number, dx: number, width: number, count: number): number {
    if (count <= 1 || width <= 0) return 0
    const position = start + (dx / width) * (count - 1)
    return Math.min(Math.max(position, 0), count - 1)
}

/** Wheel pixels per station. A trackpad sends many small events; the rest carries over. */
export const WHEEL_PX_PER_STATION = 50

/** Whole stations a wheel movement adds up to (positive = next), and the rest for later. */
export function wheelSteps(deltaY: number, rest: number): { steps: number; rest: number } {
    const total = rest + deltaY
    const steps = Math.trunc(total / WHEEL_PX_PER_STATION)
    return { steps, rest: total - steps * WHEEL_PX_PER_STATION }
}

/**
 * The station a key moves the dial to, or null for a key the dial ignores.
 * Arrows and Page keys step by one station; Home and End go to the ends.
 */
export function keyTarget(key: string, index: number, count: number): number | null {
    switch (key) {
        case 'ArrowRight':
        case 'ArrowUp':
        case 'PageUp':
            return snapIndex(index + 1, count)
        case 'ArrowLeft':
        case 'ArrowDown':
        case 'PageDown':
            return snapIndex(index - 1, count)
        case 'Home':
            return count > 0 ? 0 : null
        case 'End':
            return count > 0 ? count - 1 : null
        default:
            return null
    }
}

/** Where a station stands on the scale, 0 (first) to 1 (last). A lone station sits in the middle. */
export function stationFraction(index: number, count: number): number {
    return count <= 1 ? 0.5 : index / (count - 1)
}

/** Whether the user asked for less motion. No `matchMedia` (jsdom, old browsers) counts as no. */
export function prefersReducedMotion(win: Window | undefined = typeof window === 'undefined' ? undefined : window): boolean {
    return !!win && typeof win.matchMedia === 'function' && win.matchMedia('(prefers-reduced-motion: reduce)').matches
}
