import { describe, expect, it } from 'vitest'

// The ✕ on a Home card is a bare glyph at rest and a FRAMED plate under the
// pointer (user, 2026-11-26: "the box has no border on hover"). `btn-quiet`
// hovers with a fill and hatch but no frame; `btn-action($rest: bare)` brings
// the frame and the offset shadow with the plate.
const sources = import.meta.glob('/src/components/HomeView/*.vue', {
    query: '?raw',
    import: 'default',
    eager: true,
}) as Record<string, string>

const cards = [
    ['ContinueCard', 'continue-dismiss'],
    ['WeeklyRecap', 'recap-close'],
]

describe('the dismiss button of a Home card', () => {
    it.each(cards)('%s: grows a framed plate on hover, bare at rest', (file, name) => {
        const source = sources[`/src/components/HomeView/${file}.vue`]
        const style = source.slice(source.indexOf('<style')).replace(/\/\/[^\n]*/g, '')
        // The last rule of that name that opens a block with the role: the phone
        // strip restates the position only.
        const blocks = [...style.matchAll(new RegExp(`\\.${name} \\{([^}]*)\\}`, 'g'))].map(m => m[1])
        const block = blocks.find(b => b.includes('@include btn-action'))

        expect(block).toBeDefined()
        expect(block).toContain('$rest: bare')
        // Printed on the card: it arrives with it, no pop of its own.
        expect(block).toContain('animation: none')
    })

    it.each(cards)('%s: does not also wear the quiet role', (file, name) => {
        const source = sources[`/src/components/HomeView/${file}.vue`]
        const tag = source.match(new RegExp(`class="([^"]*\\b${name}\\b[^"]*)"`))

        expect(tag?.[1]).toBeDefined()
        expect(tag?.[1]).not.toContain('btn-quiet')
    })
})
