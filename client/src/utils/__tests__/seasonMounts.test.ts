import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { tileEmojiWeightsFor } from '@/utils/seasonTileEmojis'
import { PEEK_SPECS } from '@/utils/vampirePeek'

// App.vue mounts the tile emoji and the peeking figure for whichever season is
// active. The App itself is too heavy to mount in a unit test, so this reads its
// template (the file the build sees, read off disk) and checks both mounts: each
// is present, and neither is guarded to Halloween any more.
// Each guard first checks its own input is not empty, so a moved file fails loudly.

const APP = 'src/App.vue'
const source = readFileSync(APP, 'utf8')
// Import lines first thrown away: only the template's own use of the names counts.
const template = source.slice(0, source.indexOf('<script'))

describe('App.vue mounts the season drivers for both seasons', () => {
    it('reads the App (parser guard)', () => {
        expect(template.length).toBeGreaterThan(200)
        expect(template).toContain('<SeasonParticles')
    })

    it('mounts the tile emoji for any active season, passing it through', () => {
        expect(template).toMatch(/<SeasonTileEmojis\s+v-if="season"\s+:season="season"\s*\/>/)
    })

    it('mounts the peeking figure for any active season, passing it through', () => {
        expect(template).toMatch(/<SeasonVampire\s+v-if="season"\s+:season="season"\s*\/>/)
    })

    it('no longer guards either mount to Halloween', () => {
        expect(template).not.toMatch(/SeasonTileEmojis[^>]*halloween/)
        expect(template).not.toMatch(/SeasonVampire[^>]*halloween/)
    })

    it('has a figure and tile set for each season it can mount for', () => {
        for (const season of ['halloween', 'christmas'] as const) {
            expect(PEEK_SPECS[season].figure.length).toBeGreaterThan(0)
            expect(tileEmojiWeightsFor(season).length).toBeGreaterThan(0)
        }
    })
})
