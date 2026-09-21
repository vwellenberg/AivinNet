import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// THE MOTION SCALE IS USED, NOT JUST DEFINED (#173).
//
// `_motion.scss` named the app's durations months before this test existed, and
// the codebase kept writing the numbers by hand anyway — 66 declarations when
// the scale arrived, 72 when #173 was filed, because every new animation brought
// its own values instead of reaching for the names. "Make the app feel faster"
// was a search-and-replace through 44 files instead of an edit to five numbers.
//
// So two rules, both enforced here:
//
//   1. The scale's values never appear as literals in a transition or an
//      animation. `0.2s` next to `$motion-move` is the same number twice, and
//      the literal one does not move when the scale does.
//   2. Every other literal duration is an EXCEPTION WITH A REASON, listed
//      below. The loops and character pieces stay outside the scale on
//      purpose (`_motion.scss` says why); the handful of slower fades are
//      deliberate. A new literal fails until someone decides which it is.
//
// ⚠️ Read from disk, not through `import.meta.glob`: a raw glob returns `.scss`
// as an EMPTY string under Vitest (testing.md), and half the transitions live in
// `.scss`. The first test pins that both halves arrive with content.
// ---------------------------------------------------------------------------

function sources(dir: string): string[] {
    const out: string[] = []
    for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) {
            if (name !== '__tests__') out.push(...sources(path))
        } else if (/\.(vue|scss)$/.test(name)) out.push(path)
    }
    return out
}

const FILES = sources('src').map(file => ({
    file: file.split('\\').join('/'),
    source: readFileSync(file, 'utf-8'),
}))

/** The scale itself, and the reduced-motion policy that overrides everything. */
const OWNERS = ['src/assets/scss/_motion.scss', 'src/assets/scss/Global/motion-policy.scss']

/** The values `_motion.scss` names. As a literal, each is a token someone forgot. */
const SCALE = ['0.1s', '0.12s', '0.15s', '0.2s', '0.25s', '0.35s', '40ms', '45ms']

/** Literal durations that are deliberately NOT on the scale, per file. */
const EXCEPTIONS: Record<string, { values: string[]; why: string }> = {
    // Loops and character pieces — outside the scale on purpose (_motion.scss).
    'src/assets/scss/Global/lauflicht.scss': { values: ['5.5s', '7s', '9s', '12s', '14s'], why: 'ambient loops' },
    'src/assets/scss/Global/basic.scss': { values: ['0.45s'], why: 'spinner loop' },
    'src/assets/scss/Global/state.scss': { values: ['0.6s'], why: 'pulse loop' },
    'src/components/shared/Spinner.vue': { values: ['400ms'], why: 'spinner loop' },
    'src/views/PairView.vue': { values: ['0.8s'], why: 'pairing spinner loop' },
    'src/components/shared/CardContent.vue': { values: ['1.7s'], why: 'skeleton pulse loop' },
    'src/components/Logo.vue': { values: ['0.7s', '3s'], why: 'planet spin, orbit loop' },
    // The equaliser bars run at DIFFERENT speeds so they never fall into step.
    // Pulling them onto one scale value would kill the effect they exist for.
    'src/components/shared/PlayingMeter.vue': {
        values: ['0.54s', '0.62s', '0.78s', '0.9s'],
        why: 'deliberately out-of-step meter bars',
    },
    // Slower than the interaction range on purpose.
    'src/assets/scss/Global/index.scss': { values: ['300ms'], why: 'modal dimmer fade' },
    'src/components/RightSideBar/SearchInput.vue': { values: ['0.3s'], why: 'clear-button fade' },
    'src/components/modals/settings/custom/Accounts.vue': { values: ['0.5s'], why: 'account card entrance' },
    'src/components/FolderView/BreadCrumbNav.vue': { values: ['0.5s'], why: 'current crumb settle' },
    'src/components/SettingsView/Components/Switch.vue': { values: ['0.18s'], why: 'switch knob travel' },
    'src/components/shared/Input.vue': { values: ['1s'], why: 'show-password hint delay' },
    // `var(--btn-pop-delay, 0s)`: "no delay" as a fallback, not a duration.
    'src/assets/scss/Global/_buttons.scss': { values: ['0s'], why: 'zero-delay fallback' },
}

const DECL = /(?<![-\w])(transition|animation)(-duration|-delay)?\s*:[^;{}]*;/g
const DURATION = /(?<![\w$.-])(\d*\.?\d+)(ms|s)\b/g

function inComment(source: string, at: number): boolean {
    const lineStart = source.lastIndexOf('\n', at) + 1
    if (source.slice(lineStart, at).trimStart().startsWith('//')) return true
    const open = source.lastIndexOf('/*', at)
    return open !== -1 && source.indexOf('*/', open) > at
}

/** Every literal duration in a transition/animation declaration, per file. */
function literals(): Record<string, string[]> {
    const out: Record<string, string[]> = {}
    for (const { file, source } of FILES) {
        if (OWNERS.includes(file)) continue
        for (const m of source.matchAll(DECL)) {
            if (inComment(source, m.index ?? 0)) continue
            for (const d of m[0].matchAll(DURATION)) (out[file] ??= []).push(d[1] + d[2])
        }
    }
    return out
}

describe('the motion scale', () => {
    it('reads both halves of the source, with content', () => {
        const scss = FILES.filter(f => f.file.endsWith('.scss'))
        const vue = FILES.filter(f => f.file.endsWith('.vue'))
        expect(scss.length).toBeGreaterThan(10)
        expect(vue.length).toBeGreaterThan(100)
        expect(scss.every(f => f.source.length > 0)).toBe(true)
        // A file known to carry transitions, so a broken DECL cannot pass as "none found".
        expect(Object.keys(literals())).toContain('src/assets/scss/Global/lauflicht.scss')
    })

    it('never spells a scale value out', () => {
        const found: string[] = []
        for (const [file, values] of Object.entries(literals())) {
            for (const v of values) if (SCALE.includes(v)) found.push(`${file}: ${v}`)
        }
        expect(found).toEqual([])
    })

    it('treats every other literal as a named exception', () => {
        const unlisted: string[] = []
        for (const [file, values] of Object.entries(literals())) {
            for (const v of values) {
                if (SCALE.includes(v)) continue
                if (!EXCEPTIONS[file]?.values.includes(v)) unlisted.push(`${file}: ${v}`)
            }
        }
        expect(unlisted, 'a new literal duration — use the scale, or list it here with a reason').toEqual([])
    })

    it('keeps no exception that has gone stale', () => {
        const found = literals()
        const stale: string[] = []
        for (const [file, { values }] of Object.entries(EXCEPTIONS)) {
            for (const v of values) if (!found[file]?.includes(v)) stale.push(`${file}: ${v}`)
        }
        expect(stale).toEqual([])
    })
})
