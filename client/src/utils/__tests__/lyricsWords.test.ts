import { describe, expect, it } from 'vitest'

import { MS_PER_CHAR, currentWordIndex, lineWords, splitSpacing } from '@/utils/lyricsWords'

// Shaped like GET /lyrics: LRCLIB keeps the space after the stamp ("[00:12.34] Hello").
const PLAIN = { time: 75000, text: ' Light up the night' }

describe('lyrics words: the words of a synced line, each with its start', () => {
    it('takes the stamps of an enhanced LRC line as they are', () => {
        const words = [
            { time: 75000, text: 'Light ' },
            { time: 75420, text: 'up ' },
            { time: 75800, text: 'the ' },
            { time: 76310, text: 'night' },
        ]
        const result = lineWords({ time: 75000, text: 'Light up the night', words }, 78000)

        expect(result.estimated).toBe(false)
        expect(result.words).toBe(words)
    })

    it('spreads a plain line over its time by word length', () => {
        // 15 letters (5 + 2 + 3 + 5), 1.8 s to the next line: under the pace cap
        // (15 × 150 ms), so the whole gap is used.
        const { words, estimated } = lineWords(PLAIN, 76800)

        expect(estimated).toBe(true)
        expect(words.map((w) => w.time)).toEqual([75000, 75600, 75840, 76200])
    })

    it('keeps every character, the leading space included', () => {
        const { words } = lineWords(PLAIN, 77400)

        expect(words.map((w) => w.text).join('')).toBe(PLAIN.text)
        expect(words[0].text).toBe(' Light ')
    })

    it('does not crawl through a line that is followed by a long break', () => {
        // 15 letters, then 30 s of instrumental: the words are done at the pace cap.
        const { words } = lineWords(PLAIN, 105000)
        const last = words[words.length - 1].time

        expect(last - PLAIN.time).toBeLessThan(15 * MS_PER_CHAR)
    })

    it('still spreads the last line when the track length is not known yet', () => {
        const { words } = lineWords(PLAIN, 0)

        expect(words[1].time).toBe(75000 + 5 * MS_PER_CHAR)
    })

    it('has no words for an empty line', () => {
        expect(lineWords({ time: 1000, text: '' }, 2000).words).toEqual([])
        expect(lineWords({ time: 1000, text: '   ' }, 2000).words).toEqual([])
    })
})

describe('lyrics words: which word is being sung', () => {
    const words = [
        { time: 1000, text: 'a ' },
        { time: 1500, text: 'b ' },
        { time: 2000, text: 'c' },
    ]

    it('is -1 before the first word', () => {
        expect(currentWordIndex(words, 999)).toBe(-1)
    })

    it('switches exactly on a word', () => {
        expect(currentWordIndex(words, 1499)).toBe(0)
        expect(currentWordIndex(words, 1500)).toBe(1)
    })

    it('stays on the last word after it starts', () => {
        expect(currentWordIndex(words, 9000)).toBe(2)
    })
})

describe('lyrics words: the marker stops at the last letter', () => {
    it('splits the spacing off both ends', () => {
        expect(splitSpacing(' Light ')).toEqual({ lead: ' ', core: 'Light', trail: ' ' })
        expect(splitSpacing('night')).toEqual({ lead: '', core: 'night', trail: '' })
        expect(splitSpacing('two  ')).toEqual({ lead: '', core: 'two', trail: '  ' })
    })
})
