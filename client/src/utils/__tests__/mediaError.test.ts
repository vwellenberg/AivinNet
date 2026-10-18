import { describe, expect, it } from 'vitest'

import { describeMediaError } from '@/utils/mediaError'

function errorEvent(code: number | null, extra: Record<string, unknown> = {}) {
    return {
        target: {
            error: code === null ? null : { code, message: 'boom' },
            currentSrc: 'http://x/file?filepath=a.mp3',
            src: '',
            readyState: 0,
            networkState: 3,
            ...extra,
        },
    } as unknown as Event
}

describe('describeMediaError', () => {
    it.each([
        [1, 'aborted'],
        [2, 'network error'],
        [3, 'decode error'],
        [4, 'file not found or unsupported'],
    ])('names MediaError code %i as "%s"', (code, reason) => {
        const info = describeMediaError(errorEvent(code))
        expect(info.code).toBe(code)
        expect(info.reason).toBe(reason)
    })

    it('carries source and element state for the console', () => {
        const { detail } = describeMediaError(errorEvent(2))
        expect(detail).toContain('src=http://x/file?filepath=a.mp3')
        expect(detail).toContain('readyState=0')
        expect(detail).toContain('networkState=3')
        expect(detail).toContain('message=boom')
    })

    it('does not throw when the element has no MediaError', () => {
        expect(describeMediaError(errorEvent(null))).toMatchObject({ code: null, reason: 'unknown error' })
    })

    it('does not throw when the event has no target', () => {
        expect(describeMediaError({ target: null } as unknown as Event).reason).toBe('unknown error')
    })

    it('passes a string error through', () => {
        expect(describeMediaError('nope')).toEqual({ code: null, reason: 'nope', detail: '' })
    })
})
