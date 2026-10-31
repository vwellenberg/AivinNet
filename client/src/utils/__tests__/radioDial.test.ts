import { describe, expect, it } from 'vitest'

import {
    buildStations,
    dialIsWorthShowing,
    dragPosition,
    FM_HIGH_MHZ,
    FM_LOW_MHZ,
    frequencyLabelWidth,
    keyTarget,
    labelEvery,
    prefersReducedMotion,
    snapIndex,
    stationFraction,
    stationFrequency,
    stationReadout,
    stationsFromList,
    wheelSteps,
} from '@/utils/radioDial'
import type { Station } from '@/utils/radioDial'

describe('stationsFromList', () => {
    it('makes one station per listed entry, keeping the playlist id and the kind', () => {
        const stations = stationsFromList([
            { id: 'mix1', kind: 'mix', name: 'Mix 1' },
            { id: 'genre1', kind: 'genre', name: 'rock' },
            { id: 'decade1', kind: 'decade', name: '1990s' },
        ])

        expect(stations).toEqual([
            { id: 'mix1', name: 'Mix 1', kind: 'mix' },
            { id: 'genre1', name: 'rock', kind: 'genre' },
            { id: 'decade1', name: '1990s', kind: 'decade' },
        ])
    })

    it('runs mixes, then genres, then decades, whatever order the server listed them in', () => {
        const stations = stationsFromList([
            { id: 'decade2', kind: 'decade', name: '1980s' },
            { id: 'genre2', kind: 'genre', name: 'jazz' },
            { id: 'mix3', kind: 'mix', name: 'Mix 3' },
            { id: 'genre1', kind: 'genre', name: 'rock' },
            { id: 'mix1', kind: 'mix', name: 'Mix 1' },
        ])

        // Each kind keeps the order the server listed it in; the kinds run mixes, genres, decades.
        expect(stations.map(s => s.id)).toEqual(['mix3', 'mix1', 'genre2', 'genre1', 'decade2'])
    })

    it('falls back to the id when a name is missing, and reads an empty list as no stations', () => {
        expect(stationsFromList([{ id: 'genre3', kind: 'genre', name: '' }])).toEqual([
            { id: 'genre3', name: 'genre3', kind: 'genre' },
        ])
        expect(stationsFromList([])).toEqual([])
    })
})

describe('dialIsWorthShowing', () => {
    const mix = { id: 'mix1', name: 'Mix 1', kind: 'mix' as const }
    const genre = { id: 'genre1', name: 'Jazz', kind: 'genre' as const }
    const decade = { id: 'decade1', name: '1990s', kind: 'decade' as const }

    it('stays away with mixes alone: the "Your mixes" row already shows them', () => {
        expect(dialIsWorthShowing([])).toBe(false)
        expect(dialIsWorthShowing([mix, { ...mix, id: 'mix2', name: 'Mix 2' }])).toBe(false)
    })

    it('comes with a genre or a decade station', () => {
        expect(dialIsWorthShowing([mix, genre])).toBe(true)
        expect(dialIsWorthShowing([decade])).toBe(true)
    })
})

describe('buildStations', () => {
    const mix = { id: 'mix1', name: 'Mix 1', kind: 'mix' as const }
    const genre = { id: 'genre:rock', name: 'Rock', kind: 'genre' as const }
    const decade = { id: 'decade:1980', name: '80s', kind: 'decade' as const }

    it('runs mixes, then genres, then decades', () => {
        const stations = buildStations({ decades: [decade], mixes: [mix], genres: [genre] })

        expect(stations.map(s => s.kind)).toEqual(['mix', 'genre', 'decade'])
    })

    it('has no station twice, the first one wins', () => {
        const again = { ...mix, name: 'Mix one again' }

        expect(buildStations({ mixes: [mix, again] })).toEqual([mix])
    })

    it('is empty when no list has a station, and drops a station without an id', () => {
        expect(buildStations({})).toEqual([])
        expect(buildStations({ genres: [{ ...genre, id: '' }] })).toEqual([])
    })
})

