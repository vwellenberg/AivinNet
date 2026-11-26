import { flushPromises, mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/router', () => ({ Routes: { Rewind: 'RewindView' } }))
const { getRewind } = vi.hoisted(() => ({ getRewind: vi.fn() }))
vi.mock('@/requests/stats', () => ({ getRewind }))

import RewindLink from '@/components/Stats/RewindLink.vue'

// RouterLink as a plain anchor that shows where it goes.
const stubs = {
    RouterLink: { props: ['to'], template: '<a :data-to="JSON.stringify(to)"><slot /></a>' },
}

const link = async (year: number | null | undefined) => {
    const w = mount(RewindLink, { props: { year }, global: { stubs } })
    await flushPromises()
    return w
}

// As GET /logger/rewind sends it (#527): the fields the tape reads, in the
// shape the server gives them (every list present, empty or not).
const YEAR_2025 = {
    year: 2025,
    years: [2024, 2025],
    plays: 11_384,
    seconds: 48_210 * 60 + 20,
    days: 287,
    top_artists: [{ name: 'The Brothers Johnson', artisthash: 'ar1', image: 'ar1.webp', seconds: 3600 }],
    top_albums: [],
    top_tracks: [
        {
            title: 'Get The Funk Out Ma Face',
            trackhash: 't1',
            artists: [{ name: 'The Brothers Johnson', artisthash: 'ar1' }],
            seconds: 32_000,
            plays: 60,
        },
    ],
    summer_track: null,
    first_track: null,
    busiest_day: null,
    new_artists: 0,
    new_artists_top: [],
    listener: null,
    time_of_day: null,
}

const SOURCE = readFileSync('src/components/Stats/RewindLink.vue', 'utf8')
const STYLE = SOURCE.slice(SOURCE.indexOf('<style'))
// The declarations alone: the comments name what was taken out.
const RULES = STYLE.split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n')

beforeEach(() => {
    getRewind.mockReset().mockResolvedValue({ status: 200, data: YEAR_2025 })
})

// The stats page hands down the latest finished year: the way to Rewind stays
// at the foot of the page, seen or not (#572). The door is a cassette.
describe('RewindLink', () => {
    it('names the latest finished year and goes there', async () => {
        const a = (await link(2025)).find('a')

        expect(a.attributes('aria-label')).toBe('Your 2025 Rewind')
        expect(a.find('.tape-year').text()).toContain('2025')
        expect(JSON.parse(a.attributes('data-to')!)).toEqual({ name: 'RewindView', params: { year: 2025 } })
    })

    it('names the tape by its length in minutes, the way a C-90 is named', async () => {
        const w = await link(2025)

        expect(getRewind).toHaveBeenCalledWith(2025)
        // 48,210 minutes and 20 seconds round to 48210, without separators.
        expect(w.find('.tape-length').text()).toBe('C-48210 min')
    })

    it('writes the year on the label: plays and days, top artist, top track', async () => {
        const lines = (await link(2025)).findAll('.tape-line').map(line => line.text())

        expect(lines).toEqual([
            '11,384 plays on 287 days',
            'Top artist The Brothers Johnson',
            'Top track Get The Funk Out Ma Face — The Brothers Johnson',
        ])
    })

    it('leaves out a line it has nothing for', async () => {
        getRewind.mockResolvedValue({ status: 200, data: { ...YEAR_2025, top_tracks: [] } })

        const lines = (await link(2025)).findAll('.tape-line').map(line => line.text())

        expect(lines).toHaveLength(2)
        expect(lines.join(' ')).not.toContain('Top track')
    })

    it('stays plain: shell, label and window, no screws, no stickers, no bridge, one stripe', async () => {
        const a = (await link(2025)).find('a')

        // The bridge at the foot went too (user, 2026-11-26: "nicht dieses
        // Eckige", "unten das Gedöns kann raus").
        expect(a.findAll('.tape-screw')).toHaveLength(0)
        expect(a.findAll('.tape-bridge')).toHaveLength(0)
        expect(a.findAll('.tape-hole')).toHaveLength(0)
        expect(a.find('.tape-band').findAll('svg')).toHaveLength(0)
        expect(a.element.children).toHaveLength(1)
        expect(a.find('.tape-band').findAll('span').map(span => span.text())).toEqual(['Side A', 'C-48210 min'])
    })

    it('still opens without its notes when the year cannot be loaded', async () => {
        getRewind.mockResolvedValue({ status: 500, data: null })

        const a = (await link(2025)).find('a')

        expect(a.exists()).toBe(true)
        expect(a.find('.tape-length').exists()).toBe(false)
        expect(a.find('.tape-line').text()).toContain('Played back')
    })

    it('keeps the drawing away from screen readers: the link says what it opens', async () => {
        const a = (await link(2025)).find('a')

        for (const part of ['.tape-band', '.tape-window']) {
            expect(a.find(part).attributes('aria-hidden'), part).toBe('true')
        }
    })

    it('describes the link with the length and the notes, so a screen reader hears them', async () => {
        const a = (await link(2025)).find('a')

        const ids = a.attributes('aria-describedby')!.split(' ')
        expect(ids.map(id => a.find(`[id="${id}"]`).classes())).toEqual([
            expect.arrayContaining(['tape-length']),
            expect.arrayContaining(['tape-notes']),
        ])
    })

    it('describes it with the line of text alone when the year cannot be loaded', async () => {
        getRewind.mockResolvedValue({ status: 500, data: null })

        const a = (await link(2025)).find('a')

        const ids = a.attributes('aria-describedby')!.split(' ')
        expect(ids).toHaveLength(1)
        expect(a.find(`[id="${ids[0]}"]`).text()).toContain('Played back')
    })

    it('stands under a heading of its own, like the sections above it', async () => {
        expect((await link(2025)).find('.section-title').text()).toBe('Rewind')
    })

    it('is not there before a year with music has ended, or while the years are unknown', async () => {
        expect((await link(undefined)).find('a').exists()).toBe(false)
        expect((await link(null)).find('a').exists()).toBe(false)
        expect((await link(null)).find('.section-title').exists()).toBe(false)
        expect(getRewind).not.toHaveBeenCalled()
    })
})

// The rewind is motion, and motion has rules here (styling.md): the pointer's
// half is gated to devices that hover, the keyboard gets it on focus, and the
// reels' turn is no `spin` (the reduced-motion policy keeps those turning).
describe('RewindLink: the rewind', () => {
    it('rewinds under the pointer only on devices that hover, and on keyboard focus', () => {
        const hover = STYLE.indexOf('&:hover {')
        const gate = STYLE.lastIndexOf('@media (hover: hover)', hover)

        expect(hover).toBeGreaterThan(-1)
        expect(gate).toBeGreaterThan(-1)
        expect(STYLE.slice(gate, hover)).not.toContain('}')
        expect(STYLE.slice(hover, STYLE.indexOf('}', STYLE.indexOf('@include tape-rewinding', hover)))).toContain(
            '@include tape-rewinding'
        )
        expect(STYLE).toMatch(/&:focus-visible\s*\{\s*@include tape-rewinding;/)
    })

    it('turns the reels a counted number of times, under a name of their own', () => {
        expect(STYLE).toMatch(/animation: tape-rewind \$motion-spin linear 3;/)
        expect(STYLE).not.toMatch(/animation:\s*spin\b/)
        expect(STYLE).not.toMatch(/infinite/)
    })

    it('winds the tape over the same time the reels turn', () => {
        expect(STYLE).toMatch(/--pack-left calc\(#\{\$motion-spin\} \* 3\)/)
        expect(STYLE).toMatch(/--pack-right calc\(#\{\$motion-spin\} \* 3\)/)
    })
})

// The tape is drawn in the app's own weights (styling.md: 3 px plates, 2 px
// rings), and nothing finer: the first cassette carried winding rings, a scale,
// dashed rules and hairline edges, and read as fussy next to every other plate
// (user, 2026-11-26: "zu viele feine Linien").
describe('RewindLink: the strokes', () => {
    it('draws every edge in the plate weight or the ring weight', () => {
        const widths = [...RULES.matchAll(/^\s*border(?:-(?:top|right|bottom|left|block|inline))?:\s*([^;]+);/gm)].map(
            m => m[1]
        )

        expect(widths.length).toBeGreaterThan(5)
        for (const width of widths) {
            expect(width, width).toMatch(/^(\$candy-border|\$candy-border-w|\$mem-ring-w)\b|^none$/)
        }
    })

    it('draws its strokes (the reel teeth) at the plate weight, unscaled by their box', () => {
        const strokes = [...RULES.matchAll(/stroke-width:\s*([^;]+);/g)].map(m => m[1])

        expect(strokes).toEqual(['$candy-border-w'])
        expect([...RULES.matchAll(/vector-effect: non-scaling-stroke;/g)]).toHaveLength(1)
    })

    it('draws plate edges in the frame colour, ink only inside the dark window', () => {
        // Label, band and window take the frame colour like every plate, so
        // the dark mode does not mix grey frames with ink print. Ink as a
        // border colour stays only inside the dark window (the packs' and
        // reels' rings), where the frame grey would be the lighter line.
        const ink = [...RULES.matchAll(/^\s*border[a-z-]*:[^;]*\$mem-ink;/gm)]
        expect(ink).toHaveLength(2)
        expect(RULES).not.toMatch(/border[a-z-]*:[^;]*currentColor/)
        expect([...RULES.matchAll(/border[a-z-]*:[^;]*\$mem-frame;/g)]).toHaveLength(2)
    })

    it('reaches the Boring look through its tokens, not through the Memphis colours', () => {
        expect(RULES).toMatch(/background-color: var\(--look-card-inlay-fill, #\{\$mem-ink\}\);/)
        expect(RULES).toMatch(/background-color: var\(--look-stat-label-fill, #\{\$mem-teal\}\);/)
    })

    it('has no hairlines, no see-through lines and no repeated stripes', () => {
        expect(RULES).not.toMatch(/\$mem-hairline/)
        expect(RULES).not.toMatch(/mem-alpha\(/)
        expect(RULES).not.toMatch(/repeating-(linear|radial)-gradient/)
        expect(RULES).not.toMatch(/dashed|dotted/)
    })

    it('sizes the packs by their width, so their ring is not scaled thin', () => {
        expect(RULES).toMatch(/width: calc\(var\(--full\) \* var\(--pack-left\)\)/)
        expect(RULES).not.toMatch(/scale\(var\(--pack/)
    })
})
