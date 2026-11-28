import { readdirSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// Every meter on Stats wears the same ink ring. The skip rankings drew their
// share bars as a bare 0.3rem track, right above the framed ones of "Listening
// per device" (reported 2026-11-28). The ring carries the contrast, the fill
// the identity.
//
// A meter is found by what it does, not by its name: a box whose child gets its
// width from the data.
// ---------------------------------------------------------------------------

const DIR = 'src/components/Stats'
const FILES = readdirSync(DIR)
    .filter(name => name.endsWith('.vue'))
    .map(name => ({ name, source: readFileSync(`${DIR}/${name}`, 'utf8') }))

const TRACK = /<div class="([\w-]+)"[^>]*>\s*<(?:i|span) :style="\{ width:/g

/** The declarations of every style rule whose selector ends in `.cls`. */
function declarations(source: string, cls: string) {
    const style = source
        .slice(source.indexOf('>', source.indexOf('<style')) + 1, source.lastIndexOf('</style>'))
        .replace(/\/\/.*$/gm, '')
        .replace(/#\{([^{}]*)\}/g, '$1')

    const ends = new RegExp(`\\.${cls}$`)
    const open: { matches: boolean; own: string }[] = []
    let pending = ''
    let found = ''

    for (const char of style) {
        if (char === '{') {
            const matches = pending.split(',').some(s => ends.test(s.trim()))
            open.push({ matches, own: '' })
            pending = ''
        } else if (char === ';' || char === '}') {
            const rule = open[open.length - 1]
            if (rule) rule.own += `${pending.trim()};`
            pending = ''
            if (char === '}' && open.pop()?.matches) found += rule!.own
        } else {
            pending += char
        }
    }
    return found
}

const METERS = FILES.flatMap(({ name, source }) =>
    [...source.matchAll(TRACK)].map(m => ({ where: `${name} .${m[1]}`, body: declarations(source, m[1]) })),
)

describe('Stats: every meter is framed', () => {
    it('finds the meters (guard over the parser)', () => {
        expect(METERS.map(m => m.where).sort()).toEqual([
            'ChartItem.vue .meter',
            'ListeningDevices.vue .devices-bar',
            'SkipRate.vue .skip-bar',
            'SkipRate.vue .skip-meter',
        ])
    })

    it.each(METERS)('$where draws the ink ring', ({ body }) => {
        expect(body).toMatch(/(^|;)border: \$mem-ring-w solid \$mem-line;/)
    })
})