describe('snapIndex (the snap to a station)', () => {
    it('rounds to the nearest station and clamps to the dial', () => {
        expect(snapIndex(1.4, 4)).toBe(1)
        expect(snapIndex(1.6, 4)).toBe(2)
        expect(snapIndex(-0.7, 4)).toBe(0)
        expect(snapIndex(9, 4)).toBe(3)
    })

    it('is station 0 on an empty dial and for a position that is not a number', () => {
        expect(snapIndex(2, 0)).toBe(0)
        expect(snapIndex(Number.NaN, 4)).toBe(0)
    })
})

describe('dragPosition', () => {
    it('moves across the whole dial from the first station to the last', () => {
        // 300 px wide, 4 stations: 100 px per station.
        expect(dragPosition(0, 100, 300, 4)).toBeCloseTo(1)
        expect(dragPosition(0, 300, 300, 4)).toBeCloseTo(3)
    })

    it('stops at both ends of the dial', () => {
        expect(dragPosition(1, -900, 300, 4)).toBe(0)
        expect(dragPosition(2, 900, 300, 4)).toBe(3)
    })

    it('is station 0 for a lone station or a dial with no width', () => {
        expect(dragPosition(0, 50, 300, 1)).toBe(0)
        expect(dragPosition(2, 50, 0, 4)).toBe(0)
    })
})

describe('wheelSteps', () => {
    it('counts a full notch as one station, forwards positive', () => {
        expect(wheelSteps(100, 0)).toEqual({ steps: 2, rest: 0 })
        expect(wheelSteps(-50, 0)).toEqual({ steps: -1, rest: 0 })
    })

    it('carries a small trackpad movement over to the next event', () => {
        const first = wheelSteps(30, 0)
        expect(first).toEqual({ steps: 0, rest: 30 })

        const second = wheelSteps(30, first.rest)
        expect(second).toEqual({ steps: 1, rest: 10 })
    })
})

describe('keyTarget', () => {
    it('steps one station with the arrows and the page keys', () => {
        expect(keyTarget('ArrowRight', 1, 4)).toBe(2)
        expect(keyTarget('ArrowUp', 1, 4)).toBe(2)
        expect(keyTarget('ArrowLeft', 1, 4)).toBe(0)
        expect(keyTarget('ArrowDown', 1, 4)).toBe(0)
        expect(keyTarget('PageUp', 0, 4)).toBe(1)
        expect(keyTarget('PageDown', 3, 4)).toBe(2)
    })

    it('does not run past either end', () => {
        expect(keyTarget('ArrowRight', 3, 4)).toBe(3)
        expect(keyTarget('ArrowLeft', 0, 4)).toBe(0)
    })

    it('jumps to the ends with Home and End', () => {
        expect(keyTarget('Home', 2, 4)).toBe(0)
        expect(keyTarget('End', 1, 4)).toBe(3)
        expect(keyTarget('Home', 0, 0)).toBeNull()
    })

    it('ignores every other key', () => {
        expect(keyTarget('a', 1, 4)).toBeNull()
        expect(keyTarget('Enter', 1, 4)).toBeNull()
    })
})

describe('stationFraction', () => {
    it('spreads the stations evenly from the left edge to the right', () => {
        expect([0, 1, 2, 3].map(i => stationFraction(i, 4))).toEqual([0, 1 / 3, 2 / 3, 1])
    })

    it('puts a lone station in the middle', () => {
        expect(stationFraction(0, 1)).toBe(0.5)
    })
})

describe('prefersReducedMotion', () => {
    const win = (matches: boolean) =>
        ({ matchMedia: (query: string) => ({ matches, media: query }) }) as unknown as Window

    it('reads the reduce query', () => {
        expect(prefersReducedMotion(win(true))).toBe(true)
        expect(prefersReducedMotion(win(false))).toBe(false)
    })

    it('counts a browser without matchMedia as "no preference"', () => {
        expect(prefersReducedMotion({} as Window)).toBe(false)
        expect(prefersReducedMotion(undefined)).toBe(false)
    })
})

