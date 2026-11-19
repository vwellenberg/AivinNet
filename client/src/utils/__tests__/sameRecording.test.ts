import { describe, expect, it } from 'vitest'

import { isSameRecording } from '@/utils/songItemMethods'

// Rows that share a trackhash: title + album + artists agree. Real case: a game
// soundtrack whose region themes are all titled "2" or "3" (same album, same
// artist), different songs at 2:38, 1:10, … and 0:28 / 0:26.
const file = (filepath: string) => ({ filepath })

describe('isSameRecording', () => {
    it('keeps the row of the playing file', () => {
        expect(isSameRecording(file('/m/2a.ogg'), file('/m/2a.ogg'))).toBe(true)
    })

    it('drops a different song that only shares the hash', () => {
        expect(isSameRecording(file('/m/2a.ogg'), file('/m/2b.ogg'))).toBe(false)
    })

    it('drops it even when both songs are nearly the same length', () => {
        // 0:28 and 0:26 — the duration tolerance of #858 kept both lit.
        const playing = { filepath: '/m/3a.ogg', duration: 28 }
        const other = { filepath: '/m/3b.ogg', duration: 26 }
        expect(isSameRecording(playing, other)).toBe(false)
    })

    it('falls back to the hash when a filepath is missing', () => {
        expect(isSameRecording(undefined, file('/m/a.ogg'))).toBe(true)
        expect(isSameRecording(file(''), file('/m/a.ogg'))).toBe(true)
        expect(isSameRecording(file('/m/a.ogg'), file(''))).toBe(true)
    })
})
