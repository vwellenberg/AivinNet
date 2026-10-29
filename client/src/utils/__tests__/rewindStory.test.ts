import { describe, expect, it } from 'vitest'

import type { RewindPayload } from '../rewind'
import {
    STORY_HEIGHT,
    STORY_WIDTH,
    type Measure,
    type StoryFacts,
    type StoryItem,
    fitText,
    layoutStory,
    storyFacts,
    storyFilename,
} from '../rewindStory'

// A monospace-ish measure: every character is 10 px, whatever the font says.
const fixed: Measure = text => [...text].length * 10
const FONT = '700 40px "Figtree", sans-serif'

const facts: StoryFacts = {
    year: 2026,
    minutes: '12,345',
    topArtist: { name: 'Red Hot Chili Peppers', time: '38 h 12 min' },
    cover: true,
    topTrack: 'Blue — The Artist',
    summer: { track: 'Summer — Primus', plays: '9 plays' },
    listener: { title: 'The album listener', share: '62%' },
}

function texts(items: StoryItem[]) {
    return items.flatMap(i => (i.kind === 'text' ? [i] : []))
}

function texted(items: StoryItem[], value: string) {
    return texts(items).find(t => t.text === value)
}

describe('fitText', () => {
    it('keeps a line that already fits', () => {
        expect(fitText('Blue', 100, FONT, fixed)).toBe('Blue')
    })

    it('cuts a line that does not fit, ending in an ellipsis within the width', () => {
        // 10 px a character: 8 characters is 80 px, one of them the ellipsis.
        const out = fitText('Red Hot Chili Peppers', 80, FONT, fixed)
        expect(out).toBe('Red Hot…')
        expect(fixed(out, FONT)).toBeLessThanOrEqual(80)
    })

    it('takes the longest cut that still fits, not a shorter one', () => {
        // 7 chars + ellipsis = 80 px exactly: the cut must keep all seven.
        expect(fitText('abcdefghijkl', 80, FONT, fixed)).toBe('abcdefg…')
    })

    it('does not leave a space in front of the ellipsis', () => {
        // "Red " would be 40 px with the ellipsis: the space goes, not the word.
        expect(fitText('Red Hot Chili', 50, FONT, fixed)).toBe('Red…')
    })

    it('returns nothing when not even the ellipsis fits', () => {
        expect(fitText('Blue', 5, FONT, fixed)).toBe('')
    })

    it('returns the text unchanged at exactly the width', () => {
        expect(fitText('abcd', 40, FONT, fixed)).toBe('abcd')
    })

    it('never splits a code point, so an emoji stays whole', () => {
        // Five emoji at 10 px each, 40 px allowed: three emoji and the ellipsis.
        const out = fitText('🎵🎵🎵🎵🎵', 40, FONT, fixed)
        expect(out).toBe('🎵🎵🎵…')
        expect([...out].every(c => c === '…' || c === '🎵')).toBe(true)
    })

    it('measures what it returns, for any width', () => {
        const text = 'Ünïcödé artist name with a very long title indeed'
        for (let width = 0; width <= 500; width += 7) {
            const out = fitText(text, width, FONT, fixed)
            expect(fixed(out, FONT), `width ${width}`).toBeLessThanOrEqual(width)
        }
    })
})

describe('storyFilename', () => {
    it('names the saved PNG after the year', () => {
        expect(storyFilename(2026)).toBe('aivinnet-rewind-2026.png')
    })
})

