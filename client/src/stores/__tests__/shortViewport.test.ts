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

const { isShort, isLargerMobile, isMobile } = await import('../content-width')

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
    const phoneBar = () => isMobile.value && (!isLargerMobile.value || isShort.value)

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
})
