import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The Now Playing rating sits in the track's plate (user, 2026-11-11): a star
// button beside the heart, not a free row of stars under the plate. Read from
// source, like the other layout censuses: mounting the card needs the whole
// player state, and what has to hold here is the structure.
// Paths from the client root, like the other source censuses (vitest runs there).
const read = (rel: string) => readFileSync(`src/components/${rel}`, 'utf-8')
const info = read('NowPlaying/NowPlayingInfo.vue')
const header = read('NowPlaying/Header.vue')

describe('Now Playing rating', () => {
    it('is a TrackRating inside the title plate, keyed by the playing track', () => {
        const actions = info.slice(info.indexOf('<div class="actions">'), info.indexOf('<HeartSvg'))
        expect(actions).toContain('<TrackRating')
        // Unkeyed, a picker left open into the next song rates that song.
        expect(actions).toContain(':key="queue.currenttrack.trackhash"')
    })

    it('no longer renders the loose row of stars under the plate', () => {
        expect(header).not.toContain('np-rating')
        expect(header).not.toContain('RatingStars')
    })

    it('hangs the picker off the plate, so it stays on a 390px screen', () => {
        // Anchored to the button the picker reached 27px past the left edge.
        expect(info).toMatch(/\.track-rating-anchor\s*\{\s*position:\s*static;/)
        expect(info).toMatch(/\.now-playing-info\s*\{[^}]*position:\s*relative;/)
    })
})
