/**
 * The caption on the Now-Playing source plate.
 *
 * It used to be `tracklist.from.type` printed straight out of the enum, and the
 * plate's own `text-transform: uppercase` then made two of the eight sources
 * say the same thing twice — "SEARCH" over `Search for: "…"`, "FAVORITE" over
 * "Favorite tracks" — while `playlistFolder` came out as "PLAYLISTFOLDER".
 *
 * On the search source that cost more than a repeated word: a caption, a
 * `Search for:` phrase and the magnifier glyph are between them the anatomy of
 * the app's search FIELD, and on the phone this plate is the topmost element of
 * the Now-Playing screen with no top bar next to it to compare against. It was
 * reported as "why is there a search at the top of the song".
 *
 * These tests pin the two halves that carry that: every source names its kind,
 * and no source's caption is contained in its own name.
 */

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { FromOptions } from '@/enums'
import type { From } from '@/stores/queue/tracklist'
import playingFrom from '../playingFrom'

const sources: { label: string; from: From }[] = [
    { label: 'album', from: { type: FromOptions.album, name: 'By the Way', albumhash: 'abc' } as From },
    { label: 'artist', from: { type: FromOptions.artist, artistname: 'RHCP', artisthash: 'def' } as From },
    { label: 'folder', from: { type: FromOptions.folder, name: 'Rock', path: '/music/rock' } as From },
    { label: 'playlist', from: { type: FromOptions.playlist, name: 'Roadtrip', id: 7 } as From },
    { label: 'playlistFolder', from: { type: FromOptions.playlistFolder, name: 'Moods' } as From },
    { label: 'search', from: { type: FromOptions.search, query: 'by the way' } as From },
    { label: 'favorite', from: { type: FromOptions.favorite } as From },
]

describe('playingFrom', () => {
    beforeEach(() => {
        // The folder branch reads the queue store for the current track's path.
        setActivePinia(createPinia())
    })

    // `toBeTruthy`, not `not.toBe('')`: the latter also passes for `undefined`,
    // which is exactly the shape a source that forgot the field would have —
    // and `PlayingFrom.vue` would then drop that caption in silence.
    it.each(sources)('$label names its kind', ({ from }) => {
        expect(playingFrom(from).type).toBeTruthy()
    })

    // The caption exists to say something the name does not. Written as
    // containment rather than inequality: "SEARCH" inside `Search for: "…"` was
    // the actual defect, and a plain !== would have let it through.
    it.each(sources)('$label does not repeat its caption in its name', ({ from }) => {
        const { type, name } = playingFrom(from)
        expect(name.toLowerCase()).not.toContain(type.toLowerCase())
    })

    it('quotes the query and leaves the wording to the caption', () => {
        const { type, name } = playingFrom({ type: FromOptions.search, query: 'by the way' } as From)

        expect(type).toBe('Search results')
        expect(name).toBe('"by the way"')
        expect(name).not.toMatch(/search/i)
    })

    it('spaces the playlist folder caption', () => {
        expect(playingFrom({ type: FromOptions.playlistFolder, name: 'Moods' } as From).type).toBe('Playlist folder')
    })

    // An empty queue renders neither image nor glyph (icon: ''); the caption
    // row is guarded on the same emptiness in PlayingFrom.vue.
    it('has no caption when there is no source', () => {
        expect(playingFrom({ type: 'nothing' } as unknown as From).type).toBe('')
    })
})
