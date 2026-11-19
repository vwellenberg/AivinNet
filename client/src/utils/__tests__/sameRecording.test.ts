import { describe, expect, it } from 'vitest'

import { isSameRecording } from '@/utils/songItemMethods'

// Rows that share a trackhash: title + album + artists agree. Real case: a game
// soundtrack whose region themes are all titled "2" (same album, same artist),
// four different songs at 2:38, 1:10, 1:53 and 2:13.
const file = (filepath: string, duration: number) => ({ filepath, duration })

describe('isSameRecording', () => {
    it('keeps the row of the playing file', () => {
        expect(isSameRecording(file('/m/2a.ogg', 158), file('/m/2a.ogg', 158))).toBe(true)
    })

    it('drops a different song that only shares the hash', () => {
        const playing = file('/m/2a.ogg', 158)
        expect(isSameRecording(playing, file('/m/2b.ogg', 70))).toBe(false)
        expect(isSameRecording(playing, file('/m/2c.ogg', 113))).toBe(false)
        expect(isSameRecording(playing, file('/m/2d.ogg', 133))).toBe(false)
    })

    it('keeps a duplicate of the same song in another file (collapsed album view)', () => {
        expect(isSameRecording(file('/m/song.flac', 201), file('/m/song.mp3', 202))).toBe(true)
    })

    it('falls back to the hash when it cannot tell', () => {
        expect(isSameRecording(undefined, file('/m/a.ogg', 100))).toBe(true)
        expect(isSameRecording(file('', 100), file('/m/a.ogg', 50))).toBe(true)
        expect(isSameRecording(file('/m/a.ogg', 0), file('/m/b.ogg', 50))).toBe(true)
    })
})
