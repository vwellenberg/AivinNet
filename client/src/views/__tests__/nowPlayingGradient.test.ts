import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// The detail pages (album, artist, playlist) tint their head with the cover's
// colour through ONE channel: the `--page-gradient` custom property, which the
// shared `.v-scroll-page` rule paints BEHIND the scroller (app-grid.scss).
//
// Now Playing still called `pageGradient()` with no colour and an inline
// `background-image` — which resolves to `none`, so the page had no veil at all
// while every sibling had one. Its colour was there all along: the colour store
// extracts the playing track's cover on every track change.
// ---------------------------------------------------------------------------

const VIEW = readFileSync('src/views/NowPlaying/main.vue', 'utf8')

describe('Now Playing page veil', () => {
    it('feeds the playing cover colour into the shared --page-gradient channel', () => {
        expect(VIEW).toMatch(/'--page-gradient':\s*pageGradient\(colors\.bg\)/)
    })

    it('does not bypass the shared rule with an inline background-image', () => {
        // An inline `background-image` beats the `.v-scroll-page` rule and skips
        // its scroll offset — the veil would sit still while the list scrolls.
        expect(VIEW).not.toMatch(/backgroundImage/)
    })

    it('reads the colour from the colour store the player fills', () => {
        expect(VIEW).toMatch(/import useColors from ["']@\/stores\/colors["']/)
    })
})
