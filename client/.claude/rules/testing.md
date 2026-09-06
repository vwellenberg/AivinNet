---
paths:
  - "src/**/__tests__/**"
  # Die Testkonfiguration liegt im `test:`-Block von `vite.config.ts` — eine
  # `vitest.config.*` gibt es in diesem Repo nicht, der Glob hier zeigte also
  # ins Leere und die Regel lud beim Schrauben an der Konfiguration nie.
  - "vite.config.ts"
---

# Tests

**Vitest 0.x, nicht 1.x** — wegen Vite-3-Kompatibilität. Tests liegen als `*.test.ts` in
`src/**/__tests__/`. `yarn test` (einmal), `yarn test:watch`.

Getestet wird, wo Fehler teuer waren: Store-Logik, Request-Schichten, pure Utils
(`playlistMove`, `shufflePicker`, Sync-Mathematik). **Reines Markup und CSS wird nicht
unit-getestet** — dort ersetzt die headless Screenshot-Verifikation den Test. Submit-,
FormData- und Fetch-Logik ist *nicht* „nur Markup".

Pflicht im selben PR: **Bugfix ⇒ Regressionstest**, der den Bug reproduziert (vor dem Fix rot,
danach grün). Neue Store-/Util-/Request-Logik ⇒ Vitest.

## ⚠️ `setValue()` auf `input[type=range]`

Der VTU-Helper feuert `input`, aber die Komponente sieht dabei den **alten** Wert — Tests
schlagen dann aus Gründen fehl, die nichts mit dem Code zu tun haben. Stattdessen:

```ts
element.value = String(x)
await input.trigger('input')
```

Vorbild: `dragTo()` in `LeftSidebar/NP/__tests__/Progress.test.ts`.

## ⚠️ `vi.resetModules()` ist mit Pinia unzuverlässig

Vitest 0.34 teilt Modul-Instanzen, und der Store-State des Vortests überlebt über eine zweite
Pinia-Kopie. **Kein Registry-Reset.** Stattdessen exportiert der betroffene Store einen
Test-Reset-Helper, der im `beforeEach` aufgerufen wird — Vorbild:
`__resetDeviceSyncTestState()` in `stores/devicesync.ts`.

## ⚠️ Quelltext-scannende Tests: `import.meta.glob(..., { as: "raw" })` liefert bei `.scss` LEER

Es gibt hier mehrere Tests, die den Quelltext selbst prüfen, weil Prosa die Regel nicht gehalten
hat (`headerActionOrder`, `cardAnatomy`, `rowHover`, `queueSeamCensus`). Für `.vue` ist der Glob
richtig — der Test sieht genau
die Dateien, die der Build sieht. Für `.scss` **nicht**: Vite schickt Stylesheets erst durch die
CSS-Pipeline, und die ist unter Test ausgestubbt. Zurück kommt ein **leerer String** — kein
Fehler, kein `undefined`, nichts, woran man es merkt. Die erste Fassung von `cardAnatomy` prüfte
damit jede Karte gegen eine leere Selektorliste und war grün, obwohl der Bug noch drin war.

Stylesheets also mit `readFileSync` lesen, **relativ** (die cwd des Runners ist das
Projekt-Root):

```ts
const ANATOMY_FILE = "src/assets/scss/Global/cards.scss"   // nicht process.cwd(), nicht import.meta.url
```

Die beiden naheliegenderen Anker fallen aus: `process.cwd()` ist in Testdateien ein
**Lint-Fehler** (`no-undef` — die ESLint-Config gibt ihnen keine node-Umgebung), und
`import.meta.url` hinterlässt Vitests Transform in einer Form, die `fileURLToPath()` mit
`ERR_INVALID_ARG_TYPE` ablehnt.

**Und die eigentliche Lehre:** Ein Test, der Quelltext parst, schlägt beim Brechen seines
Parsers nicht fehl, sondern wird **still grün**. Er braucht deshalb Wächter über seine eigenen
Eingaben — „die Komponentenliste ist nicht leer", „die Selektorliste enthält einen bekannten
Treffer". Genau der zweite hat den leeren Glob oben gefunden. Zusätzlich einmal von Hand rot
stellen (die Zeile wieder entfernen, Test laufen lassen) und das Ergebnis in den PR schreiben.

### ⚠️ Ein Zensus über einen BEZEICHNER besteht, sobald der Import dasteht

`adminOnlyActions.test.ts` suchte zuerst nach `loggedInUserIsAdmin` als Wort. In der
Mutationsprobe wurde `if (loggedInUserIsAdmin())` zu `if (true)` — das Kontextmenü war für
jeden offen, der Import stand weiter oben, und **der Test blieb grün**. Ein Bezeichner beweist
nur, dass jemand die Vokabel kennt.

Also: **Import-Zeilen vor dem Prüfen wegwerfen** und die Form verlangen, die auch wirkt — den
Aufruf (`loggedInUserIsAdmin\s*\(`) bzw. den Ausdruck (`is_admin`). Wo eine Referenz die
richtige Schreibweise ist, bekommt sie ein **eigenes, engeres** Muster: Eine Settings-Kategorie
gated per `show_if: loggedInUserIsAdmin` (ohne Klammern), und das Muster pinnt gleich mit, an
welchem Schlüssel es hängt.

**Die Probe gehört dazu, nicht die Absicht:** jede Regel, die der Zensus behauptet, einmal
einzeln brechen und den Test rot sehen. Vier Mutationen, vier rote Läufe, dazu ein grüner
Baseline- und ein grüner Restore-Lauf — das Ergebnis in den PR. Ohne diesen Lauf hätte hier ein
Test gestanden, der genau den Fehler durchlässt, gegen den er geschrieben wurde.

## Realistische Fixtures

Backend-Formate nachbilden, nicht schönen: `image`-Strings mit `?pathhash=`-Suffix,
`image="None"` (String, truthy) für bildlose Playlists, Trackhash-Listen mit Orphans. Ein Test
mit geschöntem `hash.webp` hat einen echten Bug übersehen.
