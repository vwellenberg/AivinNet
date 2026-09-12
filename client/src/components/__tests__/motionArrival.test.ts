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

    it('lets the tiles arrive with the same gesture as the rows', () => {
        // Die Kacheln haben die Ankunft aus #143 nachgereicht bekommen — mit
        // `mem-step-in`, nicht mit einer eigenen Keyframe. Zwei Vokabeln für
        // dieselbe Aussage ("hier kommt etwas an") sind genau die Drift, gegen
        // die die geteilte Kachel-Anatomie existiert; und `btn-pop`, die andere
        // naheliegende Wahl, ist für ein 44-px-Bedienelement gebaut.
        const cards = SHEETS['src/assets/scss/Global/cards.scss']

        expect(cards, 'die Kacheln kommen nicht mehr an').toMatch(/animation: mem-step-in[^;]*backwards/)
        expect(cards, 'die Kacheln haben eine eigene Ankunfts-Keyframe bekommen').not.toMatch(/@keyframes/)
    })

    it('caps the tile stagger too, and takes the step from the token', () => {
        // Derselbe Deckel wie bei den Zeilen, aus demselben Grund: bei 45ms je
        // Kachel wartet die sechzigste einer Bibliotheksseite sonst 2,7s.
        const cards = SHEETS['src/assets/scss/Global/cards.scss']
        const loop = cards.match(/@for \$i from 1 through (\d+)/)

        expect(loop, 'die Staffelung der Kacheln ist weg').toBeTruthy()
        expect(Number(loop![1])).toBeLessThanOrEqual(8)
        expect(cards).toMatch(/animation-delay: \$motion-stagger/)
    })

    it('lands the tiles past the cap WITH the wave, not before it', () => {
        // Der Unterschied zwischen Zeile und Raster, und der einzige Grund,
        // warum die Kacheln nicht einfach die Zeilen-Regel kopieren können:
        // Zeile 9 steht unter der Falz, Kachel 9 steht mitten im Bild (gemessen:
        // 5 Spalten, 10 Kacheln im Viewport bei 1440×900). Fällt sie auf 0s
        // zurück, ist sie VOR der Welle da und die Staffel liest sich rückwärts.
        const cards = SHEETS['src/assets/scss/Global/cards.scss']

        expect(cards, 'die Kacheln hinter dem Deckel fallen wieder auf 0s').toMatch(
            /&:nth-child\(n \+ 9\) \{\s*animation-delay: \$motion-stagger \* 8;/
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
