import { readFileSync, readdirSync, statSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// Wie Dinge ANKOMMEN (#143) — die drei Entscheidungen, die man beim Lesen der
// Regel nicht sieht und beim Ändern zerstört.
//
// 1. Der Treppen-Eintritt ist eine ANIMATION auf dem Element, kein Übergang auf
//    einem Zustand. `DynamicScroller` recycelt seine Zeilen-Knoten: eine
//    Animation läuft, wenn der Knoten entsteht — beim Recycling wechselt nur
//    der Inhalt. Ein Zustands-Übergang würde beim Scrollen dauernd feuern.
//    Live gemessen: 0 zusätzliche Starts über sechs Scroll-Schritte.
//
// 2. Der Deckel bei acht Zeilen gehört zur Idee. Bei 45ms je Zeile wartet
//    Zeile 200 sonst neun Sekunden, und aus einer Begrüßung wird eine Ladezeit.
//
// 3. Der Sticker-Anschlag läuft NICHT auf der Settle-Kurve. Die ist bei 27 %
//    der Zeit zu ~85 % durch; die Zwischenschritte bekommen keine Zeit, und
//    übrig bleibt eine Drehung, die bei 0,2 s niemand sieht. Genau daran ist
//    die erste Fassung gescheitert — im Filmstreifen nachgemessen.
//
// ⚠️ Stylesheets von der Platte, nicht über `import.meta.glob`: `as: "raw"`
// liefert für .scss einen leeren String, und alles hier liegt in .scss.
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
const ALL = Object.values(SHEETS).join('\n')

describe('arrival animations', () => {
    it('reads the stylesheets with content', () => {
        expect(Object.keys(SHEETS).length).toBeGreaterThan(8)
        expect(ALL).toContain('mem-step-in')
    })

    it('declares every arrival as an animation, never as a transition', () => {
        // A transition fires whenever the property changes — including when a
        // recycled row swaps its content. An animation fires when the node is
        // created. That difference is the whole reason the list can stagger at
        // all without flickering during every scroll.
        for (const name of ['mem-step-in', 'mem-sticker-slap', 'mem-band-drop', 'mem-texture-wipe']) {
            expect(ALL, `${name} has no @keyframes`).toContain(`@keyframes ${name}`)

            const asTransition = new RegExp(`transition:[^;]*${name}`)
            expect(asTransition.test(ALL), `${name} is used as a transition somewhere`).toBe(false)
        }
    })

    it('caps the stagger, so row 200 does not wait for its entrance', () => {
        const grid = SHEETS['src/assets/scss/Global/app-grid.scss']
        const loop = grid.match(/@for \$i from 1 through (\d+)/)

        expect(loop, 'the staggered rows are gone').toBeTruthy()
        expect(Number(loop![1])).toBeLessThanOrEqual(8)

        // And the delay has to come from the token, not from a fresh number.
        expect(grid).toMatch(/animation-delay: \$motion-stagger/)
    })

    it('keeps ONE staggered arrival, as a mixin', () => {
        // Die Staffel stand ausgeschrieben in cards.scss, bis die zweite Reihe
        // sie brauchte (die Bibliotheks-Kacheln der Startseite). Eine zweite
        // Kopie ist genau die Drift, gegen die die geteilten Anatomien hier
        // existieren — also gibt es sie einmal, als `mem-arrival`.
        const candy = SHEETS['src/assets/scss/_candy.scss']
        const grid = SHEETS['src/assets/scss/Global/app-grid.scss']

        const mixin = candy.slice(candy.indexOf('@mixin mem-arrival'))
        expect(mixin, 'mem-arrival ist weg').toBeTruthy()
        // Bis zur schließenden Klammer auf Spaltenposition 0 — die
        // verschachtelten Blöcke im Mixin sind eingerückt, die eigene nicht.
        const body = mixin.slice(0, mixin.search(/^}/m) + 1)

        // Dieselbe Keyframe wie die Zeilen — aus DEREN Regel gelesen, nicht hier
        // ein zweites Mal hingeschrieben: sonst prüft der Test nur, dass beide
        // Stellen denselben Tippfehler tragen.
        const rowGesture = grid.match(/animation: (mem-[\w-]+)[^;]*backwards/)
        expect(rowGesture, 'die Zeilen kommen nicht mehr an').toBeTruthy()
        expect(body, 'Reihen und Zeilen kommen inzwischen unterschiedlich an').toContain(
            `animation: ${rowGesture![1]}`
        )
        expect(body, 'ohne backwards blitzt das Element am Zielort auf').toMatch(/backwards/)
        expect(body).not.toMatch(/both/)
    })

    it('caps that stagger and takes its step from the token', () => {
        // Derselbe Deckel wie bei den Zeilen, aus demselben Grund: bei 45ms je
        // Element wartet das sechzigste einer Bibliotheksseite sonst 2,7s.
        const candy = SHEETS['src/assets/scss/_candy.scss']
        const mixin = candy.slice(candy.indexOf('@mixin mem-arrival'))
        const loop = mixin.match(/@for \$i from 1 through \$steps/)

        expect(loop, 'die Staffelung ist weg').toBeTruthy()
        expect(candy).toMatch(/@mixin mem-arrival\(\$steps: (\d+)\)/)
        expect(Number(candy.match(/@mixin mem-arrival\(\$steps: (\d+)\)/)![1])).toBeLessThanOrEqual(8)
        expect(mixin).toMatch(/animation-delay: \$motion-stagger/)
    })

    it('lands whatever stands side by side WITH the wave, not before it', () => {
        // Der Unterschied zwischen Zeile und Reihe, und der Grund, warum die
        // Kacheln die Zeilen-Regel nicht einfach kopieren konnten: Zeile 9 steht
        // unter der Falz, Kachel 9 mitten im Bild (gemessen: 5 Spalten, 10
        // Kacheln im Viewport bei 1440×900). Fällt sie auf 0s, ist sie VOR der
        // Welle da und die Staffel liest sich rückwärts.
        const candy = SHEETS['src/assets/scss/_candy.scss']
        const mixin = candy.slice(candy.indexOf('@mixin mem-arrival'))

        expect(mixin, 'hinter dem Deckel fällt die Reihe wieder auf 0s').toMatch(
            /&:nth-child\(n \+ #\{\$steps \+ 1\}\) \{\s*animation-delay: \$motion-stagger \* \$steps;/
        )
    })

    it.each([
        ['die Kacheln', 'src/assets/scss/Global/cards.scss'],
        ['die Bibliotheks-Kacheln der Startseite', 'src/components/HomeView/Browse.vue'],
    ])('%s nehmen die geteilte Ankunft', (_label, file) => {
        // Aufrufstellen, nicht Schreibweisen: wer `mem-step-in` hier von Hand
        // ausschreibt, hat die Kopie wieder — und der Deckel fehlt ihm dann.
        // Von der Platte gelesen wie die Stylesheets: der .vue-Glob liefert
        // zwar Inhalt, aber zwei Schlüsselformen (mit und ohne führenden
        // Schrägstrich) in einem Test sind eine Fehlerquelle ohne Gegenwert.
        expect(readFileSync(file, 'utf8'), `${file} bindet mem-arrival nicht ein`).toMatch(/@include mem-arrival/)
    })

    it('lets the segmented tab plate arrive as ONE object', () => {
        // Eine segmentierte Leiste ist ein Objekt mit Trennlinien, kein Satz
        // Chips: `overflow: hidden` außen herum, Trennstriche statt Spalten.
        // Gestaffelte Segmente würden die Platte beim Auftauchen aufreißen.
        const candy = SHEETS['src/assets/scss/_candy.scss']
        const mixin = candy.slice(candy.indexOf('@mixin mem-seg-tabs'))
        // Bis zur schließenden Klammer auf Spaltenposition 0 — die
        // verschachtelten Blöcke im Mixin sind eingerückt, die eigene nicht.
        const body = mixin.slice(0, mixin.search(/^}/m) + 1)

        expect(body, 'die Tab-Platte kommt nicht an').toMatch(/animation: mem-step-in[^;]*backwards/)
        expect(body, 'die Platte staffelt ihre Segmente — sie reißt dabei auf').not.toMatch(
            /@include mem-arrival/
        )
    })

    it('holds the start frame during the delay', () => {
        // Without `backwards` a delayed row paints at its destination first and
        // then jumps back to start — the flicker reads as a rendering bug.
        const grid = SHEETS['src/assets/scss/Global/app-grid.scss']
        expect(grid).toMatch(/animation: mem-step-in[^;]*backwards/)
    })

    it('keeps the sticker slap off the settle curve', () => {
        const classes = SHEETS['src/assets/scss/Global/_button-classes.scss']
        const candy = SHEETS['src/assets/scss/_candy.scss']

        // The call site: flat curve, shaping in the keyframes.
        expect(candy).toMatch(/animation: mem-sticker-slap [^;]*ease-out/)
        expect(candy).not.toMatch(/animation: mem-sticker-slap [^;]*motion-curve-settle/)

        // And the reason travels with it, because the next person will reach
        // for the settle curve exactly as I did.
        expect(classes).toMatch(/85 ?%/)
    })

    it('lets the row fill stay a cut', () => {
        // styling.md: paint cuts, it does not fade. The texture wipes ACROSS
        // (translateX) and the teeth drop (scaleY) — neither fades a colour in.
        const classes = SHEETS['src/assets/scss/Global/_button-classes.scss']
        const wipe = classes.slice(classes.indexOf('@keyframes mem-texture-wipe'))
        const wipeBody = wipe.slice(0, wipe.indexOf('}\n}') + 3)

        expect(wipeBody).toMatch(/translateX/)
        expect(wipeBody, 'the texture fades in — that is a paint fade, not motion').not.toMatch(/opacity/)
    })
})
