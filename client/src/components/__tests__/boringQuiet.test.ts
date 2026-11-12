import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// BORING IS SOBER: NO PALETTE FILLS ON HOME'S CONTINUE CARD OR ON STATS.
//
// Memphis tells its cards apart by accent (a lavender album, a yellow tile, a
// coral label). Boring set none of the tokens those fills could have read, so
// they stood on its near-black ground at full light-mode strength (user,
// 2026-11-12: "not so loud here"). Every accent fill there now reads a
// `--look-*` token with the Memphis colour as fallback, and Boring sets them.
//
// The census below keeps the next accent on Stats from slipping past the look:
// any fill that names a palette accent must go through a look token.
//
// Read from disk: a raw glob returns `.scss` as an EMPTY string under Vitest.
// ---------------------------------------------------------------------------

const read = (path: string) => readFileSync(path, 'utf8')
const STREAM = read('src/assets/scss/Global/_theme-stream.scss')
const STATS_DIR = 'src/components/Stats'

const ACCENT = /\$mem-(yellow|lavender|pink|coral|teal|blue|gold|sea|kraft|lime|blush)\b|var\(--(peak|record|skip|device)-accent\)/
const FILL = /^\s*(background-color|background|fill)\s*:|mem-sticker\(.*\$fill/

describe('Boring: the Continue card and Stats without palette fills', () => {
    it.each([
        '--look-continue-fill',
        '--look-continue-base',
        '--look-continue-tint',
        '--look-continue-muted',
        '--look-card-inlay-fill',
        '--look-card-inlay-text',
        '--look-tile-fill',
        '--look-tile-text',
        '--look-tile-muted',
        '--look-stat-label-fill',
        '--look-stat-label-text',
        '--look-stat-badge-fill',
        '--look-stat-badge-text',
        '--look-stat-bar',
        '--shape-tilt',
    ])('Boring sets %s', (token) => {
        expect(STREAM).toMatch(new RegExp(`^\\s*${token}:`, 'm'))
    })

    it('every accent fill on Stats goes through a look token', () => {
        const hits: string[] = []
        for (const name of readdirSync(STATS_DIR).filter((f) => f.endsWith('.vue'))) {
            read(join(STATS_DIR, name))
                .split('\n')
                .forEach((line, i) => {
                    if (FILL.test(line) && ACCENT.test(line) && !line.includes('var(--look-')) {
                        hits.push(`${name}:${i + 1}: ${line.trim()}`)
                    }
                })
        }
        expect(hits).toEqual([])
    })

    it('a stat tile takes the look fill over its accent mix', () => {
        // Inline style: the accent comes from script, so the token sits in the string.
        expect(read(`${STATS_DIR}/StatItem.vue`)).toMatch(/backgroundColor: `var\(--look-tile-fill, color-mix\(/)
    })

    it('the Continue card reads the look fill for every entity and tints from the frame edge', () => {
        const card = read('src/components/HomeView/ContinueCard.vue')
        // The card's own fills (the panel and each entity's pastel); the Up next
        // rows set theirs from `--card-inlay-fill`, which has a token of its own.
        const cardFills = (card.match(/--row-fill: [^;]+;/g) ?? []).filter((d) => !d.includes('--card-inlay-fill'))
        expect(cardFills).toHaveLength(2)
        for (const decl of cardFills) expect(decl).toContain('var(--look-continue-fill,')
        expect(card).toMatch(/--card-inlay-fill: var\(--look-card-inlay-fill,/)
        // From the padding box the tint repeated into the invisible right frame.
        expect(card).toMatch(/background-origin: border-box;/)
        // The tint comes from the same extraction the detail pages use.
        expect(card).toMatch(/setColorsToStore\(tint, url\)/)
    })
})
