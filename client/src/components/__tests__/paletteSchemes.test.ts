import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

import brandColors from '@/brand-colors.json'
import { kebab, sassPalettes } from '@/utils/colortools/sassPalettes'
import { PALETTES } from '@/utils/theme'
// @ts-expect-error — a plain node script, no type declarations
import { recolorDoodle } from '../../../scripts/palette-doodles.mjs'

// ---------------------------------------------------------------------------
// THE COLOUR SCHEMES HOLD THE SAME RULES AS MEMPHIS (#395).
//
// A scheme is a set of values in `palettes` of brand-colors.json. Memphis
// earned its colours by measurement — neighbouring nav tints ΔE ≥ 20
// (navOrder.test.ts), entity tints ΔE ≥ 15 side by side (_candy.scss, ENTITY
// COLOURS), ink legible on the play and "on" fills. A scheme that draws its
// hues closer together (that is the point of Lagune and Terrakotta) or takes
// the saturation out (Eierschale) loses separation first, and nothing on the
// screen says so: two neighbours simply read as one colour. Every rule here
// runs for every scheme, Memphis included, so the numbers are compared on the
// same footing.
//
// ⚠️ `stores/search` is mocked for the same reason as in navOrder.test.ts:
// navitems.ts calls useSearch() and would pull in a Pinia instance.
// ---------------------------------------------------------------------------

vi.mock('@/stores/search', () => ({ default: () => ({ query: '' }) }))
const { menus } = await import('../LeftSidebar/navitems')

type Roles = Record<string, string>
const CANDY = readFileSync('src/assets/scss/_candy.scss', 'utf-8')

/** `$name: (` … `)` in _candy.scss as `key → $mem-<role>` pairs. */
function sassMap(name: string): [string, string][] {
    const start = CANDY.indexOf(`$${name}: (`)
    expect(start, `$${name} not found in _candy.scss`).toBeGreaterThan(-1)
    const body = CANDY.slice(start, CANDY.indexOf(');', start))
    return [...body.matchAll(/"([a-z-]+)":\s*\$mem-([a-z-]+)/g)].map((m) => [m[1], m[2]])
}

/**
 * The light roles of a scheme, keyed by their --mem-* names. Memphis reads its
 * own block; its Home tint IS the brand green. `muted` is the mode-independent
 * twin of the scheme's `textMuted` (Global/_palettes.scss sets both from it).
 */
function lightRoles(scheme: string): Roles {
    const src: Roles =
        scheme === 'memphis'
            ? { ...(brandColors.memphis as Roles), home: brandColors.green }
            : (brandColors.palettes as Record<string, { light: Roles }>)[scheme].light
    const roles: Roles = Object.fromEntries(Object.entries(src).map(([k, v]) => [kebab(k), v]))
    return { ...roles, muted: roles['text-muted'] }
}

