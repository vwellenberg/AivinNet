/**
 * AivinNet Rewind as a story image (#558): where every word and block of the
 * 1080 × 1920 card sits, as plain data. The browser draws it
 * (rewindStoryImage.ts); nothing here touches a canvas, so the text fitting is
 * tested with a fake measure.
 */

import { type RewindPayload, listened, listenerText, minutes, playCount, trackLine } from './rewind'

export const STORY_WIDTH = 1080
export const STORY_HEIGHT = 1920

const MARGIN = 96
const ELLIPSIS = '…'
const COVER = 260
const COVER_GAP = 48

/** The Memphis roles the card paints with; the browser resolves each one. */
export type Role = 'ink' | 'paper' | 'lavender' | 'yellow'

export type Measure = (text: string, font: string) => number

export type StoryItem =
    | { kind: 'band'; y: number; height: number; role: Role }
    | { kind: 'text'; x: number; y: number; text: string; font: string; role: Role }
    | { kind: 'cover'; x: number; y: number; size: number }

export interface StoryLayout {
    items: StoryItem[]
}

/** What the card says, already formatted (see rewind.ts). A null section is left out. */
export interface StoryFacts {
    year: number
    /** "12,345" */
    minutes: string
    topArtist: { name: string; time: string } | null
    /** Whether the artist's cover loaded: its slot is then left for it. */
    cover: boolean
    /** "Blue — The Artist" */
    topTrack: string | null
    summer: { track: string; plays: string } | null
    listener: { title: string; share: string } | null
}

/**
 * The text that fits in `maxWidth`, cut with an ellipsis when it does not.
 * Empty when not even the ellipsis fits. Cuts by code point, so an emoji or an
 * accented letter is never split in two.
 */
export function fitText(text: string, maxWidth: number, font: string, measure: Measure): string {
    if (measure(text, font) <= maxWidth) return text
    if (measure(ELLIPSIS, font) > maxWidth) return ''

    const chars = [...text]
    // The longest cut whose ellipsis still fits; a line only gets wider with length.
    let lo = 0
    let hi = chars.length
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2)
        if (measure(cut(chars, mid), font) <= maxWidth) lo = mid
        else hi = mid - 1
    }
    return cut(chars, lo)
}

function cut(chars: string[], n: number): string {
    return chars.slice(0, n).join('').trimEnd() + ELLIPSIS
}

/** The saved file's name: aivinnet-rewind-2026.png */
export function storyFilename(year: number): string {
    return `aivinnet-rewind-${year}.png`
}

/** The card's words, from the payload the Rewind page already holds. */
export function storyFacts(data: RewindPayload, cover: boolean): StoryFacts {
    const artist = data.top_artists[0]
    const listener = listenerText(data.listener)
    const summer = data.summer_track
    return {
        year: data.year,
        minutes: minutes(data.seconds),
        topArtist: artist ? { name: artist.name ?? '', time: listened(artist.seconds ?? 0) } : null,
        cover,
        topTrack: data.top_tracks[0] ? trackLine(data.top_tracks[0]) : null,
        summer: summer ? { track: trackLine(summer.track), plays: playCount(summer.plays) } : null,
        listener: listener ? { title: listener.title, share: listener.share } : null,
    }
}

/**
 * Lays the card out top to bottom. `family` is the app font's CSS family list;
 * `measure` answers the width of a line in a given font. Sections without
 * content are left out, and the ones below move up.
 */
export function layoutStory(facts: StoryFacts, family: string, measure: Measure): StoryLayout {
    const width = STORY_WIDTH - 2 * MARGIN
    const font = (weight: number, size: number) => `${weight} ${size}px ${family}`
    const items: StoryItem[] = []

    const text = (x: number, y: number, value: string, f: string, role: Role, maxWidth: number) => {
        const fitted = fitText(value, maxWidth, f, measure)
        if (fitted) items.push({ kind: 'text', x, y, text: fitted, font: f, role })
    }
    const label = (y: number, value: string) => text(MARGIN, y, value, font(700, 40), 'ink', width)

    // The ground, the year's plate in lavender, and the footer strip in yellow.
    items.push({ kind: 'band', y: 0, height: STORY_HEIGHT, role: 'paper' })
    items.push({ kind: 'band', y: 0, height: 660, role: 'lavender' })
    text(MARGIN, 120, 'AIVINNET · REWIND', font(700, 44), 'ink', width)
    text(MARGIN, 400, String(facts.year), font(900, 260), 'ink', width)
    text(MARGIN, 560, facts.minutes, font(900, 130), 'ink', width)
    text(MARGIN, 630, 'minutes of music', font(700, 48), 'ink', width)

    let y = 720
    if (facts.topArtist) {
        label(y, 'YOUR TOP ARTIST')
        const x = facts.cover ? MARGIN + COVER + COVER_GAP : MARGIN
        const w = facts.cover ? width - COVER - COVER_GAP : width
        if (facts.cover) items.push({ kind: 'cover', x: MARGIN, y: y + 40, size: COVER })
        text(x, y + 80, facts.topArtist.name, font(800, 64), 'ink', w)
        text(x, y + 150, facts.topArtist.time, font(700, 40), 'ink', w)
        y += COVER + 104
    }
    if (facts.topTrack) {
        label(y, 'YOUR TOP TRACK')
        text(MARGIN, y + 96, facts.topTrack, font(800, 56), 'ink', width)
        y += 164
    }
    if (facts.summer) {
        label(y, 'SONG OF YOUR SUMMER')
        text(MARGIN, y + 96, facts.summer.track, font(800, 56), 'ink', width)
        text(MARGIN, y + 152, `${facts.summer.plays} from June to August`, font(700, 40), 'ink', width)
        y += 216
    }
    if (facts.listener) {
        label(y, 'HOW YOU LISTEN')
        text(MARGIN, y + 96, facts.listener.title, font(900, 72), 'ink', width)
        text(MARGIN, y + 156, `${facts.listener.share} of your plays`, font(700, 44), 'ink', width)
    }

    items.push({ kind: 'band', y: STORY_HEIGHT - 128, height: 128, role: 'yellow' })
    text(MARGIN, STORY_HEIGHT - 54, 'AivinNet', font(800, 44), 'ink', width)

    return { items }
}
