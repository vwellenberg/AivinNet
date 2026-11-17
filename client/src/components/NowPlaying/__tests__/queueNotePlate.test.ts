import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// The queue's end note ("Last track — the queue starts over after this one.")
// stood as bare text on the doodled page ground, with the grid lines, the big
// circle and the cover running under it. Text on that ground needs a plate
// (styling.md, `--mem-veil`), framed like the Stats empty-state notes.
// ---------------------------------------------------------------------------

const SOURCE = readFileSync('src/components/NowPlaying/QueueCaption.vue', 'utf8')

/** The declarations of the `.queue-note` rule, read from the style block. */
function queueNoteBody(): string {
    const style = SOURCE.slice(SOURCE.indexOf('<style'))
    const rule = style.match(/\.queue-note\s*\{([^{}]*)\}/)
    if (!rule) throw new Error('no .queue-note rule in QueueCaption.vue')
    return rule[1]
}

describe('QueueCaption: the end note sits on a plate', () => {
    const body = queueNoteBody()

    it('draws the veil as its background', () => {
        expect(body).toMatch(/background-color:\s*var\(--mem-veil\)/)
    })

    it('draws the candy frame', () => {
        expect(body).toMatch(/border:\s*\$candy-border\b/)
    })

    it('draws the candy shadow', () => {
        expect(body).toMatch(/@include\s+candy-shadow\s*;/)
    })
})
