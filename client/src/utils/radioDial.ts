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

/** `season`: the Christmas station or the New Year's Eve countdown, which the server puts first while its season runs. */
export type StationKind = 'mix' | 'genre' | 'decade' | 'season'

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
 * The stations the server lists, on the dial in dial order: the season's,
 * mixes, genres, decades (`buildStations`), whatever order the list came in.
 */
export function stationsFromList(entries: StationEntry[]): Station[] {
    const stations = entries.map(entry => ({ id: entry.id, name: entry.name || entry.id, kind: entry.kind }))

    return buildStations({
        seasons: stations.filter(station => station.kind === 'season'),
        mixes: stations.filter(station => station.kind === 'mix'),
        genres: stations.filter(station => station.kind === 'genre'),
        decades: stations.filter(station => station.kind === 'decade'),
    })
}

/**
 * Whether Home shows the dial at all. Mixes alone would only repeat the
 * "Your mixes" row right below it (why #646 hid it), so it takes a genre, a
 * decade or a seasonal station to be worth a place. A season is one on its own:
 * at Christmas the dial exists for the Christmas station, whatever else there is.
 */
export function dialIsWorthShowing(stations: Station[]): boolean {
    return stations.some(station => station.kind === 'genre' || station.kind === 'decade' || station.kind === 'season')
}

