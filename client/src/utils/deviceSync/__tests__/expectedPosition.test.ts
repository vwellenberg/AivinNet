import { describe, expect, it } from 'vitest'
import { expectedPositionMs } from '../expectedPosition'
import type { SyncAnchor } from '../types'

describe('expectedPositionMs', () => {
    const anchor: SyncAnchor = { position_ms: 10000, at_server_ms: 5000 }

    it('advances with server time while playing', () => {
        // 10000 + (8000 - 5000) = 13000
        expect(expectedPositionMs(anchor, 8000, true)).toBe(13000)
    })

    it('is frozen at the anchor position while paused', () => {
        expect(expectedPositionMs(anchor, 8000, false)).toBe(10000)
        // Even far ahead in server time, a paused position does not move.
        expect(expectedPositionMs(anchor, 999999, false)).toBe(10000)
    })

    it('clamps a negative computed position to 0', () => {
        // 1000 + (5000 - 10000) = -4000 → clamped to 0
        const early: SyncAnchor = { position_ms: 1000, at_server_ms: 10000 }
        expect(expectedPositionMs(early, 5000, true)).toBe(0)
    })
})
