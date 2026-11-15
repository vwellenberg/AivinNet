import { describe, expect, it } from 'vitest'

import {
    airState,
    playsStation,
    bezelTick,
    buildStations,
    dialIsWorthShowing,
    FM_HIGH_MHZ,
    FM_LOW_MHZ,
    kindsOnDial,
    keyTarget,
    knobAngle,
    knobDragPosition,
    litBezelTick,
    neighbours,
    prefersReducedMotion,
    snapIndex,
    stationFraction,
    stationFrequency,
    stationReadout,
    stationsFromList,
    signalBars,
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

    it('comes with a seasonal station alone: at Christmas the dial is the Christmas station', () => {
        const christmas = { id: 'christmas', name: 'Christmas', kind: 'season' as const }

        expect(dialIsWorthShowing([christmas])).toBe(true)
        expect(dialIsWorthShowing([mix, christmas])).toBe(true)
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

    it('runs the season first, before the mixes', () => {
        const christmas = { id: 'christmas', name: 'Christmas', kind: 'season' as const }

        const stations = buildStations({ mixes: [mix], genres: [genre], seasons: [christmas] })

        expect(stations.map(s => s.id)).toEqual(['christmas', 'mix1', 'genre:rock'])
    })
})

describe('stationsFromList with a season', () => {
    it('puts the season station first, whatever order the server listed it in', () => {
        const stations = stationsFromList([
            { id: 'genre1', kind: 'genre', name: 'rock' },
            { id: 'mix1', kind: 'mix', name: 'Mix 1' },
            { id: 'countdown', kind: 'season', name: 'Countdown' },
        ])

        expect(stations.map(s => s.id)).toEqual(['countdown', 'mix1', 'genre1'])
        expect(stations[0]).toEqual({ id: 'countdown', name: 'Countdown', kind: 'season' })
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

describe('stationReadout of a season station', () => {
    it('names the station as it is called, and the kind line says SEASON', () => {
        const christmas = { id: 'christmas', name: 'Christmas', kind: 'season' as const }

        expect(stationReadout(christmas, 0, 2)).toEqual({
            name: 'Christmas',
            kind: 'SEASON · 87.5 FM',
            valueText: 'Christmas, 87.5 FM',
        })
    })
})

describe('kindsOnDial (the legend)', () => {
    it('lists only the kinds with a station, in the dial order', () => {
        expect(
            kindsOnDial([
                { id: 'decade1', kind: 'decade', name: '1990s' },
                { id: 'mix1', kind: 'mix', name: 'Mix 1' },
            ])
        ).toEqual(['mix', 'decade'])
    })
})

describe('signalBars (the signal on the display)', () => {
    it('shows all four bars on a station and none half way between two', () => {
        expect(signalBars(3)).toBe(4)
        expect(signalBars(2.5)).toBe(0)
        expect(signalBars(2.25)).toBe(2)
        expect(signalBars(2.75)).toBe(2)
    })
})

describe('airState (ON AIR, TUNING, STANDBY)', () => {
    it('is ON AIR only for a tuned station with music playing', () => {
        expect(airState({ tuned: true, playing: true, dragging: false })).toBe('on')
        expect(airState({ tuned: true, playing: false, dragging: false })).toBe('off')
        expect(airState({ tuned: false, playing: true, dragging: false })).toBe('off')
    })

    it('is TUNING while the dial is dragged, whatever plays', () => {
        expect(airState({ tuned: true, playing: true, dragging: true })).toBe('tuning')
        expect(airState({ tuned: false, playing: false, dragging: true })).toBe('tuning')
    })
})

describe('playsStation', () => {
    it('is the station only when the queue came from its generated playlist', () => {
        expect(playsStation({ type: 'playlist', id: 'genre2' }, 'genre2')).toBe(true)
        expect(playsStation({ type: 'playlist', id: 'genre1' }, 'genre2')).toBe(false)
        expect(playsStation({ type: 'album', id: 'genre2' }, 'genre2')).toBe(false)
        expect(playsStation({}, 'genre2')).toBe(false)
        expect(playsStation({ type: 'playlist', id: 'genre2' }, undefined)).toBe(false)
    })
})

describe('knobAngle and the knob drag', () => {
    it('sweeps from -135 degrees at the first station to +135 at the last', () => {
        expect(knobAngle(0, 5)).toBe(-135)
        expect(knobAngle(4, 5)).toBe(135)
        expect(knobAngle(2, 5)).toBe(0)
    })

    it('turns right or up to move on, and stops at both ends of the dial', () => {
        expect(knobDragPosition(1, 26, 0, 5, 26)).toBe(2)
        expect(knobDragPosition(1, 0, -52, 5, 26)).toBe(3)
        expect(knobDragPosition(1, 0, 500, 5, 26)).toBe(0)
        expect(knobDragPosition(3, 500, 0, 5, 26)).toBe(4)
    })

    it('is station 0 for a lone station or a knob with no travel', () => {
        expect(knobDragPosition(0, 100, 0, 1, 26)).toBe(0)
        expect(knobDragPosition(2, 100, 0, 5, 0)).toBe(0)
    })

    it('lights the bezel tick nearest the knob angle, and draws every other tick as a minor or major', () => {
        expect(litBezelTick(0, 5)).toBe(0)
        expect(litBezelTick(2, 5)).toBe(10)
        expect(litBezelTick(4, 5)).toBe(20)
        expect(bezelTick(0).major).toBe(true)
        expect(bezelTick(1).major).toBe(false)
    })
})

describe('neighbours (the stations either side)', () => {
    const stations = [
        { id: 'a', kind: 'mix' as const, name: 'A' },
        { id: 'b', kind: 'mix' as const, name: 'B' },
        { id: 'c', kind: 'mix' as const, name: 'C' },
    ]

    it('names the station before and after, and nothing past the ends', () => {
        expect(neighbours(stations, 1)).toEqual({ prev: stations[0], next: stations[2] })
        expect(neighbours(stations, 0)).toEqual({ prev: null, next: stations[1] })
        expect(neighbours(stations, 2)).toEqual({ prev: stations[1], next: null })
    })
})
