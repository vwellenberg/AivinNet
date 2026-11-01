import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// A plate in the theme's panel colour takes the panel's text colour.
//
// `$mem-panel` changes with the mode (white in light, near-black in dark);
// `$mem-ink` does not (styling.md: ink is for text on the light ACCENT fills,
// which look the same in both themes). A rule that sets both paints dark text
// on a dark plate in dark mode. That is what the Home recap card did on
// 1 November 2026: a month recap that read as an empty bar ("irgendwie ist
// oben eine leere bar?"), measured rgb(29,19,38) on rgb(29,23,41). The
// Continue card carried the same pair.
// ---------------------------------------------------------------------------

const SOURCES = import.meta.glob('/src/**/*.vue', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

/** The declarations of every style rule, own level only, with comments stripped. */
function rules(source: string): { selector: string; body: string }[] {
    const at = source.indexOf('<style')
    if (at < 0) return []
    const css = source
        .slice(source.indexOf('>', at) + 1)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '')
    const out: { selector: string; body: string }[] = []
    const stack: { selector: string; body: string }[] = []
    let token = ''
    for (let i = 0; i < css.length; i++) {
        const c = css[i]
        // `#{...}` is Sass interpolation, not a block: copy it whole.
        if (c === '#' && css[i + 1] === '{') {
            const end = css.indexOf('}', i)
            token += css.slice(i, end + 1)
            i = end
            continue
        }
        if (c === '{') {
            stack.push({ selector: token.trim(), body: '' })
            token = ''
        } else if (c === '}') {
            const rule = stack.pop()
            if (rule) {
                rule.body += token
                out.push(rule)
            }
            token = ''
        } else if (c === ';') {
            if (stack.length) stack[stack.length - 1].body += token + ';'
            token = ''
        } else {
            token += c
        }
    }
    return out
}

const PANEL_FILL = /--row-fill:\s*#\{\$mem-panel\}|background(-color)?:\s*\$mem-panel\s*;|candy-box\(\s*\$mem-panel\b/
const INK_TEXT = /(^|;)\s*color:\s*\$mem-ink\s*;/

describe('a panel-coloured plate takes the panel text', () => {
    const offenders: string[] = []
    let panelRules = 0
    for (const [path, source] of Object.entries(SOURCES)) {
        for (const { selector, body } of rules(source)) {
            if (!PANEL_FILL.test(body)) continue
            panelRules++
            if (INK_TEXT.test(body)) offenders.push(`${path} → ${selector}`)
        }
    }

    it('finds the panel-coloured plates (parser guard)', () => {
        // The recap and Continue cards alone are two; a parser that stops
        // matching would otherwise pass with nothing to check.
        expect(panelRules).toBeGreaterThanOrEqual(2)
        const recap = rules(SOURCES['/src/components/HomeView/WeeklyRecap.vue'])
        expect(recap.some((r) => r.selector === '.recap-card' && PANEL_FILL.test(r.body))).toBe(true)
    })

    it('never pairs the panel fill with $mem-ink text (dark on dark in dark mode)', () => {
        expect(
            offenders,
            'these rules fill with $mem-panel (dark in dark mode) and write $mem-ink (dark in both modes). ' +
                'Use $mem-text, the panel\'s own text colour.'
        ).toEqual([])
    })
})