/** Seasons, then mixes, then genres, then decades: the order the dial runs in. No station twice. */
export function buildStations(lists: {
    seasons?: Station[]
    mixes?: Station[]
    genres?: Station[]
    decades?: Station[]
}): Station[] {
    const seen = new Set<string>()
    const all = [
        ...(lists.seasons ?? []),
        ...(lists.mixes ?? []),
        ...(lists.genres ?? []),
        ...(lists.decades ?? []),
    ]

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

/** The kind as the display and the legend name it. */
export const KIND_LABEL: Record<StationKind, string> = { mix: 'MIX', genre: 'GENRE', decade: 'DECADE', season: 'SEASON' }

/**
 * What the display shows for a station: its name, the kind line
 * ("GENRE · 91.3 FM") and the value the dial announces ("Jazz, 91.3 FM").
 */
export function stationReadout(station: Station, index: number, count: number): { name: string; kind: string; valueText: string } {
    const frequency = `${stationFrequency(index, count)} FM`

    return {
        name: station.name,
        kind: `${KIND_LABEL[station.kind]} · ${frequency}`,
        valueText: `${station.name}, ${frequency}`,
    }
}

/** The kinds in the order the dial shows them: the season's first, as the list does. */
export const KIND_ORDER: StationKind[] = ['season', 'mix', 'genre', 'decade']

/** The band's frequency labels, MHz. Fixed, not per station: they never collide. */
export const BAND_LABELS_MHZ = [88, 92, 96, 100, 104, 108]

/** Minor ticks every half MHz, majors on the whole ones. */
export const BAND_TICK_STEP_MHZ = 0.5

/** Where a frequency stands on the band, 0 (87.5) to 1 (108.0). */
export function bandFraction(mhz: number): number {
    return (mhz - FM_LOW_MHZ) / (FM_HIGH_MHZ - FM_LOW_MHZ)
}

/** One tick of the band: where it stands, and whether it is a whole MHz (a major). */
export interface BandTick {
    fraction: number
    major: boolean
}

/** Every tick of the band, from 87.5 to 108.0 in half-MHz steps. */
export function bandTicks(): BandTick[] {
    const ticks: BandTick[] = []
    const steps = Math.round((FM_HIGH_MHZ - FM_LOW_MHZ) / BAND_TICK_STEP_MHZ)
    for (let s = 0; s <= steps; s++) {
        const mhz = FM_LOW_MHZ + s * BAND_TICK_STEP_MHZ
        ticks.push({ fraction: bandFraction(mhz), major: Number.isInteger(mhz) })
    }
    return ticks
}

/** The band's labels with where they stand, in MHz order. */
export function bandLabels(): { fraction: number; label: string }[] {
    return BAND_LABELS_MHZ.map(mhz => ({ fraction: bandFraction(mhz), label: String(mhz) }))
}

/** A stretch of the kind's colour on the band: from one fraction to another. */
export interface KindBand {
    kind: StationKind
    from: number
    to: number
}

/**
 * One coloured segment per kind on the dial, from half a step before its first
 * station to half a step after its last. A lone station gets a small segment
 * around its place.
 */
export function kindBands(stations: Station[]): KindBand[] {
    const count = stations.length
    const half = count > 1 ? 0.5 / (count - 1) : 0.05
    return KIND_ORDER.flatMap(kind => {
        const at = stations.flatMap((station, i) => (station.kind === kind ? [i] : []))
        if (at.length === 0) return []
        const first = stationFraction(at[0], count)
        const last = stationFraction(at[at.length - 1], count)
        return [{ kind, from: Math.max(0, first - half), to: Math.min(1, last + half) }]
    })
}

/** The kinds that have a station on the dial, in dial order: the legend lists these. */
export function kindsOnDial(stations: Station[]): StationKind[] {
    return KIND_ORDER.filter(kind => stations.some(station => station.kind === kind))
}

/**
 * The signal bars on the display, 0 to 4: all four on a station, none half way
 * between two. The needle's distance to the nearest station decides it.
 */
export function signalBars(position: number): number {
    const distance = Math.abs(position - Math.round(position))
    return Math.round((1 - 2 * distance) * 4)
}

/** The air state of the display: ON AIR while music plays from a tuned station, TUNING during a drag, else STANDBY. */
export type AirState = 'on' | 'tuning' | 'off'

export function airState(state: { tuned: boolean; playing: boolean; dragging: boolean }): AirState {
    if (state.dragging) return 'tuning'
    return state.tuned && state.playing ? 'on' : 'off'
}

/** The text of an air state on the display. */
export const AIR_TEXT: Record<AirState, string> = { on: 'ON AIR', tuning: 'TUNING', off: 'STANDBY' }

/** The knob's sweep, in degrees: from the left stop to the right one. */
export const KNOB_SWEEP_START_DEG = -135
export const KNOB_SWEEP_DEG = 270

/** The knob's angle for a needle position: -135 at the first station, +135 at the last. */
export function knobAngle(position: number, count: number): number {
    return KNOB_SWEEP_START_DEG + KNOB_SWEEP_DEG * stationFraction(position, count)
}

/** Pixels of vertical or horizontal knob movement per station. */
export const KNOB_PX_PER_STATION = 26

/**
 * Where a knob drag lands: the start position moved by the drag (right and up
 * turn it on), clamped to the dial, fractional like `dragPosition`.
 */
export function knobDragPosition(start: number, dx: number, dy: number, count: number, pxPerStation: number): number {
    if (count <= 1 || pxPerStation <= 0) return 0
    const position = start + (dx - dy) / pxPerStation
    return Math.min(Math.max(position, 0), count - 1)
}

/** The bezel tick nearest the knob's angle: the one that lights up. 21 ticks, index 0 at the left stop. */
export const BEZEL_TICK_COUNT = 21

export function litBezelTick(position: number, count: number): number {
    return Math.round(stationFraction(position, count) * (BEZEL_TICK_COUNT - 1))
}

/** One tick of the knob's bezel: its end points on a 120 px box centred on 60, and whether it is major. */
export function bezelTick(index: number): { x1: number; y1: number; x2: number; y2: number; major: boolean } {
    const angle = ((KNOB_SWEEP_START_DEG + index * (KNOB_SWEEP_DEG / (BEZEL_TICK_COUNT - 1))) * Math.PI) / 180
    const major = index % 2 === 0
    const inner = major ? 50 : 53
    const outer = 58
    return {
        x1: 60 + inner * Math.sin(angle),
        y1: 60 - inner * Math.cos(angle),
        x2: 60 + outer * Math.sin(angle),
        y2: 60 - outer * Math.cos(angle),
        major,
    }
}

/** The stations either side of the one at `index`: null at the ends of the dial. */
export function neighbours(stations: Station[], index: number): { prev: Station | null; next: Station | null } {
    return {
        prev: index > 0 ? (stations[index - 1] ?? null) : null,
        next: index < stations.length - 1 ? (stations[index + 1] ?? null) : null,
    }
}
