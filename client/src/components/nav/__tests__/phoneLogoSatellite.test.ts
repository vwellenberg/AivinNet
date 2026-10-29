import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// The satellite easter egg (#544) has to be findable on a phone. The desktop
// logo (Logo.vue) is not rendered there, so the egg first lived only on a
// screen the phone never shows. The phone's own app icon on Home (NavBar.vue)
// counts the taps too and flies the same satellite.
//
// Source census, like homeTitleSearch.test.ts: mounting NavBar pulls in half the
// stores. The counting itself is tested through Logo (logoSatellite.test.ts),
// which uses the same composable.
// ---------------------------------------------------------------------------

const SOURCE = readFileSync('src/components/nav/NavBar.vue', 'utf8')

describe('NavBar: the phone icon flies the satellite', () => {
    it('finds the phone icon button (guard)', () => {
        expect(SOURCE.includes('class="mobile-nav-logo-btn"'), 'phone icon button missing').toBe(true)
    })

    it('the icon tap still spins the planet and counts the tap', () => {
        expect(SOURCE).toMatch(/class="mobile-nav-logo-btn"[\s\S]*?@click="onLogoTap"/)
        const fn = SOURCE.match(/function onLogoTap\(\) \{([\s\S]*?)\n\}/)
        expect(fn, 'onLogoTap missing').not.toBeNull()
        expect(fn![1]).toContain('logoSpinning.value = true')
        expect(fn![1]).toMatch(/registerClick\s*\(\)/)
    })

    it('uses the shared composable, not a copy of the counter', () => {
        expect(SOURCE).toMatch(/= useLogoSatellite\(\)/)
    })

    it('renders the satellite inside the icon button while it flies', () => {
        const button = SOURCE.match(/class="mobile-nav-logo-btn"[\s\S]*?<\/button>/)
        expect(button, 'button markup missing').not.toBeNull()
        expect(button![0]).toMatch(/<span v-if="satelliteFlying" class="logo-satellite"/)
    })
})