// --- colour measurement (sRGB → CIELAB D65, CIE76; WCAG luminance) --------
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
const lin = (u: number) => (u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4)
/** mem-pastel: `color-mix(in srgb, colour 55%, paper)`. */
const pastel = (c: string, paper: string) => rgb(c).map((v, i) => v * 0.55 + rgb(paper)[i] * 0.45)
function lab(c: number[]) {
    const [r, g, b] = c.map(lin)
    const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
    const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
    return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))]
}
const deltaE = (a: number[], b: number[]) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]))
function contrast(a: string, b: string) {
    const L = (h: string) => {
        const [r, g, bb] = rgb(h).map(lin)
        return 0.2126 * r + 0.7152 * g + 0.0722 * bb
    }
    const [hi, lo] = [L(a), L(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
}

const SCHEMES = [...PALETTES]
const MAP_ROLES = sassMap('mem-palette-static').map(([role]) => role)
const NAV_TINTS = Object.fromEntries(sassMap('mem-nav-tints'))
const ENTITIES = sassMap('mem-entities')
const NAV = menus.filter((m) => !m.separator)

describe('colour schemes: the data (#395)', () => {
    it('knows the same schemes as the setting', () => {
        expect(['memphis', ...Object.keys(brandColors.palettes)]).toEqual(SCHEMES)
    })

    it('reads its own inputs (guard over the parsers)', () => {
        // A parser that silently matched nothing would leave every rule below green.
        expect(MAP_ROLES).toContain('teal')
        expect(MAP_ROLES).toContain('home')
        expect(NAV.length).toBe(8)
        expect(ENTITIES.length).toBe(6)
    })

    it.each(SCHEMES)('%s sets every palette role and its muted grey', (scheme) => {
        // A role a scheme leaves out stays Memphis under it — one teal tile in
        // a terracotta app, and no test would notice.
        const roles = lightRoles(scheme)
        for (const role of [...MAP_ROLES, 'text-muted']) {
            expect(roles[role], `${scheme} has no ${role}`).toMatch(/^#[0-9A-Fa-f]{6}$/)
        }
    })

    it.each(SCHEMES.filter((s) => s !== 'memphis'))('%s has a dark ground of its own', (scheme) => {
        const { dark } = (brandColors.palettes as Record<string, { dark: Roles }>)[scheme]
        expect(Object.keys(dark).sort()).toEqual(['contentMuted', 'ground', 'panel', 'soft', 'textMuted'])
        expect(dark.ground).not.toBe(brandColors.memphisDark.ground)
    })
})

describe('colour schemes: the rules Memphis was measured against', () => {
    it.each(SCHEMES)('%s keeps neighbouring nav tints ΔE ≥ 20', (scheme) => {
        const p = lightRoles(scheme)
        const tint = (cls: string) => pastel(p[NAV_TINTS[cls.replace(/^tint-/, '')]], p.paper)
        for (let i = 0; i < NAV.length - 1; i++) {
            const d = deltaE(tint(NAV[i].tint as string), tint(NAV[i + 1].tint as string))
            expect(d, `${scheme}: ${NAV[i].name}/${NAV[i + 1].name} ΔE ${d.toFixed(1)}`).toBeGreaterThanOrEqual(20)
        }
    })

    it.each(SCHEMES)('%s keeps every pair of entity tints ΔE ≥ 15', (scheme) => {
        const p = lightRoles(scheme)
        for (let i = 0; i < ENTITIES.length; i++) {
            for (let j = i + 1; j < ENTITIES.length; j++) {
                const [a, ra] = ENTITIES[i]
                const [b, rb] = ENTITIES[j]
                const d = deltaE(pastel(p[ra], p.paper), pastel(p[rb], p.paper))
                expect(d, `${scheme}: ${a}/${b} ΔE ${d.toFixed(1)}`).toBeGreaterThanOrEqual(15)
            }
        }
    })

    it.each(SCHEMES)('%s keeps ink and the muted grey legible (≥ 4.5:1)', (scheme) => {
        const p = lightRoles(scheme)
        // Ink sits on the play fill and on the "on"/playing fill; the muted grey
        // on the paper ground and on white panels.
        expect(contrast(p.ink, p.teal), `${scheme}: ink on teal`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(p.ink, p.yellow), `${scheme}: ink on yellow`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(p['text-muted'], p.paper), `${scheme}: muted on paper`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(p['text-muted'], '#FFFFFF'), `${scheme}: muted on white`).toBeGreaterThanOrEqual(4.5)
    })
})

describe('colour schemes: the stylesheet and the doodles', () => {
    const SCSS = readFileSync('src/assets/scss/Global/_palettes.scss', 'utf-8')

    it('the build injects every scheme with the kebab-case role names', () => {
        const injected = sassPalettes(brandColors.palettes)
        for (const scheme of SCHEMES.filter((s) => s !== 'memphis')) expect(injected).toContain(`"${scheme}": (light: (`)
        expect(injected).toContain('"blush-soft": #')
        expect(injected).toContain('"text-muted": #')
        expect(injected).toContain('"content-muted": #')
    })

    it('emits a light block per scheme on <html>, and a dark one that leaves Boring alone', () => {
        expect(SCSS).toMatch(/html\.palette-#\{\$name\} \{/)
        expect(SCSS).toMatch(/html\.palette-#\{\$name\} body\.theme-dark:not\(\.theme-stream\) \{/)
        expect(readFileSync('src/assets/scss/Global/index.scss', 'utf-8')).toMatch(/"\.\/palettes\.scss"/)
    })

    const MEMPHIS_SVG = readFileSync('src/assets/images/memphis-doodles.svg', 'utf-8')
    const schemes = Object.entries(brandColors.palettes as Record<string, { doodles: Roles }>)

    it.each(schemes)('%s doodle is exactly what scripts/palette-doodles.mjs writes', (name, p) => {
        // Hand-edited or stale after a change to the map: run the script.
        const committed = readFileSync(`src/assets/images/memphis-doodles-${name}.svg`, 'utf-8')
        expect(committed === recolorDoodle(MEMPHIS_SVG, p.doodles)).toBe(true)
    })

    const ARTWORK = new Set([...MEMPHIS_SVG.matchAll(/#([0-9a-fA-F]{6})\b/g)].map((m) => '#' + m[1].toUpperCase()))

    it.each(schemes)('%s doodle map names exactly the artwork colours (white aside)', (name, p) => {
        // A key the SVG does not contain is a typo; a colour the map forgets
        // stays Memphis in that scheme without a word. A colour a scheme keeps
        // on purpose is listed as mapping to itself (Lagune keeps the
        // artwork's own indigos and teals).
        const mapped = new Set(Object.keys(p.doodles).map((k) => k.toUpperCase()))
        expect([...mapped].sort(), name).toEqual([...ARTWORK].filter((c) => c !== '#FFFFFF').sort())
    })

    it('the recolouring is one pass: A→B and B→C never turn A into C', () => {
        expect(recolorDoodle('<g fill="#111111"/><g fill="#222222"/>', { '#111111': '#222222', '#222222': '#333333' })).toBe(
            '<g fill="#222222"/><g fill="#333333"/>',
        )
        expect(recolorDoodle('url(%23aaaaaa)', { '#AAAAAA': '#BBBBBB' })).toBe('url(%23BBBBBB)')
    })
})