describe('stationFrequency (the FM dial)', () => {
    it('puts the first station at 87.5 and the last at 108.0', () => {
        expect(stationFrequency(0, 4)).toBe('87.5')
        expect(stationFrequency(3, 4)).toBe('108.0')
        expect(FM_LOW_MHZ).toBe(87.5)
        expect(FM_HIGH_MHZ).toBe(108.0)
    })

    it('spreads the stations evenly between, to one decimal', () => {
        // 4 stations: 87.5, 94.33 …, 101.17 …, 108.0
        expect([0, 1, 2, 3].map(i => stationFrequency(i, 4))).toEqual(['87.5', '94.3', '101.2', '108.0'])
    })

    it('always prints one decimal, and the frequencies strictly rise', () => {
        for (const count of [2, 3, 5, 8, 12]) {
            const values = Array.from({ length: count }, (_, i) => stationFrequency(i, count))

            for (const value of values) expect(value).toMatch(/^\d{2,3}\.\d$/)
            const numbers = values.map(Number)
            expect(numbers[0]).toBeGreaterThanOrEqual(FM_LOW_MHZ)
            expect(numbers[count - 1]).toBeLessThanOrEqual(FM_HIGH_MHZ)
            for (let i = 1; i < count; i++) expect(numbers[i]).toBeGreaterThan(numbers[i - 1])
        }
    })

    it('puts a lone station in the middle of the band', () => {
        expect(stationFrequency(0, 1)).toBe('97.8')
    })
})

describe('stationReadout', () => {
    const jazz: Station = { id: 'genre1', name: 'Jazz', kind: 'genre' }

    it('names the station, its kind and its frequency', () => {
        expect(stationReadout(jazz, 0, 4)).toEqual({
            name: 'Jazz',
            kind: 'GENRE · 87.5 FM',
            valueText: 'Jazz, 87.5 FM',
        })
    })

    it('names the kind of a mix and of a decade', () => {
        expect(stationReadout({ id: 'mix1', name: 'Mix 1', kind: 'mix' }, 3, 4).kind).toBe('MIX · 108.0 FM')
        expect(stationReadout({ id: 'decade1', name: '1990s', kind: 'decade' }, 1, 4)).toEqual({
            name: '1990s',
            kind: 'DECADE · 94.3 FM',
            valueText: '1990s, 94.3 FM',
        })
    })
})

describe('frequencyLabelWidth', () => {
    it('estimates a label in em of its font, rounded up', () => {
        expect(frequencyLabelWidth(12)).toBe(36)
        expect(frequencyLabelWidth(13)).toBe(39)
    })
})

describe('labelEvery (which stations carry a frequency label)', () => {
    it('labels every station when the scale is wide enough', () => {
        expect(labelEvery(600, 4, 36)).toBe(1)
    })

    it('labels every k-th station when the scale is too narrow for all', () => {
        // 280 px for 12 stations: 25 px apart, a label needs 36 + 8 = 44 px: every second.
        expect(labelEvery(280, 12, 36)).toBe(2)
        // 120 px for 4 stations: 40 px apart, so every second.
        expect(labelEvery(120, 4, 36)).toBe(2)
    })

    it('never shows two labels that would overlap, at any width', () => {
        for (const count of [2, 4, 8, 12]) {
            for (let width = 40; width <= 900; width += 13) {
                const every = labelEvery(width, count, 36)
                // One label left (the first): nothing next to it to overlap.
                if (every >= count) continue
                const spacing = width / (count - 1)
                // Labels sit on every `every`-th station: their centres are `every` apart.
                expect(every * spacing).toBeGreaterThanOrEqual(36 + 8 - 1e-9)
            }
        }
    })

    it('shows only the first label while the width is not known', () => {
        expect(labelEvery(0, 4, 36)).toBe(4)
        expect(labelEvery(Number.NaN, 4, 36)).toBe(4)
    })

    it('labels a lone station, and never asks for more steps than there are stations', () => {
        expect(labelEvery(300, 1, 36)).toBe(1)
        expect(labelEvery(1, 3, 36)).toBe(3)
    })
})
