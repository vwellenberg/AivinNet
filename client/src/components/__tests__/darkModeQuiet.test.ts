import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// THE DARK THEME IS DARK AND QUIET (user, 2026-10-17: "darker, the white away").
//
// On the near-black ground every bright thing shouts: paper frames and paper
// offset shadows under every plate, white Up next rows and a white progress
// track on the Continue card, a pastel strip as the seek bar. Each of them now
// steps back in Memphis dark, through tokens, so the light theme stays exactly
// what it was. The tint depth and the frame contrast are in
// paletteSchemes.test.ts; the dots are in halftoneEdges.test.ts.
//
// Read from disk: a raw glob returns `.scss` as an EMPTY string under Vitest.
// ---------------------------------------------------------------------------

const read = (path: string) => readFileSync(path, 'utf8')
const INDEX = read('src/assets/scss/Global/index.scss')

/** One top-level block of Global/index.scss, by its exact selector. */
function block(selector: string): string {
    const start = INDEX.indexOf(`\n${selector} {`)
    expect(start, selector).toBeGreaterThan(-1)
    return INDEX.slice(start, INDEX.indexOf('\n}', start))
}

describe('dark mode: darker and quieter', () => {
    it('the offset shadow is a faint edge, not a bright one', () => {
        const alpha = block('body.theme-dark').match(/--mem-shadow: rgba\(244, 242, 237, ([\d.]+)\);/)
        expect(alpha, 'the dark shadow').not.toBeNull()
        expect(parseFloat(alpha![1])).toBeLessThanOrEqual(0.2)
    })

    it('the doodle sits under a veil that covers most of it', () => {
        const veil = block('body.theme-dark:not(.theme-stream)').match(/--mem-doodle-veil: linear-gradient\(\s*#\{mem-alpha\(var\(--mem-ground\), ([\d.]+)\)\}/)
        expect(veil, 'the doodle veil').not.toBeNull()
        expect(parseFloat(veil![1])).toBeGreaterThanOrEqual(0.7)
    })

    it('the seek and volume bars read their ground from tokens: pastel in light, deep in Memphis dark', () => {
        const root = block(':root')
        expect(root).toMatch(/--mem-track: var\(--mem-blush-soft\);/)
        expect(root).toMatch(/--mem-track-strong: var\(--mem-blush\);/)
        const dark = block('body.theme-dark:not(.theme-stream)')
        expect(dark).toMatch(/--mem-track: #\{color-mix\(in srgb, var\(--mem-blush\) \d+%, var\(--mem-ground\)\)\};/)
        expect(dark).toMatch(/--mem-track-strong: #\{color-mix\(in srgb, var\(--mem-blush\) \d+%, var\(--mem-ground\)\)\};/)

        // A look still wins (--look-track*); Memphis reads the token behind it.
        const progress = read('src/components/LeftSidebar/NP/Progress.vue')
        expect(progress).toContain("const TRACK = 'var(--look-track, var(--mem-track))'")
        expect(progress).toContain("const BUFFERED = 'var(--look-track-buffered, var(--mem-track-strong))'")
        expect(read('src/components/BottomBar/Volume.vue')).toContain("const TRACK = 'var(--look-track, var(--mem-track-strong))'")
    })

    it('what sits on the Continue card reads the inlay tokens, ground and paper in Memphis dark', () => {
        const card = read('src/components/HomeView/ContinueCard.vue')
        expect(card).toMatch(/\.next-row \{\s*@include mem-row-plate\(\$hatch: true\);\s*--row-fill: var\(--card-inlay-fill, #\{\$mem-panel-static\}\);\s*color: var\(--card-inlay-text, #\{\$mem-ink\}\);/)
        expect(card).toMatch(/\.progress \{[^}]*background-color: var\(--card-inlay-fill, #\{\$mem-panel-static\}\);/)
        expect(card).toMatch(/span \{[^}]*background-color: var\(--card-inlay-text, #\{\$mem-ink\}\);/)
        expect(card).toMatch(/body\.theme-dark:not\(\.theme-stream\) & \{\s*--card-inlay-fill: #\{\$mem-ground\};\s*--card-inlay-text: #\{\$mem-text\};/)
        // Nothing on the card paints the static white directly any more.
        expect(card).not.toMatch(/(background-color|--row-fill): (#\{)?\$mem-panel-static\}?;/)
    })

    it('the theme toggle answers the pointer only where there is one', () => {
        // On touch `:hover` latches after the tap: the toggle just tapped stood
        // as a paper-white plate in the dark theme.
        const toggle = read('src/components/nav/ThemeToggle.vue')
        expect(toggle).toMatch(/@media \(hover: hover\) \{\s*&:hover \{\s*background-color: var\(--mem-hover\);/)
        expect(toggle).not.toMatch(/^ {4}&:hover/m)
    })

    it('the frames grey out, the keyboard focus ring does not', () => {
        expect(block('body.theme-dark')).toMatch(/--mem-focus: #\{\$mem-dark-line\};/)
        const files = ['src/assets/scss/Global/_buttons.scss', 'src/components/Contextmenu/ContextItem.vue', 'src/components/modals/settings/Profile.vue', 'src/components/shared/Input.vue']
        for (const f of files) {
            const src = read(f)
            expect(src, f).toMatch(/outline: (\$focus-ring-w solid|solid \$focus-ring-w) \$mem-focus;/)
            expect(src, f).not.toMatch(/outline: [^;]*\$focus-ring-w[^;]*\$mem-line;/)
        }
    })
})
