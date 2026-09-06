import { readFileSync, readdirSync, statSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// Bewegung: die zwei Regeln, die nicht pro Datei entschieden werden dürfen.
//
// 1. `prefers-reduced-motion` gilt EINMAL, für alles. Vorher stand die Antwort
//    in vier Dateien und deckte damit vier Dinge ab — bei 66 handgeschriebenen
//    Sekundenwerten im Bestand. Das ist kein Schönheitsfehler: die Einstellung
//    setzt man gegen Schwindel und Migräne, nicht aus Geschmack.
//
// 2. Der harte Offset-Schatten läuft der Fläche hinterher. Er ist die Signatur
//    des Stils, und genau deshalb darf nicht jede Komponente selbst entscheiden,
//    ob sie mitzieht — eine Platte ohne Nachzug fällt neben einer mit sofort auf.
//
// ⚠️ Stylesheets werden VON DER PLATTE gelesen, nicht über `import.meta.glob`:
// `as: "raw"` liefert für `.scss` einen leeren String (.claude/rules/testing.md),
// und die halbe Bewegungslogik liegt in .scss. Ein Glob über beide Endungen
// prüft die Komponenten und überspringt die Stylesheets stillschweigend.
// ---------------------------------------------------------------------------

function scssFiles(dir: string): string[] {
    const files: string[] = []

    for (const entry of readdirSync(dir)) {
        const path = `${dir}/${entry}`
        if (statSync(path).isDirectory()) files.push(...scssFiles(path))
        else if (entry.endsWith('.scss')) files.push(path)
    }

    return files
}

const SHEETS = Object.fromEntries(scssFiles('src/assets/scss').map(path => [path, readFileSync(path, 'utf8')]))
const POLICY = 'src/assets/scss/Global/motion-policy.scss'

describe('reduced motion', () => {
    it('reads the stylesheets with content', () => {
        expect(Object.keys(SHEETS).length).toBeGreaterThan(8)
        expect(Object.values(SHEETS).every(source => source.length > 0)).toBe(true)
    })

    it('answers the question in one place', () => {
        const policy = SHEETS[POLICY]

        expect(policy, 'Global/motion-policy.scss is gone').toBeTruthy()
        expect(policy).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
        // The blanket rule: every element, both pseudo-elements.
        expect(policy).toMatch(/\*,\s*\n\s*\*::before,\s*\n\s*\*::after/)
        expect(policy).toMatch(/animation-duration: 0\.01ms !important/)
        expect(policy).toMatch(/transition-duration: 0\.01ms !important/)
    })

    it('is loaded LAST, or it loses to everything after it', () => {
        // The blanket rule has to come after the components it covers, and the
        // exceptions live below it in the same file. Imported earlier, the rule
        // silently stops applying — with nothing to see and nothing to fail.
        const index = SHEETS['src/assets/scss/Global/index.scss']
        const imports = index.slice(0, index.indexOf(';'))
        const last = imports
            .split(',')
            .map(part => part.trim())
            .filter(part => part.includes('.scss'))
            .pop()

        expect(last).toContain('motion-policy')
    })

    it('keeps every exception in that same file, with a reason', () => {
        const policy = SHEETS[POLICY]

        // The Lauflicht keeps running (slower): frozen, it reads as a broken
        // effect rather than as consideration — it is the "something is playing"
        // indicator, and a still one states something false.
        expect(policy).toMatch(/lauflicht-rim::before/)
        expect(policy).toMatch(/animation-duration: 14s !important/)

        // Every exception carries prose. A bare selector list here would be the
        // start of "reduced motion, except the bits I liked".
        const exceptions = policy.slice(policy.indexOf('Begründete Ausnahmen'))
        expect(exceptions.split('\n').filter(line => line.trim().startsWith('//')).length).toBeGreaterThan(6)
    })

    it('leaves no component to answer it privately', () => {
        // Component-level reduced-motion rules are not forbidden — they may
        // TIGHTEN the policy. But a new one is nearly always someone re-solving
        // a solved problem, so the count is pinned: raising it is a decision,
        // not an accident.
        const owners = Object.entries(SHEETS)
            .filter(([file, source]) => file !== POLICY && source.includes('prefers-reduced-motion'))
            .map(([file]) => file)

        expect(owners, `these still answer reduced-motion on their own: ${owners.join(', ')}`).toHaveLength(1)
        expect(owners[0]).toContain('lauflicht')
    })
})

describe('the shadow trails its surface', () => {
    /** Every transition declaration that moves a hard offset shadow. */
    const shadowTransitions = Object.entries(SHEETS).flatMap(([file, source]) =>
        source
            .split('\n')
            .map((line, index) => ({ file, line: line.trim(), number: index + 1 }))
            .filter(entry => /^transition:.*box-shadow/.test(entry.line) || /box-shadow \$motion|box-shadow 0\.12s/.test(entry.line))
    )

    it('finds the declarations it is checking', () => {
        expect(shadowTransitions.length).toBeGreaterThan(2)
    })

    it('gives the shadow its delay wherever it is animated', () => {
        for (const entry of shadowTransitions) {
            // The delay is the whole idea: a hard shadow in lockstep reads as a
            // sticker printed on the page, a shadow a breath late reads as an
            // object with weight above it.
            const hasLag = /box-shadow[^,;]*(\$motion-lag|40ms)/.test(entry.line)

            expect(hasLag, `${entry.file}:${entry.number} animates the shadow without the 40ms trail:\n  ${entry.line}`).toBe(
                true
            )
        }
    })
})
