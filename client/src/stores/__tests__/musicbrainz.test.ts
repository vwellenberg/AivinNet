import { beforeEach, describe, expect, it } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import useMusicBrainzStore, {} from '../musicbrainz'

describe('useMusicBrainzStore getters', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
    })

    it('progressPct is 0 when no status', () => {
        const store = useMusicBrainzStore()
        expect(store.progressPct).toBe(0)
    })

    it('progressPct is 0 when total is 0', () => {
        const store = useMusicBrainzStore()
        store.status = {
            in_progress: false,
            total: 0,
            fetched: 0,
            failed: 0,
            started_at: null,
            finished_at: null,
        }
        expect(store.progressPct).toBe(0)
    })

    it('progressPct combines fetched + failed against total', () => {
        const store = useMusicBrainzStore()
        store.status = {
            in_progress: true,
            total: 10,
            fetched: 3,
            failed: 2,
            started_at: Date.now(),
            finished_at: null,
        }
        expect(store.progressPct).toBe(50)
    })

    it('progressPct caps at 100', () => {
        const store = useMusicBrainzStore()
        store.status = {
            in_progress: false,
            total: 10,
            fetched: 11,
            failed: 0,
            started_at: null,
            finished_at: null,
        }
        expect(store.progressPct).toBe(100)
    })

    it('isRunning mirrors in_progress', () => {
        const store = useMusicBrainzStore()
        expect(store.isRunning).toBe(false)
        store.status = {
            in_progress: true,
            total: 5,
            fetched: 0,
            failed: 0,
            started_at: Date.now(),
            finished_at: null,
        }
        expect(store.isRunning).toBe(true)
    })

    it('countLoaded starts false and counts start at 0', () => {
        const store = useMusicBrainzStore()
        expect(store.countLoaded).toBe(false)
        expect(store.missingCount).toBe(0)
        expect(store.totalAlbums).toBe(0)
    })

    it('progressText is empty when no status', () => {
        const store = useMusicBrainzStore()
        expect(store.progressText).toBe('')
    })

    it('progressText shows running counters', () => {
        const store = useMusicBrainzStore()
        store.status = {
            in_progress: true,
            total: 8,
            fetched: 3,
            failed: 1,
            started_at: Date.now(),
            finished_at: null,
        }
        expect(store.progressText).toContain('4/8')
        expect(store.progressText).toContain('3 ok')
        expect(store.progressText).toContain('1 fail')
    })

    it('progressText shows done state after finish', () => {
        const store = useMusicBrainzStore()
        store.status = {
            in_progress: false,
            total: 5,
            fetched: 4,
            failed: 1,
            started_at: 0,
            finished_at: 1,
        }
        expect(store.progressText).toContain('Fertig')
        expect(store.progressText).toContain('4/5')
    })
})
