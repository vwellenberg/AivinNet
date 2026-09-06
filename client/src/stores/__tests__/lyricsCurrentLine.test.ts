import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The lyrics store reaches for the queue (playback clock), the plugin store,
// settings and the router. Only the clock matters for the maths below.
const { queueState } = vi.hoisted(() => ({
    queueState: { duration: { current: 0, full: 200 }, playing: true },
}))

vi.mock('@/stores/queue', () => ({ default: () => queueState }))
vi.mock('@/stores/plugins/lyrics', () => ({ default: () => ({ searchLyrics: vi.fn() }) }))
vi.mock('@/stores/settings', () => ({
    default: () => ({ lyrics_plugin_settings: { auto_download: false, overide_unsynced: false } }),
}))
vi.mock('@/requests/lyrics', () => ({ checkExists: vi.fn(), getLyrics: vi.fn() }))
vi.mock('@/router', () => ({
    router: { currentRoute: { value: { name: 'other' } } },
    Routes: { Lyrics: 'Lyrics' },
}))

import useLyrics from '@/stores/lyrics'

// Real timings from "Dead Inside Shuffle" — the track this was found on.
const LINES = [
    { time: 29053, text: "I'm whistling with this empty hole" },
    { time: 33016, text: "My reflection I don't know" },
    { time: 36075, text: 'This ceiling I’m seeing it a lot' },
    { time: 39085, text: 'Before I get the sleep that I bought' },
]

function at(seconds: number) {
    queueState.duration.current = seconds
    return useLyrics().calculateCurrentLine()
}

describe('lyrics: which line is being sung', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        const lyrics = useLyrics()
        lyrics.lyrics = LINES as any
        lyrics.synced = true
        queueState.duration.current = 0
    })

    it('is -1 before the first line', () => {
        expect(at(0)).toBe(-1)
        expect(at(29.052)).toBe(-1)
    })

    it('is the line that started last — not the nearest one', () => {
        // 34.0s sits between line 1 (33.0s) and line 2 (36.1s) and is NEARER to
        // line 1, which is exactly the case the old "closest minus one" got
        // wrong: it pointed at line 0 while line 1 was being sung.
        expect(at(34)).toBe(1)
        // Past the halfway point the old formula happened to agree — which is
        // why this only ever showed up as "the highlight lags sometimes".
        expect(at(35)).toBe(1)
    })

    it('switches exactly ON a line, never before it', () => {
        expect(at(33.015)).toBe(0)
        expect(at(33.016)).toBe(1)
    })

    it('holds the last line to the end of the track', () => {
        expect(at(39.085)).toBe(3)
        expect(at(199)).toBe(3)
    })

    // Clicking a lyric goes `queue.seek(line.time / 1000)`, and the trip back
    // through seconds lands just BELOW the integer for about 1 % of centisecond
    // stamps. Unrounded, those lines mark the line ABOVE them — and while paused
    // nothing ever corrects it.
    it('survives the seconds round-trip of a click', () => {
        const lyrics = useLyrics()
        lyrics.lyrics = [{ time: 2010 }, { time: 2030 }, { time: 4020 }] as any

        for (const [index, line] of lyrics.lyrics.entries()) {
            queueState.duration.current = line.time / 1000
            expect(lyrics.calculateCurrentLine()).toBe(index)
        }
    })

    it('can be asked about a clock other than the store’s', () => {
        // The player's timeupdate runs BEFORE the store's duration is refreshed,
        // so it passes its own reading rather than correcting to a stale one.
        queueState.duration.current = 33
        expect(useLyrics().calculateCurrentLine(36075)).toBe(2)
    })

    it('is -1 for unsynced lyrics and for no lyrics at all', () => {
        const lyrics = useLyrics()

        lyrics.synced = false
        expect(at(34)).toBe(-1)

        lyrics.synced = true
        lyrics.lyrics = []
        expect(at(34)).toBe(-1)
    })
})

// ---------------------------------------------------------------------------
// The advance timer fires AT the line boundary now (it used to fire 300ms
// early). `setTimeout` only promises "not earlier", so it can be the late one —
// and then something else has already moved the line. A stale timer adding a
// second advance puts the mark two lines out, where `nextLineTime` no longer
// triggers the player's correction: it stays ahead for two full lines.
// ---------------------------------------------------------------------------
describe('lyrics: a pending advance is cancelled by whoever sets the line', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        setActivePinia(createPinia())
        const lyrics = useLyrics()
        lyrics.lyrics = LINES as any
        lyrics.synced = true
        lyrics.currentLine = 0
        queueState.playing = true
    })

    it('does not advance twice when the player corrects first', () => {
        const lyrics = useLyrics()

        lyrics.setNextLineTimer(800)
        // The player's `diff < 0` branch lands while the timer is still pending.
        lyrics.setCurrentLine(1, false)
        vi.advanceTimersByTime(2000)

        expect(lyrics.currentLine).toBe(1)
    })

    it('does not step past a seek made while a timer was pending', () => {
        const lyrics = useLyrics()

        lyrics.setNextLineTimer(800)
        lyrics.setCurrentLine(3, false) // clicking a later lyric line
        vi.advanceTimersByTime(2000)

        expect(lyrics.currentLine).toBe(3)
    })

    // The one that actually bit: `ticking` is cleared in more places than the
    // timer is, so a second timer can be armed while the first is in flight.
    // The orphan advances BLIND — one extra `++` and the mark is a whole line
    // ahead of the music from then on.
    it('does not leave an orphan behind when a second timer is armed', () => {
        const lyrics = useLyrics()

        lyrics.setNextLineTimer(800)
        lyrics.ticking = false // whatever cleared it: a correction, a seek, a track change
        lyrics.setNextLineTimer(1500)
        vi.advanceTimersByTime(3000)

        expect(lyrics.currentLine).toBe(1)
    })

    it('still advances on its own when nothing intervenes', () => {
        const lyrics = useLyrics()

        lyrics.setNextLineTimer(800)
        vi.advanceTimersByTime(800)

        expect(lyrics.currentLine).toBe(1)
    })

    // The timer counts wall-clock time; the boundary lives on the media clock.
    // Pausing stops one and not the other, so a pending advance is void.
    it('drops a pending advance when playback is paused', () => {
        const lyrics = useLyrics()

        lyrics.setNextLineTimer(800)
        lyrics.clearNextLineTimer()
        vi.advanceTimersByTime(2000)

        expect(lyrics.currentLine).toBe(0)
        // …and leaves the door open for the next one: `ticking` is what stops
        // updateLyricsPosition from arming another, and it used to stay stuck.
        expect(lyrics.ticking).toBe(false)
    })
})
