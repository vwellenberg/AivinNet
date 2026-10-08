import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// PLACEHOLDER COVERS TAKE THEIR TILE FROM THE PAGE (#395).
//
// The server's placeholders are an ink glyph on a transparent tile; the tile
// colour is the `<img>`'s own background, painted by Global/cover-placeholders
// .scss from the entity tints — so it follows the colour scheme. Two ways to
// break that without any error:
//   · the rule goes missing or points at the wrong entity: the glyph sits on
//     whatever is behind it — on the dark panel, an ink glyph on near-black;
//   · a component gives its cover `<img>` a background of its own with a
//     higher specificity. The album head did exactly that (a letterbox for
//     wide scans) and showed the placeholder black-on-black in dark mode —
//     the census below found it.
// Read with readFileSync (testing.md: a raw glob of .scss comes back empty).
// ---------------------------------------------------------------------------

const RULES = readFileSync('src/assets/scss/Global/cover-placeholders.scss', 'utf-8')

function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path)
        return /\.(vue|scss)$/.test(name) ? [path] : []
    })
}

describe('placeholder covers follow the colour scheme', () => {
    it('is imported into the global stylesheet', () => {
        expect(readFileSync('src/assets/scss/Global/index.scss', 'utf-8')).toMatch(/"\.\/cover-placeholders\.scss"/)
    })

    it.each([
        ['album', /img\[src\*="\/img\/thumbnail\/"\] \{\s*background-color: mem-pastel\(map-get\(\$mem-entities, "album"\)\);/],
        ['track', /&\[src\*="fb=track"\] \{\s*background-color: mem-pastel\(map-get\(\$mem-entities, "track"\)\);/],
        ['artist', /img\[src\*="\/img\/artist\/"\] \{\s*background-color: mem-pastel\(map-get\(\$mem-entities, "artist"\)\);/],
    ])('paints the %s tile behind its placeholder', (_entity, rule) => {
        expect(RULES).toMatch(rule)
    })

    // Images that never come from a cover route, so the placeholder rule does
    // not reach them anyway. Each with its reason.
    const NOT_A_COVER: Record<string, string> = {
        'src/components/nav/AvatarWithDropdown.vue': 'the user avatar (/img/user/), its own fallback',
    }

    it('no component covers the tile with a background of its own, unless it tints the placeholder too', () => {
        // Any `img { … background … }` outside the rule file outranks the tile
        // for the placeholder as well. Allowed only where the same block also
        // gives `.is-placeholder` the entity tint back.
        const hits: string[] = []
        for (const path of sources('src')) {
            if (path.endsWith('cover-placeholders.scss') || path in NOT_A_COVER) continue
            const text = readFileSync(path, 'utf-8')
            for (const m of text.matchAll(/\bimg\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)) {
                const block = m[1]
                if (!/background(-color)?\s*:/.test(block.replace(/&\.is-placeholder\s*\{[^}]*\}/, ''))) continue
                if (/&\.is-placeholder\s*\{\s*background-color: mem-pastel\(map-get\(\$mem-entities, "album"\)\);/.test(block)) continue
                hits.push(path)
            }
        }
        expect(hits).toEqual([])
    })

    it('the census sees the album head (guard over its own parser)', () => {
        // The one known override; if the regex stopped matching it, the test
        // above would pass on an empty set.
        const album = readFileSync('src/components/AlbumView/main.vue', 'utf-8')
        expect([...album.matchAll(/\bimg\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)].length).toBeGreaterThan(0)
        expect(album).toMatch(/:class="\{ 'is-placeholder': store\.colors\.placeholder \}"/)
    })
})
