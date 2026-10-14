import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// pageGradient reads the settings store, which drags in requests, the router,
// the player and device sync. None of that matters for the gradient string.
vi.mock('@/requests/plugins', () => ({ pluginSetActive: vi.fn(), updatePluginSettings: vi.fn() }))
vi.mock('@/requests/settings', () => ({ updateConfig: vi.fn() }))
vi.mock('@/requests/useAxios', () => ({ default: vi.fn() }))
vi.mock('@/stores/devicesync', () => ({ default: () => ({ joined: false, applying: false, intercept: vi.fn() }) }))
vi.mock('@/stores/player', () => ({ usePlayer: () => ({ setVolume: vi.fn(), setMute: vi.fn() }) }))
vi.mock('@/context_menus/hashing', () => ({ getLastFmApiSig: vi.fn() }))
vi.mock('@/router', () => ({ router: { currentRoute: { value: { name: 'other' } } }, Routes: {} }))

import { readFileSync } from 'node:fs'

import useSettings from '@/stores/settings'
import { brandGradient, pageTint } from '@/utils/colortools/pageGradient'

// A dominant cover colour as setColorsToStore stores it (hex, already darkened).
const COVER_BG = '#3a5f8a'

describe('pageTint', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
    })

    it('is the extracted cover colour, not a hardcoded one', () => {
        expect(pageTint(COVER_BG)).toBe('rgb(58, 95, 138)')
    })

    // `transparent`, the registered property's initial value: no veil fades
    // out like any other colour change, instead of jumping.
    it('is transparent without a cover colour', () => {
        expect(pageTint()).toBe('transparent')
        expect(pageTint('')).toBe('transparent')
    })

    it('is transparent for every detail page once the setting is off', () => {
        useSettings().togglePageGradient()

        expect(pageTint(COVER_BG)).toBe('transparent')
        // Different pages pass different cover colours; all of them go flat.
        expect(pageTint('#a13b2f')).toBe('transparent')
    })

    it('comes back when the setting is switched on again', () => {
        const settings = useSettings()
        settings.togglePageGradient()
        settings.togglePageGradient()

        expect(pageTint(COVER_BG)).toBe('rgb(58, 95, 138)')
    })
})

// ---------------------------------------------------------------------------
// The switch from one playlist (or album) to the next FADES the tint.
//
// The veil used to be a gradient string on `--page-gradient`. A gradient cannot
// be transitioned, and the store resets its colour while the next cover is
// read, so a switch went colour → nothing → colour in single frames: a flicker.
// The colour now travels alone, on a REGISTERED <color> property, and the
// gradient is drawn from it in the stylesheet — so the browser interpolates.
// ---------------------------------------------------------------------------

describe('the cover veil fades between two pages', () => {
    const GRID = readFileSync('src/assets/scss/Global/app-grid.scss', 'utf-8')
    const rule = GRID.slice(GRID.indexOf('.v-scroll-page {'), GRID.indexOf('.scroller {', GRID.indexOf('.v-scroll-page {')))

    it('registers --page-tint as a colour, so it can transition', () => {
        expect(GRID).toMatch(/@property --page-tint \{\s*syntax: "<color>";\s*inherits: false;\s*initial-value: transparent;\s*\}/)
    })

    it('draws the fade from the colour, with the look tokens as strength', () => {
        expect(rule).toContain('var(--page-tint) calc(var(--look-veil-top, 0.72) * 100%)')
        expect(rule).toContain('var(--page-tint) calc(var(--look-veil-mid, 0.42) * 100%)')
        expect(rule).toContain('var(--page-tint) calc(var(--look-veil-end, 0) * 100%)')
        expect(rule).not.toContain('--page-gradient')
    })

    it('transitions the colour on the motion scale', () => {
        expect(rule).toMatch(/transition: --page-tint \$motion-veil \$motion-curve;/)
        expect(readFileSync('src/assets/scss/_motion.scss', 'utf-8')).toMatch(/\$motion-veil: 0\.4s;/)
    })

    it.each([
        ['src/views/AlbumView/index.vue', 'album.colors.bg'],
        ['src/views/ArtistView/Main.vue', 'store.colors.bg'],
        ['src/views/PlaylistView/index.vue', 'playlist.colors.bg'],
        ['src/views/NowPlaying/main.vue', 'colors.bg'],
    ])('%s puts the colour on --page-tint, not a gradient string', (file, colour) => {
        const view = readFileSync(file, 'utf-8')
        expect(view).toContain(`'--page-tint': pageTint(${colour})`)
        expect(view).not.toContain('--page-gradient')
    })
})

describe('brandGradient', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
    })

    it('stays transparent — the library pages show the bare grid ground', () => {
        expect(brandGradient()).toBe('transparent')
    })
})
