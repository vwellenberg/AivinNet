import { describe, expect, it } from 'vitest'

import { groundDrifts } from '@/utils/groundDrift'

// The ground drifts on a page change and holds still on a switch between
// entities of the same page (playlist to playlist), where the route name stays.

describe('groundDrifts', () => {
    it('drifts when the page changes', () => {
        expect(groundDrifts({ name: 'albums' }, { name: 'playlists' })).toBe(true)
    })

    it('holds still when only the entity changes on the same page', () => {
        expect(groundDrifts({ name: 'playlist' }, { name: 'playlist' })).toBe(false)
        expect(groundDrifts({ name: 'album' }, { name: 'album' })).toBe(false)
    })

    it('drifts on the first navigation, from the start location that has no name', () => {
        expect(groundDrifts({ name: 'home' }, {})).toBe(true)
    })
})
