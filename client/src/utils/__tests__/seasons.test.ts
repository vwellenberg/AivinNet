import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The settings store reads the requests, the router, the player and device
// sync. None of that matters for the season logic, so they are stubbed as in
// pageGradient.test.ts.
vi.mock('@/requests/plugins', () => ({ pluginSetActive: vi.fn(), updatePluginSettings: vi.fn() }))
vi.mock('@/requests/settings', () => ({ updateConfig: vi.fn() }))
vi.mock('@/requests/useAxios', () => ({ default: vi.fn() }))
vi.mock('@/stores/devicesync', () => ({ default: () => ({ joined: false, applying: false, intercept: vi.fn() }) }))
vi.mock('@/stores/player', () => ({ usePlayer: () => ({ setVolume: vi.fn(), setMute: vi.fn() }) }))
vi.mock('@/context_menus/hashing', () => ({ getLastFmApiSig: vi.fn() }))
vi.mock('@/router', () => ({ router: { currentRoute: { value: { name: 'other' } } }, Routes: {} }))

import useSettings from '@/stores/settings'
import appearance from '@/settings/general/theme'
import { PALETTES } from '@/utils/theme'
import { activeSeason, paintedPalette, seasonOn, seasonPreview, setSeasonPreview } from '@/utils/seasons'

// Local wall-clock dates. Month is 0-based in the Date constructor.
const at = (y: number, m: number, d: number, h = 12, min = 0, s = 0, ms = 0) => new Date(y, m, d, h, min, s, ms)
const OCT = 9
const NOV = 10
const DEC = 11

// The preview is module state: it must not leak from one case into the next.
afterEach(() => {
    setSeasonPreview(null)
})

describe('seasonOn: the calendar dates (local time)', () => {
    it('Oct 23 and Nov 1 are no season, Oct 24 to 31 are Halloween', () => {
        // 2027: Nov 1 is a Monday.
        expect(seasonOn(at(2027, OCT, 23, 23, 59, 59, 999))).toBeNull()
        expect(seasonOn(at(2027, OCT, 24, 0, 0, 0, 0))).toBe('halloween')
        expect(seasonOn(at(2027, OCT, 29))).toBe('halloween')
        expect(seasonOn(at(2027, OCT, 31))).toBe('halloween')
        expect(seasonOn(at(2027, NOV, 1, 0, 0, 0, 0))).toBeNull()
    })

    it('keeps the Sunday after a Saturday Halloween, and only that day', () => {
        // 2026: Halloween is a Saturday, Nov 1 a Sunday.
        expect(new Date(2026, OCT, 31).getDay()).toBe(6)
        expect(seasonOn(at(2026, NOV, 1, 0, 0, 0, 0))).toBe('halloween')
        expect(seasonOn(at(2026, NOV, 1, 23, 59, 59, 999))).toBe('halloween')
        expect(seasonOn(at(2026, NOV, 2, 0, 0, 0, 0))).toBeNull()
        // 2025: Nov 1 is a Saturday, so it is not added.
        expect(seasonOn(at(2025, NOV, 1))).toBeNull()
    })

    it('Halloween covers its last day, to the last millisecond', () => {
        expect(seasonOn(at(2026, OCT, 31, 0, 0, 0, 0))).toBe('halloween')
        expect(seasonOn(at(2026, OCT, 31, 23, 59, 59, 999))).toBe('halloween')
    })

    it('Dec 16 is no season, Dec 17 to 26 are Christmas, Dec 27 is no season', () => {
        expect(seasonOn(at(2026, DEC, 16, 23, 59, 59, 999))).toBeNull()
        expect(seasonOn(at(2026, DEC, 17, 0, 0, 0, 0))).toBe('christmas')
        expect(seasonOn(at(2026, DEC, 24))).toBe('christmas')
        expect(seasonOn(at(2026, DEC, 25))).toBe('christmas')
        expect(seasonOn(at(2026, DEC, 26, 23, 59, 59, 999))).toBe('christmas')
        expect(seasonOn(at(2026, DEC, 27, 0, 0, 0, 0))).toBeNull()
    })

    it('reads the local calendar day (00:30 on 24 Oct is Halloween)', () => {
        // The Date is built from local parts, so this holds in any zone the suite
        // runs in; the code must read getMonth()/getDate(), not the UTC ones.
        expect(seasonOn(at(2026, OCT, 24, 0, 30))).toBe('halloween')
    })

    it('ignores the year', () => {
        expect(seasonOn(at(2031, OCT, 31))).toBe('halloween')
        expect(seasonOn(at(2031, OCT, 23))).toBeNull()
    })
})

describe('activeSeason: only Memphis, only while the switch is on', () => {
    const HALLOWEEN = at(2026, OCT, 31)
    const CHRISTMAS = at(2026, DEC, 25)
    const PLAIN = at(2026, NOV, 2)

    it('paints the season under Memphis with the switch on', () => {
        expect(activeSeason(HALLOWEEN, 'memphis', true)).toBe('halloween')
        expect(activeSeason(CHRISTMAS, 'memphis', true)).toBe('christmas')
    })

    it('the switch off disables the overlay on its own days', () => {
        expect(activeSeason(HALLOWEEN, 'memphis', false)).toBeNull()
        expect(activeSeason(CHRISTMAS, 'memphis', false)).toBeNull()
    })

    it('Boring never wears a season, even with the switch on', () => {
        expect(activeSeason(HALLOWEEN, 'stream', true)).toBeNull()
        expect(activeSeason(CHRISTMAS, 'stream', true)).toBeNull()
    })

    it('no season on other days, whatever the switch says', () => {
        expect(activeSeason(PLAIN, 'memphis', true)).toBeNull()
    })
})

