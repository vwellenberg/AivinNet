import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// `useWindowSize` is read at module scope in content-width.ts, so the refs have
// to exist before the import. Both are mutated per case below and the computed
// re-evaluates — no module reset needed (which is unreliable here anyway, see
// .claude/rules/testing.md).
const width = ref(390)
const height = ref(844)

vi.mock('@vueuse/core', () => ({
    useWindowSize: () => ({ width, height }),
}))

const { isShort, isLargerMobile, isMobile, isPhoneBar, RICH_BAR_MIN_WIDTH } = await import('../content-width')

function viewport(w: number, h: number) {
    width.value = w
    height.value = h
}

beforeEach(() => viewport(390, 844))

// ---------------------------------------------------------------------------
// `isShort` is the first breakpoint in this app that looks at the HEIGHT. Every
// other one is a max-width, which is how a landscape phone came to be treated
// as a "large phone": wide enough for the richer bar, with nobody noticing that
// the fixed chrome then took 64% of the screen.
// ---------------------------------------------------------------------------
describe('isShort', () => {
    it('is true for a phone turned sideways', () => {
        viewport(844, 390)
        expect(isShort.value).toBe(true)

        viewport(740, 360)
        expect(isShort.value).toBe(true)
    })

    it('is false for the same phone upright', () => {
        viewport(390, 844)
        expect(isShort.value).toBe(false)
    })

    // The load-bearing half of the definition. A tablet held upright lands in
    // the same 660-900px width band as a landscape phone, and there is nothing
    // short about it — without the orientation half it would lose its bar too.
    it('is false for an upright tablet in the same width band', () => {
        viewport(834, 1112)
        expect(isShort.value).toBe(false)
        expect(isLargerMobile.value).toBe(true)
    })

    it('is false for a desktop window, however wide', () => {
        viewport(1920, 1080)
        expect(isShort.value).toBe(false)
    })

    // A short DESKTOP window (a low, wide browser window) is landscape and
    // under the height threshold, so it counts — that is deliberate: the
    // reason for the rule is the height, and the chrome is just as expensive
    // there. It only reaches the phone bar via `isMobile` anyway.
    it('does not reach the phone bar on a wide short window', () => {
        viewport(1600, 420)
        expect(isShort.value).toBe(true)
        expect(isMobile.value).toBe(false)
    })
})

// The bar's own rule, which is what the CSS and the template both key off:
// a short viewport is a PHONE bar, exactly like the upright phone.
describe('the phone bar condition', () => {
    // The real rule the template reads (BottomBar/Left.vue), not a copy of it:
    // this block used to restate the formula, so it stayed green while the
    // component's own condition drifted away from it.
    const phoneBar = () => isPhoneBar.value

    it('holds upright', () => {
        viewport(390, 844)
        expect(phoneBar()).toBe(true)
    })

    it('holds sideways — the same device, the same bar', () => {
        viewport(844, 390)
        expect(phoneBar()).toBe(true)
    })

    it('does not hold for an upright tablet, which keeps the richer group', () => {
        viewport(834, 1112)
        expect(phoneBar()).toBe(false)
    })

    // The rich group (nine controls) left the track title 20px at 660 wide and
    // 40px at 700 — one letter, "L", reported from a phone in portrait. It only
    // switches on where the title keeps a readable width.
    it('holds for an upright phone too narrow for the rich group', () => {
        viewport(660, 1200)
        expect(isLargerMobile.value).toBe(true)
        expect(phoneBar()).toBe(true)

        viewport(RICH_BAR_MIN_WIDTH - 1, 1300)
        expect(phoneBar()).toBe(true)
    })

    it('gives way to the rich group from RICH_BAR_MIN_WIDTH up', () => {
        viewport(RICH_BAR_MIN_WIDTH, 1300)
        expect(phoneBar()).toBe(false)
    })

    it('puts the threshold where the title has room', () => {
        // Cover 48 + nine 44px controls + their gaps leave the title ~72px only
        // past ~730px. Pinned so the number cannot slide back into the band
        // where the title was a single letter.
        expect(RICH_BAR_MIN_WIDTH).toBeGreaterThanOrEqual(740)
        expect(RICH_BAR_MIN_WIDTH).toBeLessThanOrEqual(900)
    })
})
