import { readFileSync, readdirSync, statSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { ARRIVAL_ANIMATIONS } from '@/utils/arrivalLatch'

const ARRIVALS = [...ARRIVAL_ANIMATIONS]

// ---------------------------------------------------------------------------
// Wie Dinge ANKOMMEN (#143) — die drei Entscheidungen, die man beim Lesen der
// Regel nicht sieht und beim Ändern zerstört.
//
// 1. Der Treppen-Eintritt ist eine ANIMATION auf dem Element, kein Übergang auf
//    einem Zustand. `DynamicScroller` recycelt seine Zeilen-Knoten: eine
//    Animation läuft, wenn der Knoten entsteht — beim Recycling wechselt nur
//    der Inhalt. Ein Zustands-Übergang würde beim Scrollen dauernd feuern.
//    ⚠️ Das allein reicht nicht: Eine Animation startet auch neu, wenn ihr
//    Knoten UMGEHÄNGT wird (der Scroller sortiert ~300 ms nach dem Scrollen),
//    und ein `:key` auf dem Slot baut jede recycelte Zeile neu. Die frühere
//    Messung hier („0 zusätzliche Starts über sechs Scroll-Schritte") hat
//    beides nicht erfasst — nachgemessen am 2026-09-28: 70 Neustarts NACH dem
//    Scroll-Stopp auf einer 394er-Playlist. Sicherungen: arrivalLatch.test.ts,
//    scrollerRecycling.test.ts.
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
        for (const name of [
            'mem-step-in',
            'mem-sticker-slap',
            'mem-band-drop',
            'mem-texture-wipe',
            'mem-plate-rise',
            'mem-fill-grow',
        ]) {
            expect(ALL, `${name} has no @keyframes`).toContain(`@keyframes ${name}`)

            const asTransition = new RegExp(`transition:[^;]*${name}`)
            expect(asTransition.test(ALL), `${name} is used as a transition somewhere`).toBe(false)
        }
    })

    it('caps the stagger, so row 200 does not wait for its entrance', () => {
        // Der Deckel steht seit dem gemeinsamen Mixin dort, nicht mehr in
        // app-grid.scss — die Zeilenliste bindet ihn nur noch ein.
        const candy = SHEETS['src/assets/scss/_candy.scss']
        const cap = candy.match(/@mixin mem-arrival\(\$steps: (\d+)/)

        expect(cap, 'die Staffelung ist weg').toBeTruthy()
        expect(Number(cap![1])).toBeLessThanOrEqual(8)

        // Und der Schritt kommt aus dem Token, nicht aus einer frischen Zahl.
        expect(candy).toMatch(/animation-delay: \$motion-stagger/)
    })

    it('keeps ONE staggered arrival, as a mixin', () => {
        // Die Staffel stand ausgeschrieben in cards.scss, bis die zweite Reihe
        // sie brauchte (die Bibliotheks-Kacheln der Startseite). Eine zweite
        // Kopie ist genau die Drift, gegen die die geteilten Anatomien hier
        // existieren — also gibt es sie einmal, als `mem-arrival`.
        const candy = SHEETS['src/assets/scss/_candy.scss']
        const mixin = candy.slice(candy.indexOf('@mixin mem-arrival'))
        expect(mixin, 'mem-arrival ist weg').toBeTruthy()
        // Bis zur schließenden Klammer auf Spaltenposition 0 — die
        // verschachtelten Blöcke im Mixin sind eingerückt, die eigene nicht.
        const body = mixin.slice(0, mixin.search(/^}/m) + 1)

        expect(body, 'die Ankunft benutzt nicht mehr die Zeilen-Keyframe').toMatch(/animation: mem-step-in/)
        expect(body, 'ohne backwards blitzt das Element am Zielort auf').toMatch(/backwards/)
        // `both` hielte zusätzlich den letzten Frame fest, und dessen
        // `transform: none` schlüge jedes deklarierte transform (styling.md).
        //
        // Geprüft an der DEKLARATION, nicht am Block: der Kommentar darüber
        // nennt `both` als das Verbotene, und ein Test, der daran scheitert,
        // verbietet die Begründung statt den Fehler.
        const declaration = body.match(/animation:[^;]*;/)
        expect(declaration, 'die Ankunft hat keine animation-Kurzform mehr').toBeTruthy()
        expect(declaration![0], 'fill-mode both macht Hover und Press still tot').not.toContain('both')
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
        ['die Kacheln', 'src/assets/scss/Global/cards.scss', 'hold'],
        ['die Bibliotheks-Kacheln der Startseite', 'src/components/HomeView/Browse.vue', 'hold'],
        ['die Songzeilen', 'src/assets/scss/Global/app-grid.scss', 'drop'],
        ['die Chart-Zeilen', 'src/components/Stats/ChartItem.vue', 'drop'],
        ['die Up-next-Zeilen der Continue-Karte', 'src/components/HomeView/ContinueCard.vue', 'drop'],
        ['die Ordner-Wahl beim ersten Start', 'src/components/modals/RootDirsPrompt.vue', 'drop'],
    ])('%s nehmen die geteilte Ankunft (%s, $beyond: %s)', (_label, file, beyond) => {
        // Aufrufstellen statt Schreibweisen: wer `mem-step-in` von Hand
        // ausschreibt, hat die Kopie wieder — und ihm fehlt dann der Deckel.
        //
        // Die Hälfte gehört mitgeprüft, weil sie die eine Entscheidung ist, die
        // man hier falsch treffen kann: `hold` für alles nebeneinander (sonst
        // läuft die Welle rückwärts), `drop` für alles untereinander (sonst
        // blendet eine virtualisierte Zeile mitten im Scrollen nach).
        const source = readFileSync(file, 'utf8')
        const call = source.match(/@include mem-arrival\(?([^;)]*)\)?;/)

        expect(call, `${file} bindet mem-arrival nicht ein`).toBeTruthy()
        const usesDrop = /\$beyond:\s*drop/.test(call![0])
        expect(usesDrop, `${file} sollte $beyond: ${beyond} benutzen`).toBe(beyond === 'drop')
    })

    it('gives the chart rows a container that holds nothing else', () => {
        // Die eine Falle, die `mem-arrival` mitbringt: `:nth-child` zählt ALLE
        // Geschwister, nicht die gleichartigen. Die Chart-Zeilen standen direkt
        // im `.chartgroup` neben Kopfzeile, `<br>` und Statusmeldung — Zeile 1
        // hätte die Verzögerung von Platz 3 bekommen und Zeile 7 wäre auf Platz
        // 9 gefallen, also VOR Zeile 1 angekommen. Beim Self-Review im eigenen
        // Diff gefunden, nicht im Bild: die Zeilen animierten ja alle.
        const group = readFileSync('src/components/Stats/ChartItemGroup.vue', 'utf8')
        // `lastIndexOf`, nicht `indexOf`: die Statusmeldung steht in einem
        // verschachtelten `<template v-if>`, dessen Schluss-Tag sonst den
        // Ausschnitt vor den Zeilen enden lässt — der Test wäre rot gewesen,
        // während der Code stimmt.
        const template = group.slice(0, group.lastIndexOf('</template>'))
        const rows = template.indexOf('class="chartrows"')

        expect(rows, 'die Chart-Zeilen haben keinen eigenen Kasten mehr').toBeGreaterThan(-1)
        expect(
            template.indexOf('<ChartItem'),
            'ChartItem steht außerhalb von .chartrows — die Staffel zählt dann wieder Fremdelemente mit'
        ).toBeGreaterThan(rows)
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
        const candy = SHEETS['src/assets/scss/_candy.scss']
        expect(candy).toMatch(/animation: mem-step-in[^;]*backwards/)
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

// ---------------------------------------------------------------------------
// Die große Platte (2026-10-07). Die Continue-Karte — das größte Objekt der
// Startseite — kam ohne jede eigene Bewegung an: gemessen per
// `animationstart`-Zensus auf Home null Animationen an `.continue-card`,
// während jede Kachel und jede Caption darunter eintraf. Und das Modal fiel als
// einziges Element der App auf einer JS-Feder (@vueuse/motion) 100 px herein,
// außerhalb des Vokabulars und außerhalb von `prefers-reduced-motion`.
// ---------------------------------------------------------------------------

describe('a plate rises', () => {
    const classes = SHEETS['src/assets/scss/Global/_button-classes.scss']
    const keyframes = classes.slice(classes.indexOf('@keyframes mem-plate-rise'))
    const body = keyframes.slice(0, keyframes.search(/^}/m) + 1)

    it('rises out of its own shadow and lands on the DECLARED one', () => {
        expect(body, 'mem-plate-rise ist weg').toMatch(/@keyframes mem-plate-rise/)
        // Startet ohne Schatten — das Gegenstück zum Drücken.
        expect(body).toMatch(/0% \{[^}]*box-shadow: 0 0 0 var\(--mem-shadow\)/)
        // Kein 100-%-Frame: ohne ihn läuft jede Eigenschaft auf den Wert des
        // Elements zu — 4 px an der Karte, 6 px am Modal. Ein fester Endwert
        // hier wäre an einer der beiden Stellen ein Sprung am Ende.
        expect(body, 'ein fester Endframe springt am Ende auf den deklarierten Schatten').not.toMatch(/100% \{/)
    })

    it.each([
        ['die Continue-Karte', 'src/components/HomeView/ContinueCard.vue'],
        ['das Modal', 'src/components/modal.vue'],
    ])('%s steigt auf', (_label, file) => {
        const source = readFileSync(file, 'utf8')
        expect(source).toMatch(/animation: mem-plate-rise \$motion-settle/)
    })

    it('lets the moving parts of the Continue card follow the plate, not ride along', () => {
        const card = readFileSync('src/components/HomeView/ContinueCard.vue', 'utf8')

        // Der Balken läuft auf seinen Wert, nach der Platte; `backwards`, sonst
        // steht er während der Wartezeit schon voll da und springt auf null.
        expect(card).toMatch(/animation: mem-fill-grow [^;]*\$motion-after-plate backwards/)
        // Continue poppt — ein Primärknopf, der einmal pro Besuch entsteht,
        // holt sich den Pop an der Aufrufstelle (btn-primary hat keinen).
        expect(card).toMatch(/@include btn-pop;\s*--btn-pop-delay: #\{\$motion-after-plate/)
    })

    it('rises ONCE, even when Home reorders the cards under it', () => {
        // Eine CSS-Animation startet neu, sobald Vue ihren Knoten umhängt — und
        // die Karten sind ein `v-for` mit Key: kommt `fetchAll()` mit neuer
        // Reihenfolge zurück, stieg die verschobene Karte samt Balken und Pop
        // ein zweites Mal auf. Dieselbe Einmal-Sperre wie die Zeilen.
        expect(ARRIVALS).toContain('mem-plate-rise')
        const card = readFileSync('src/components/HomeView/ContinueCard.vue', 'utf8')
        const latched = card.slice(card.indexOf('&[data-arrived]'))
        expect(latched, 'die Karte hat keine Einmal-Sperre').toMatch(/^&\[data-arrived\] \{\s*animation: none;/)
        // Die Kinder hängen mit um und starten mit neu — sie gehören in dieselbe Sperre.
        expect(latched.slice(0, latched.indexOf('\n  }'))).toMatch(/\.progress span[\s\S]*\.resume[\s\S]*animation: none;/)
    })
})

describe('no motion outside the stylesheet', () => {
    it('animates nothing through @vueuse/motion', () => {
        // Eine JS-Animation schreibt Inline-Styles pro Frame — die pauschale
        // Regel in motion-policy.scss erreicht sie nicht, und ihre Federn und
        // Dauern kommen nicht aus _motion.scss. Von den drei Direktiven, die es
        // gab, laufen Modal und Ordner-Wahl jetzt über CSS; das Now-Playing-
        // Cover hat keine eigene mehr — es kommt mit seiner Seite an
        // (`mem-page-enter`), wie jedes andere Bild einer Seite.
        const offenders: string[] = []
        const walk = (dir: string) => {
            for (const entry of readdirSync(dir)) {
                const path = `${dir}/${entry}`
                if (statSync(path).isDirectory()) {
                    if (entry !== '__tests__') walk(path)
                } else if (/\.(vue|ts)$/.test(entry)) {
                    const source = readFileSync(path, 'utf8')
                    if (/\bv-motion[\w-]*[\s=>]|from ['"](@vueuse\/motion|motion|popmotion|animejs|gsap)['"]/.test(source))
                        offenders.push(path)
                }
            }
        }
        walk('src')

        expect(offenders).toEqual([])

        // Und keine solche Bibliothek in den Abhängigkeiten, die nur darauf wartet.
        const deps = Object.keys(JSON.parse(readFileSync('package.json', 'utf8')).dependencies)
        expect(deps.filter(dep => ['@vueuse/motion', 'motion', 'popmotion', 'animejs', 'gsap'].includes(dep))).toEqual([])
    })
})