describe('paintedPalette: a temporary overlay, the stored scheme stays', () => {
    it('Halloween paints the Halloween palette over any stored scheme', () => {
        for (const stored of PALETTES) {
            expect(paintedPalette(stored, 'halloween')).toBe('halloween')
        }
    })

    it('Christmas keeps the stored scheme and only swaps the sprinkle', () => {
        for (const stored of PALETTES) {
            expect(paintedPalette(stored, 'christmas')).toBe(stored)
        }
    })

    it('no season paints the stored scheme', () => {
        for (const stored of PALETTES) {
            expect(paintedPalette(stored, null)).toBe(stored)
        }
    })

    it('the Halloween palette is a known scheme the Settings dropdown does not offer', () => {
        expect(PALETTES).toContain('halloween')
        const offered = (appearance.find((s) => s.title === 'Colour scheme')?.options ?? []).map((o) => o.value)
        expect(offered).not.toContain('halloween')
    })
})

describe('the store: the switch and the stored scheme', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
    })

    it('is on by default, and the toggle flips it', () => {
        const settings = useSettings()
        expect(settings.use_seasonal_schemes).toBe(true)
        settings.toggleSeasonalSchemes()
        expect(settings.use_seasonal_schemes).toBe(false)
        settings.toggleSeasonalSchemes()
        expect(settings.use_seasonal_schemes).toBe(true)
    })

    it('the toggle disables the overlay: no season is active once it is off', () => {
        const settings = useSettings()
        const halloween = at(2026, OCT, 31)
        expect(activeSeason(halloween, settings.look, settings.use_seasonal_schemes)).toBe('halloween')

        settings.toggleSeasonalSchemes()
        expect(activeSeason(halloween, settings.look, settings.use_seasonal_schemes)).toBeNull()
    })

    it('painting the overlay never writes the chosen scheme', () => {
        const settings = useSettings()
        settings.setPalette('lagune')

        // What App.vue does on Halloween: paint, but leave the store alone.
        const painted = paintedPalette(settings.palette, activeSeason(at(2026, OCT, 31), settings.look, true))
        expect(painted).toBe('halloween')
        expect(settings.palette).toBe('lagune')
    })

    it('the Settings row is a switch under Memphis and inactive under Boring', () => {
        const settings = useSettings()
        const row = appearance.find((s) => s.title === 'Seasonal colours')
        expect(row).toBeDefined()
        expect(row?.inactive?.()).toBe(false)

        settings.setLook('stream')
        expect(row?.inactive?.()).toBe(true)
    })
})

describe('the preview: a season forced for this tab, in place of the date', () => {
    const PLAIN = at(2026, NOV, 2)

    it('starts with no preview, so the date decides', () => {
        expect(seasonPreview.value).toBeNull()
        expect(activeSeason(PLAIN, 'memphis', true)).toBeNull()
    })

    it('beats the date, both ways: a season on a plain day, and the other season on its own day', () => {
        setSeasonPreview('christmas')
        expect(activeSeason(PLAIN, 'memphis', true)).toBe('christmas')
        expect(activeSeason(at(2026, OCT, 31), 'memphis', true)).toBe('christmas')
    })

    it('does not wait for the seasonal switch: the preview is the explicit request', () => {
        setSeasonPreview('halloween')
        expect(activeSeason(PLAIN, 'memphis', false)).toBe('halloween')
    })

    it('resets to null, and the date decides again', () => {
        setSeasonPreview('halloween')
        setSeasonPreview(null)
        expect(seasonPreview.value).toBeNull()
        expect(activeSeason(PLAIN, 'memphis', true)).toBeNull()
        expect(activeSeason(at(2026, DEC, 25), 'memphis', true)).toBe('christmas')
    })

    it('still requires the Memphis look', () => {
        setSeasonPreview('halloween')
        expect(activeSeason(PLAIN, 'stream', true)).toBeNull()
    })

    it('drives the palette, so a Halloween preview paints the Halloween scheme over the stored one', () => {
        setSeasonPreview('halloween')
        const painted = paintedPalette('lagune', activeSeason(PLAIN, 'memphis', true))
        expect(painted).toBe('halloween')
    })

    it('never touches the stored scheme', () => {
        const settings = useSettings()
        settings.setPalette('terrakotta')
        setSeasonPreview('halloween')
        expect(settings.palette).toBe('terrakotta')
    })

    it('the Settings row is a select that sets and clears the preview', () => {
        setActivePinia(createPinia())
        const settings = useSettings()
        const row = appearance.find((s) => s.title === 'Preview season')
        expect(row).toBeDefined()
        expect(row?.options?.map((o) => o.value)).toEqual(['off', 'halloween', 'christmas'])
        expect(row?.state?.()).toBe('off')

        row?.action('christmas')
        expect(seasonPreview.value).toBe('christmas')
        expect(row?.state?.()).toBe('christmas')
        expect(activeSeason(PLAIN, settings.look, settings.use_seasonal_schemes)).toBe('christmas')

        row?.action('off')
        expect(seasonPreview.value).toBeNull()
        expect(row?.state?.()).toBe('off')
    })

    it('the preview row is inactive under Boring, like its neighbours', () => {
        setActivePinia(createPinia())
        const settings = useSettings()
        const row = appearance.find((s) => s.title === 'Preview season')
        expect(row?.inactive?.()).toBe(false)
        settings.setLook('stream')
        expect(row?.inactive?.()).toBe(true)
    })
})
