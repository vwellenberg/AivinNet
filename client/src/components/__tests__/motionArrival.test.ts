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
// ⚠️ Stylesheets von der Platte, nicht über `import.meta.glob`: `query: "?raw"`
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
        // Nicht virtualisiert: eine feste Seite aus zehn Zeilen, alle im Bild.
        ['die Chart-Zeilen', 'src/components/Stats/ChartItem.vue', 'hold'],
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

    it('staggers every row of the default chart page, so none stands there before row 1', () => {
        // „1–8 mit Aufbau-Animation, danach direkt schon da": hinter dem Deckel
        // fielen Zeile 9 und 10 der Zehner-Seite auf 0s.
        const source = readFileSync('src/components/Stats/ChartItem.vue', 'utf8')
        const steps = Number(source.match(/@include mem-arrival\(\$steps:\s*(\d+)/)?.[1])
        const pager = readFileSync('src/utils/chartPager.ts', 'utf8')
        const smallest = Number(pager.match(/CHART_PAGE_SIZES = \[(\d+)/)?.[1])

        expect(smallest, 'CHART_PAGE_SIZES nicht gefunden').toBeGreaterThan(0)
        expect(steps).toBe(smallest)
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
// Die große Platte (2026-10-07): das Modal fiel als einziges Element der App
// auf einer JS-Feder (@vueuse/motion) 100 px herein, außerhalb des Vokabulars
// und außerhalb von `prefers-reduced-motion`. Es steigt seitdem auf.
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
        // Elements zu — 4 px an einer Rewind-Platte, 6 px am Modal. Ein fester
        // Endwert hier wäre an einer der beiden Stellen ein Sprung am Ende.
        expect(body, 'ein fester Endframe springt am Ende auf den deklarierten Schatten').not.toMatch(/100% \{/)
    })

    it('das Modal steigt auf', () => {
        const source = readFileSync('src/components/modal.vue', 'utf8')
        expect(source).toMatch(/animation: mem-plate-rise \$motion-settle/)
    })
})

// ---------------------------------------------------------------------------
// Home wird HINGELEGT (Nutzer, 2026-11-13: „alles soll so comic-artig als
// Karten hingelegt werden"). Gemessen per `animationstart`-Zensus beim Aufbau
// (1440×900): sechs Gesten liefen nebeneinander — Kacheln traten ein, Sticker
// wurden aufgeklebt, die Continue-Karte stieg auf, ihr Balken lief, ihr Knopf
// poppte, ihre Punkte bauten sich auf —, und die Radio-Platten hatten gar
// keine und standen einen Frame vor allem anderen da. Die Karte kam ~470 ms
// nach ihrer Umgebung zur Ruhe.
//
// Jetzt: jede PLATTE auf Home kommt mit der einen Ankunft der Kacheln
// (`mem-arrival`), als EIN Objekt mit allem, was darauf gedruckt ist. Sticker
// werden weiter aufgeklebt, das ist ihre eigene Geste. Sonst bewegt sich nichts.
// ---------------------------------------------------------------------------

describe('Home is laid down as cards', () => {
    const style = (file: string) => {
        const source = readFileSync(file, 'utf8')
        return source.slice(source.indexOf('<style')).replace(/\/\/[^\n]*/g, '')
    }
    const HOME = 'src/components/HomeView'
    const card = style(`${HOME}/ContinueCard.vue`)

    it.each([
        // In a row of their own kind: staggered, left to right.
        ['die Continue-Karten', `${HOME}/ContinueCard.vue`, /\.continue-wrap \{[^}]*@include mem-arrival;/],
        ['die beiden Radio-Platten', `${HOME}/RadioDial.vue`, /\.radio-body \{[\s\S]*?> \* \{\s*@include mem-arrival;/],
        // Alone among siblings of other kinds: the same gesture, no stagger.
        ['die Recap-Karte', `${HOME}/WeeklyRecap.vue`, /\.recap-card \{\s*@include mem-arrival\(\$steps: 0\);/],
        ['die Rewind-Karte', `${HOME}/RewindCard.vue`, /\.rewind-card \{\s*@include mem-arrival\(\$steps: 0\);/],
        ['die Silvester-Karte', `${HOME}/YearInMusicCard.vue`, /\.year-music-card \{\s*@include mem-arrival\(\$steps: 0\);/],
        ['der Adventskalender', `${HOME}/AdventCalendar.vue`, /\.advent-card \{\s*@include mem-arrival\(\$steps: 0\);/],
    ])('%s kommen wie die Kacheln an', (_label, file, call) => {
        expect(style(file as string)).toMatch(call as RegExp)
    })

    it('lets nothing ON the Continue card move on its own', () => {
        // One animation in the whole block, and it is the Up next rows': they
        // need a request of their own and arrive after the card, top-down.
        const animations = card.match(/animation:|@include (mem-arrival|btn-pop|mem-motif-pop)[^;]*;/g) ?? []
        expect(animations).toEqual(['@include mem-arrival;', '@include mem-arrival($beyond: drop);'])
        expect(card).toMatch(/> li \{\s*@include mem-arrival\(\$beyond: drop\);/)
    })

    it('prints the dots on the card: they arrive with it and never move', () => {
        // The dots built up after the plate, each one growing from nothing
        // (`mem-dots-wave`): a whole surface in motion behind the text.
        const dots = card.match(/&::before \{[^}]*mem-halftone[^}]*\}/)

        expect(dots, 'the halftone layer of the Continue card was not found').toBeTruthy()
        expect(dots![0], 'the dots animate again').not.toMatch(/animation|mem-dots-wave/)
        // The tools of the old choreography are gone, so nothing picks them up.
        expect(ALL).not.toMatch(/mem-dots-(wave|grow)|mem-fill-grow|\$motion-after-plate/)
    })

    it('gives a lone plate the gesture without a stagger', () => {
        // `$steps: 0`: no `:nth-child` delay at all. The date cards are children
        // of the page next to the header and each other; counted, their delay
        // would depend on which card happens to render above them.
        const candy = SHEETS['src/assets/scss/_candy.scss']
        const mixin = candy.slice(candy.indexOf('@mixin mem-arrival'))
        // Sass counts `from 1 through 0` DOWN (1, 0) instead of not at all.
        expect(mixin).toMatch(/@if \$steps > 0 \{\s*@for \$i from 1 through \$steps/)
        expect(mixin).toMatch(/@if \$beyond == hold and \$steps > 0/)
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
