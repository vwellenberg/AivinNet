import { describe, expect, it } from 'vitest'

import { volumeLevel } from '@/utils/volumeLevel'

// #238: full volume showed the same one-arc glyph as 51%.
describe('volumeLevel', () => {
    it('shows two arcs at full volume', () => {
        expect(volumeLevel(1, false)).toBe('high')
    })

    it.each([
        [0.01, 'low'],
        [1 / 3, 'low'],
        [0.34, 'mid'],
        [0.51, 'mid'],
        [2 / 3, 'mid'],
        [0.67, 'high'],
    ])('%s -> %s', (volume, level) => {
        expect(volumeLevel(volume, false)).toBe(level)
    })

    it('crosses the speaker out when nothing is heard, whatever the slider says', () => {
        expect(volumeLevel(0, false)).toBe('mute')
        expect(volumeLevel(1, true)).toBe('mute')
    })
})
