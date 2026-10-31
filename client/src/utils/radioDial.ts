/**
 * The radio, AivinNet FM (#542, #640): the dial between stations. Pure, so the
 * component and the tuner share one answer and the tests can pin it without a
 * DOM.
 *
 * A station is a generated playlist: the local mixes ("Your mixes", `mix1` …
 * `mix4`), the genre stations (`genre1` …) and the decade stations (`decade1`
 * …). The server lists the ones a user has (`GET /nothome/stations`), and only
 * those are on the dial.
 */

export type StationKind = 'mix' | 'genre' | 'decade'

export interface Station {
    /** The playlist the station plays, by the id the playlist endpoint knows. */
    id: string
    name: string
    kind: StationKind
}

/** One station as `GET /nothome/stations` lists it. */
export interface StationEntry {
    id: string
    kind: StationKind
    name: string
}

/**
 * The stations the server lists, on the dial in dial order: mixes, genres,
 * decades (`buildStations`), whatever order the list came in.
 */
export function stationsFromList(entries: StationEntry[]): Station[] {
    const stations = entries.map(entry => ({ id: entry.id, name: entry.name || entry.id, kind: entry.kind }))

    return buildStations({
        mixes: stations.filter(station => station.kind === 'mix'),
        genres: stations.filter(station => station.kind === 'genre'),
        decades: stations.filter(station => station.kind === 'decade'),
    })
}

/**
 * Whether Home shows the dial at all. Mixes alone would only repeat the
 * "Your mixes" row right below it (why #646 hid it), so it takes at least one
 * genre or decade station to be worth a place.
 */
export function dialIsWorthShowing(stations: Station[]): boolean {
    return stations.some(station => station.kind !== 'mix')
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

// SECTION: THE FM DIAL (the frequencies, the labels, the readout)

/** The bottom and the top of the FM band, in MHz. */
export const FM_LOW_MHZ = 87.5
export const FM_HIGH_MHZ = 108.0

/**
 * The frequency of a station by its place on the dial, one decimal: the first
 * station sits at 87.5, the last at 108.0, the rest spread evenly between
 * (`stationFraction`, so the scale ticks and the frequencies agree). Strictly
 * increasing up to about 200 stations, which the dial never comes near.
 */
export function stationFrequency(index: number, count: number): string {
    const mhz = FM_LOW_MHZ + (FM_HIGH_MHZ - FM_LOW_MHZ) * stationFraction(index, count)
    return (Math.round(mhz * 10) / 10).toFixed(1)
}

/** The kind of a station as the readout names it. */
const KIND_NAME: Record<StationKind, string> = { mix: 'MIX', genre: 'GENRE', decade: 'DECADE' }

/**
 * What the display shows for a station: its name, the kind line
 * ("GENRE · 91.3 FM") and the value the dial announces ("Jazz, 91.3 FM").
 */
export function stationReadout(station: Station, index: number, count: number): { name: string; kind: string; valueText: string } {
    const frequency = `${stationFrequency(index, count)} FM`

    return {
        name: station.name,
        kind: `${KIND_NAME[station.kind]} · ${frequency}`,
        valueText: `${station.name}, ${frequency}`,
    }
}

/** Gap kept clear between two frequency labels on the scale, px. */
export const FREQUENCY_LABEL_GAP_PX = 8

/** A frequency label ("108.0") in em of its font size: a little generous, the face is bold and tabular. */
export const FREQUENCY_LABEL_EM = 3

/** The width of a frequency label at a font size, px (an estimate, the label is centred on its tick). */
export function frequencyLabelWidth(fontPx: number): number {
    return Math.ceil(FREQUENCY_LABEL_EM * fontPx)
}

/**
 * Every how many stations the scale gets a frequency label, so that no two
 * shown labels overlap. A label is centred on its tick. An unknown width (not
 * measured yet, or a hidden dial) shows only the first label: never a pile.
 */
export function labelEvery(scaleWidth: number, count: number, labelWidth: number, gap = FREQUENCY_LABEL_GAP_PX): number {
    if (count <= 1) return 1
    if (!(scaleWidth > 0)) return count

    const spacing = scaleWidth / (count - 1)
    const need = (labelWidth > 0 ? labelWidth : 0) + gap
    return Math.min(count, Math.max(1, Math.ceil(need / spacing)))
}