describe('layoutStory', () => {
    const layout = layoutStory(facts, 'Figtree, sans-serif', fixed)

    it('paints a paper ground, a lavender year plate and a yellow footer strip', () => {
        const bands = layout.items.flatMap(i => (i.kind === 'band' ? [i] : []))
        expect(bands[0]).toEqual({ kind: 'band', y: 0, height: STORY_HEIGHT, role: 'paper' })
        expect(bands).toContainEqual({ kind: 'band', y: 0, height: 660, role: 'lavender' })
        expect(bands).toContainEqual({ kind: 'band', y: STORY_HEIGHT - 128, height: 128, role: 'yellow' })
    })

    it('shows the year, the minutes and the five sections', () => {
        expect(texted(layout.items, '2026')).toBeDefined()
        expect(texted(layout.items, '12,345')).toBeDefined()
        expect(texted(layout.items, 'minutes of music')).toBeDefined()
        expect(texted(layout.items, 'YOUR TOP ARTIST')).toBeDefined()
        expect(texted(layout.items, 'Red Hot Chili Peppers')).toBeDefined()
        expect(texted(layout.items, 'YOUR TOP TRACK')).toBeDefined()
        expect(texted(layout.items, 'Blue — The Artist')).toBeDefined()
        expect(texted(layout.items, 'SONG OF YOUR SUMMER')).toBeDefined()
        expect(texted(layout.items, 'Summer — Primus')).toBeDefined()
        expect(texted(layout.items, '9 plays from June to August')).toBeDefined()
        expect(texted(layout.items, 'HOW YOU LISTEN')).toBeDefined()
        expect(texted(layout.items, 'The album listener')).toBeDefined()
        expect(texted(layout.items, '62% of your plays')).toBeDefined()
        expect(texted(layout.items, 'AivinNet')).toBeDefined()
    })

    it('uses the app font in every text font string', () => {
        for (const t of texts(layout.items)) {
            expect(t.font).toMatch(/px Figtree, sans-serif$/)
        }
    })

    it('keeps every text inside the card and every block in its width', () => {
        for (const t of texts(layout.items)) {
            expect(t.x, t.text).toBeGreaterThanOrEqual(0)
            expect(t.x + fixed(t.text, t.font), t.text).toBeLessThanOrEqual(STORY_WIDTH)
            expect(t.y, t.text).toBeLessThanOrEqual(STORY_HEIGHT)
        }
    })

    it('stacks the sections top to bottom, without overlapping the footer', () => {
        const body = texts(layout.items).filter(t => t.y > 660 && t.y < STORY_HEIGHT - 128)
        const ys = body.map(t => t.y)
        expect(ys).toEqual([...ys].sort((a, b) => a - b))
        expect(Math.max(...ys)).toBeLessThan(STORY_HEIGHT - 128)
    })

    it('leaves the cover slot for the artist only when the cover loaded', () => {
        const withCover = layout.items.filter(i => i.kind === 'cover')
        expect(withCover).toEqual([{ kind: 'cover', x: 96, y: 760, size: 260 }])

        const without = layoutStory({ ...facts, cover: false }, 'Figtree', fixed)
        expect(without.items.some(i => i.kind === 'cover')).toBe(false)
        // The name then starts at the margin, not beside an empty square.
        expect(texted(without.items, 'Red Hot Chili Peppers')?.x).toBe(96)
        expect(texted(layout.items, 'Red Hot Chili Peppers')?.x).toBe(96 + 260 + 48)
    })

    it('fits a long artist name beside the cover with an ellipsis', () => {
        const long = 'A'.repeat(80)
        const out = layoutStory({ ...facts, topArtist: { name: long, time: '1 h' } }, 'Figtree', fixed)
        const name = texts(out.items).find(t => t.y === 800 && t.x === 96 + 260 + 48)
        expect(name).toBeDefined()
        expect(name!.text.endsWith('…')).toBe(true)
        expect(name!.x + fixed(name!.text, name!.font)).toBeLessThanOrEqual(STORY_WIDTH - 96)
    })

    it('leaves out a section with no content and moves the ones below it up', () => {
        const full = texts(layout.items)
        const noTrack = texts(layoutStory({ ...facts, topTrack: null }, 'Figtree', fixed).items)
        expect(noTrack.find(t => t.text === 'YOUR TOP TRACK')).toBeUndefined()
        const summerFull = full.find(t => t.text === 'SONG OF YOUR SUMMER')!
        const summerNoTrack = noTrack.find(t => t.text === 'SONG OF YOUR SUMMER')!
        expect(summerNoTrack.y).toBeLessThan(summerFull.y)
    })

    it('omits the whole card body for a year with no artist, track or summer song', () => {
        const bare = layoutStory(
            { year: 2026, minutes: '0', topArtist: null, cover: false, topTrack: null, summer: null, listener: null },
            'Figtree',
            fixed
        )
        expect(texts(bare.items).map(t => t.text)).toEqual(['AIVINNET · REWIND', '2026', '0', 'minutes of music', 'AivinNet'])
    })

    it('keeps the layout independent of the measure for the positions of blocks', () => {
        // Only the truncated strings depend on widths; the cover and the bands do not.
        const narrow = layoutStory(facts, 'Figtree', () => 1)
        expect(narrow.items.filter(i => i.kind === 'cover')).toEqual(layout.items.filter(i => i.kind === 'cover'))
        expect(narrow.items.filter(i => i.kind === 'band')).toEqual(layout.items.filter(i => i.kind === 'band'))
    })
})

describe('storyFacts', () => {
    // As GET /logger/rewind sends it (#527), the fields the card reads.
    const payload = {
        year: 2026,
        years: [2026],
        plays: 4567,
        seconds: 740_700,
        days: 241,
        top_artists: [{ name: 'Red Hot Chili Peppers', artisthash: 'ar1', image: 'ar1.webp', seconds: 38 * 3600 }],
        top_albums: [],
        top_tracks: [
            {
                title: 'Blue',
                trackhash: 't1',
                artists: [{ name: 'The Artist', artisthash: 'ar3' }],
                seconds: 3 * 3600 + 300,
                plays: 12,
            },
        ],
        summer_track: { track: { title: 'Summer', trackhash: 't2', artists: [{ name: 'Primus', artisthash: 'ar2' }] }, plays: 9 },
        first_track: null,
        busiest_day: null,
        new_artists: 0,
        new_artists_top: [],
        listener: { kind: 'album', share: 0.62 },
        time_of_day: null,
    } as unknown as RewindPayload

    it('formats the payload into the card words', () => {
        expect(storyFacts(payload, true)).toEqual({
            year: 2026,
            minutes: '12,345',
            topArtist: { name: 'Red Hot Chili Peppers', time: '38 h' },
            cover: true,
            topTrack: 'Blue — The Artist',
            summer: { track: 'Summer — Primus', plays: '9 plays' },
            listener: { title: 'The album listener', share: '62%' },
        })
    })

    it('leaves out what the year does not have', () => {
        const bare = { ...payload, top_artists: [], top_tracks: [], summer_track: null, listener: null } as RewindPayload
        expect(storyFacts(bare, false)).toMatchObject({ topArtist: null, topTrack: null, summer: null, listener: null, cover: false })
    })

    it('says nothing for a listener kind it does not know', () => {
        const odd = { ...payload, listener: { kind: 'constructor', share: 1 } } as unknown as RewindPayload
        expect(storyFacts(odd, false).listener).toBeNull()
    })
})
