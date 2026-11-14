import type { LyricsLine, LyricsWord } from '@/interfaces'

/**
 * How long one character takes to sing when the file does not say.
 *
 * Only an upper bound on the estimate: a line is spread over the time until the
 * next line OR this pace, whichever is shorter. Without it, a line followed by a
 * long instrumental would crawl through its words for the whole break.
 */
export const MS_PER_CHAR = 150

export interface LineWords {
    words: LyricsWord[]
    /** True when the times are spread over the line, not read from the file. */
    estimated: boolean
}

/**
 * The words of a synced line, each with the time it starts.
 *
 * Enhanced LRC carries a stamp per word, and those are used as they are. Plain
 * LRC only stamps the line, so the line's time is shared out across its words
 * by length — a long word takes longer to sing than "a". The words always join
 * back to the line's text, spaces included, so the view can lay them out one
 * after another without changing what is shown.
 *
 * @param end When the line is over: the next line's time, or the track's end.
 */
export function lineWords(line: LyricsLine, end: number): LineWords {
    if (line.words && line.words.length) {
        return { words: line.words, estimated: false }
    }

    const tokens = line.text.match(/\S+\s*/g)
    if (!tokens) return { words: [], estimated: true }

    // Leading space (LRCLIB writes "[00:12.34] Hello") rides on the first word.
    const lead = line.text.slice(0, line.text.length - tokens.join('').length)
    tokens[0] = lead + tokens[0]

    const weights = tokens.map((token) => Math.max(token.trim().length, 1))
    const total = weights.reduce((sum, w) => sum + w, 0)

    const paced = total * MS_PER_CHAR
    const span = end > line.time ? Math.min(end - line.time, paced) : paced

    let before = 0
    const words = tokens.map((text, i) => {
        const word = { time: line.time + (span * before) / total, text }
        before += weights[i]
        return word
    })

    return { words, estimated: true }
}

/** The word being sung at `millis`: the last one that has started, -1 before the first. */
export function currentWordIndex(words: LyricsWord[], millis: number): number {
    let index = -1
    for (let i = 0; i < words.length; i++) {
        if (words[i].time > millis) break
        index = i
    }
    return index
}

/**
 * A word's spacing apart from the word itself, so a marker drawn on the word
 * stops at its last letter instead of running on over the space after it.
 */
export function splitSpacing(text: string): { lead: string; core: string; trail: string } {
    const lead = text.match(/^\s*/)?.[0] ?? ''
    const trail = text.slice(lead.length).match(/\s*$/)?.[0] ?? ''
    return { lead, core: text.slice(lead.length, text.length - trail.length), trail }
}
