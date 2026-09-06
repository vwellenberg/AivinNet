import { describe, expect, it } from 'vitest'

import { Track } from '@/interfaces'
import { resolveMove } from '@/utils/playlistMove'

// Only trackhash matters here; the rest of Track is irrelevant to the move maths.
const list = (...hashes: string[]) => hashes.map(h => ({ trackhash: h }) as Track)

/** Mirror of the store's moveTrack action, so undo can be checked end to end. */
function applyMove<T>(items: T[], from: number, to: number): T[] {
    const result = items.slice()
    const [item] = result.splice(from, 1)
    result.splice(to > from ? to - 1 : to, 0, item)
    return result
}

describe('resolveMove', () => {
    it('moving down anchors on the track that ends up after it', () => {
        // SongItem emits to = target.index + 1 when dropped on a row's bottom half,
        // so dropping row "a" below "c" is from=0, to=3.
        const move = resolveMove(list('a', 'b', 'c', 'd'), 0, 3)
        expect(move).toEqual({
            finalIndex: 2,
            trackhash: 'a',
            beforeTrackhash: 'd',
            undo: { from: 2, to: 0 },
        })
    })

    it('moving up anchors on the track it is inserted in front of', () => {
        const move = resolveMove(list('a', 'b', 'c', 'd'), 3, 1)
        expect(move).toEqual({
            finalIndex: 1,
            trackhash: 'd',
            beforeTrackhash: 'b',
            undo: { from: 1, to: 4 },
        })
    })

    it('moving to the very top has the old first track as anchor', () => {
        const move = resolveMove(list('a', 'b', 'c'), 2, 0)
        expect(move?.finalIndex).toBe(0)
        expect(move?.trackhash).toBe('c')
        expect(move?.beforeTrackhash).toBe('a')
    })

    it('moving to the very end has a null anchor', () => {
        const move = resolveMove(list('a', 'b', 'c'), 0, 3)
        expect(move?.beforeTrackhash).toBeNull()
        expect(move?.finalIndex).toBe(2)
    })

    it('never anchors on the moved track itself', () => {
        for (let from = 0; from < 5; from++) {
            for (let to = 0; to <= 5; to++) {
                const move = resolveMove(list('a', 'b', 'c', 'd', 'e'), from, to)
                if (move) expect(move.beforeTrackhash).not.toBe(move.trackhash)
            }
        }
    })

    it('returns null for a no-op drop on the row itself', () => {
        expect(resolveMove(list('a', 'b', 'c'), 1, 1)).toBeNull()
    })

    it('returns null for a drop into the gap right below the dragged row', () => {
        // from=1, to=2 lands the track exactly where it already is.
        expect(resolveMove(list('a', 'b', 'c'), 1, 2)).toBeNull()
    })

    it('returns null for a single-element list', () => {
        expect(resolveMove(list('a'), 0, 1)).toBeNull()
    })

    it('returns null for out-of-range indices', () => {
        expect(resolveMove(list('a', 'b'), 5, 0)).toBeNull()
        expect(resolveMove(list('a', 'b'), -1, 0)).toBeNull()
        expect(resolveMove(list('a', 'b'), 0, 9)).toBeNull()
    })

    it('returns null when the dragged entry has no trackhash', () => {
        expect(resolveMove([{} as Track, { trackhash: 'b' } as Track], 0, 2)).toBeNull()
    })

    it('does not mutate the input list', () => {
        const tracks = list('a', 'b', 'c')
        resolveMove(tracks, 0, 3)
        expect(tracks.map(t => t.trackhash)).toEqual(['a', 'b', 'c'])
    })

    describe('anchor semantics match what the server does', () => {
        // The server removes the trackhash, then inserts it before the anchor
        // (or appends when the anchor is null).
        const serverMove = (hashes: string[], trackhash: string, before: string | null) => {
            const rest = hashes.filter(h => h !== trackhash)
            if (before === null) return [...rest, trackhash]
            const at = rest.indexOf(before)
            return [...rest.slice(0, at), trackhash, ...rest.slice(at)]
        }

        it('agrees with the local optimistic move for every from/to pair', () => {
            const hashes = ['a', 'b', 'c', 'd', 'e']
            for (let from = 0; from < hashes.length; from++) {
                for (let to = 0; to <= hashes.length; to++) {
                    const move = resolveMove(list(...hashes), from, to)
                    if (!move) continue

                    const local = applyMove(hashes, from, to)
                    const remote = serverMove(hashes, move.trackhash, move.beforeTrackhash)

                    expect(remote).toEqual(local)
                    expect(local[move.finalIndex]).toBe(move.trackhash)
                }
            }
        })
    })

    describe('undo restores the original order', () => {
        it('for every from/to pair', () => {
            const hashes = ['a', 'b', 'c', 'd', 'e']
            for (let from = 0; from < hashes.length; from++) {
                for (let to = 0; to <= hashes.length; to++) {
                    const move = resolveMove(list(...hashes), from, to)
                    if (!move) continue

                    const moved = applyMove(hashes, from, to)
                    expect(applyMove(moved, move.undo.from, move.undo.to)).toEqual(hashes)
                }
            }
        })
    })

    describe('paginated playlists (the data-loss regression)', () => {
        // The view only ever holds the tracks it has paginated in. A move must be
        // expressible from that window alone, and must never need the full list.
        const loaded = Array.from({ length: 38 }, (_, i) => `h${i}`)

        it('resolves from the loaded window only', () => {
            const move = resolveMove(list(...loaded), 0, 4)
            expect(move).not.toBeNull()
            expect(move?.trackhash).toBe('h0')
            expect(move?.beforeTrackhash).toBe('h4')
        })

        it('carries no list-shaped payload at all', () => {
            const move = resolveMove(list(...loaded), 0, 4)
            // Two hashes and two numbers — nothing that scales with the playlist.
            expect(Object.values(move!).filter(Array.isArray)).toHaveLength(0)
        })
    })
})
