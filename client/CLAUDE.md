# SubspaceRadio-Client (AivinNet)

Vue.js 3 Webclient für AivinNet — Fork von [swingmx/swingmusic](https://github.com/swingmx/swingmusic).

## Projekt-Setup

⚠️ **Der lokale Ordner heißt noch `SubspaceRadio-Client`, alles andere heißt `AivinNet`.**
Repo, Server-Checkout und systemd-Unit wurden umbenannt — wer die alten Namen tippt, greift ins Leere.

| | |
|---|---|
| **Repo** | `vwellenberg/AivinNet-Client` (Fork von [swingmx/webclient](https://github.com/swingmx/webclient)) |
| **Backend-Repo** | `vwellenberg/AivinNet` |
| **Stack** | Vue 3, Pinia, TypeScript, SCSS, Vite 3, yarn |
| **Server** | Homeserver im LAN, Port 1970, systemd-Unit **`aivinnet`** — Host, Account und Key stehen in der globalen `~/.claude/CLAUDE.md` (nicht im Repo) |
| **Checkout auf dem Server** | `~/AivinNet-Client`, gebaut nach `~/.config/aivinnet/client/` |

⚠️ **`gh` ohne `--repo` landet im Upstream** (`swingmx/webclient`) — bei `gh issue create` und
`gh pr create` immer `--repo vwellenberg/AivinNet-Client` setzen.

## Entwicklung

```powershell
# Dependencies installieren
yarn install

# Dev-Server starten
yarn dev

# Lint (auto-fix)
yarn lint

# Lint (nur prüfen, kein fix — für CI)
yarn lint:check

# Tests
yarn test
yarn test:watch

# Build
yarn build
```

## Branch-Workflow (verbindlich — keine Ausnahmen)

**Strikte Pflicht:** Jede Code-/Doc-Änderung läuft über **eigenen Worktree + dedizierten Branch + PR**. **Niemals direkt auf `master` committen oder pushen** — auch nicht für „nur eine Kleinigkeit".

Pro Aufgabe/Issue:
1. **Worktree + dedizierter Branch** von `origin/master`:
   `git worktree add -b <prefix>/<slug> ../_wt-<slug> origin/master`
   - **Immer ein frischer Branch pro Aufgabe** — nie auf `master`, nie auf einem fremden/alten Branch weiterarbeiten.
   - **Branch-Name mit geläufigem Prefix** (Conventional-Commits-Stil):
     - `feat/` — neues Feature / sichtbare Funktion
     - `fix/` — Bugfix / Korrektur
     - `refactor/` — Umbau ohne Verhaltensänderung
     - `style/` — reines CSS/Formatting ohne Logikänderung
     - `docs/` — nur Doku (README, CLAUDE.md, Kommentare)
     - `chore/` — Tooling / Deps / Config / Version-Bump
     - `test/` — nur Tests · `perf/` — Performance
   - Slug knapp + sprechend, optional Issue-Nr.: `fix/34-drawer-glow`, `feat/track-edit`.
2. **Implementieren** im Worktree (nie im Hauptverzeichnis auf `master`).
   - **Tests gehören in denselben PR (Pflicht):** Bugfix ⇒ **Regressionstest**, der den Bug reproduziert (vor dem Fix rot, danach grün) — kein Bugfix-PR ohne Test. Neue Store-/Util-/Request-Logik ⇒ Vitest in `src/**/__tests__/`. Realistische Fixtures verwenden (Backend-Formate wie `image`-Strings mit `?pathhash=`-Suffix, `image="None"` etc.). Reines CSS/Markup ist die Ausnahme — dort ersetzt die headless Screenshot-Verifikation (Schritt 6) den Test; Submit-/FormData-/Fetch-Logik ist NICHT „nur Markup".
3. **Self-Review — VOR dem PR, nicht danach.** `/code-review` auf den Arbeits-Diff laufen
   lassen, Findings fixen, erneut prüfen, bis nichts Größeres mehr kommt. **Erst dann** den PR
   öffnen.
   - Die Reihenfolge ist der Punkt. Stand hier lange „PR öffnen → Self-Review", und dabei
     entfällt das Review in der Praxis: Sobald der PR offen ist und die CI grün läuft, sieht das
     Paket fertig aus, und der nächste Griff ist `gh pr merge`. In einer Sitzung mit **fünf**
     PRs (#382, #385, #393, #404, #421) wurde so kein einziges Review gefahren — aufgefallen ist
     es erst, als der Nutzer nachfragte.
   - **Grün ist kein Review.** Lint, Typecheck, Tests und Build sagen „es baut und bricht nichts
     Bekanntes". Sie sagen nichts über die Dinge, die hier tatsächlich schiefgehen: eine Regel,
     die an einer zweiten Stelle nochmal ausgeschrieben wird, ein Zustand ohne Gegenstück im
     Dark-Theme, ein Touch-Ziel unter 44 px, eine Kachel, die aus der geteilten Anatomie fällt.
   - **Steht `/code-review` gerade nicht zur Verfügung, ersetzt es der eigene Diff — vollständig
     gelesen**, `git diff origin/master...HEAD` von oben bis unten, nicht nur die Stellen, die
     man im Kopf hat. Das ist die Untergrenze, keine gleichwertige Alternative: im PR-Text
     vermerken, dass das Review nicht lief.
4. **CI grün abwarten** (Lint/Tests/Build).
5. **Autonom (squash) mergen**, sobald Review (Schritt 3) sauber und CI grün: `gh pr merge --repo vwellenberg/AivinNet-Client --squash --delete-branch --auto` — `--auto` merged automatisch, sobald die Required Checks grün sind. Keine Rückfrage beim Nutzer nötig — „kein Review-Zwang" heißt dabei nur, dass **GitHub** keinen Fremd-Reviewer verlangt; das Self-Review aus Schritt 3 ist trotzdem Pflicht.
6. **Deploy von `master`** + verifizieren (bei UI: Headless-Screenshot), dann **Worktree entfernen** (`git worktree remove`) + lokalen Branch löschen — und am Rundenende **einmal die Leichen wegkehren** (siehe *Branch-Hygiene* unten).
7. **Issue-Abgleich — Pflicht, nicht Kür.** Nach **jeder** Implementierung prüfen, ob es dazu ein Issue gibt (`gh issue list --repo vwellenberg/AivinNet-Client --state open`), und es schließen **mit einem Kommentar, der die Lösung beschreibt** — was geändert wurde, in welchem PR, womit belegt.
   - Das gilt auch für Arbeit, die **nebenbei** ein Issue erledigt: Features lösen regelmäßig fremde Issues mit, ohne dass jemand die Verbindung zieht. Real passiert: die Album-Hash-Migration aus #255 hat den halben Punkt B von #31 miterledigt, und die Ordner-Arbeit aus #83 die halbe Akzeptanzliste von #94 — beide Issues standen danach monatelang offen und sahen unangetastet aus.
   - **Nie den Issue-Text als Status wiedergeben.** Er ist hier regelmäßig Monate hinter dem Code. Vor jeder Aussage über ein Issue die genannten Dateien, Funktionen und Endpunkte im Code nachschlagen (real passiert: #2 und #97 wurden als „offen" zusammengefasst, obwohl Backend und Frontend fertig waren).
   - Teilweise erledigt ⇒ nicht schließen, sondern kommentieren, welche Punkte stehen und welche nicht — mit Dateiverweis als Beleg.
   - **Englisches Schließwort** im PR-Text (`Fixes #N` / `Closes #N`); das deutsche „Behebt #N" schließt nichts.

⚠️ **`--auto` setzen heißt: das Paket ist FERTIG.** Der Merge feuert, sobald die Required Checks
des **aktuellen** Standes grün sind — das sind je nach Auslastung 40 Sekunden. Wer danach noch
etwas nachbessert und pusht, pusht auf einen Branch, dessen PR bereits zu ist: der Commit ist auf
GitHub, aber **nicht in `master`**, und nichts meldet das. In einer Sitzung zweimal passiert
(#388 → Nachzügler #394, #397 → #398), beide Male erst beim Gegenlesen von `origin/master`
aufgefallen. Also entweder erst am Ende `--auto` setzen, oder ohne `--auto` mergen und die Checks
abwarten. Und nach jedem Merge einmal prüfen, dass die eigene Änderung wirklich drin ist:

```bash
git fetch && git show origin/master:<datei> | grep -c "<neues token>"
```

- Kein `dev`-Branch (Branches gehen direkt von `master` aus).
- **`master` ändert sich laufend = normal und gewollt:** jeder gemergte PR bewegt `master`. Das ist KEIN Zeichen für Direkt-Commits, sondern der vorgesehene Fluss (Worktree → Branch → PR → Merge).

### Branch-Hygiene — `--delete-branch` räumt nur die HÄLFTE

Am 2026-08-07 lagen **183 tote Branches** herum (Client 139, Backend 51 — nach dem Kehren 3 bzw. 2).
Das war keine Schlamperei, sondern drei Mechanismen, von denen nur einer Disziplin ist:

- **`gh pr merge --delete-branch` löscht das REMOTE, nicht die lokale Branch.** Die überlebt den
  Merge; sie zu löschen ist ein zweiter, separater Handgriff — und der fällt aus, sobald die Runde
  sich fertig anfühlt.
- **Fremde Merges hinterlassen Leichen bei DIR.** Mergt eine andere Sitzung, wird die Branch in
  *deinem* Klon zur Leiche, ohne dass du irgendetwas falsch gemacht hättest. Dagegen hilft keine
  eigene Disziplin — nur ein Sweep.
- **`git fetch --prune` räumt ausschließlich die Remote-Tracking-Refs.** Es löscht `origin/foo`,
  nie `foo`. Prunen *erzeugt* also die `[gone]`-Markierung und handelt nie danach — es fühlt sich
  wie Aufräumen an und ist keins.

**Also am Rundenende kehren, nicht nur beim eigenen Merge:**

```bash
git fetch --prune
git branch -vv | grep ': gone]' | awk '{print $1}'      # ERST ansehen
git branch -vv | grep ': gone]' | awk '{print $1}' | xargs -r git branch -D
```

⚠️ **`[gone]` ist KEIN Beleg für einen Merge** — und `git branch -D` fragt nicht nach. Ein PR, der
**ohne** Merge geschlossen wurde, hinterlässt dieselbe Markierung, und dann ist die lokale Branch
die einzige verbliebene Kopie. In diesem Repo trifft das 3 von 388 PRs — selten genug, um es zu
vergessen, oft genug, um Arbeit zu verlieren. Vor einem Massenlauf deshalb einmal gegenprüfen:

```bash
gh pr list --repo vwellenberg/AivinNet-Client --state closed --limit 1000 \
  --json headRefName,mergedAt --jq '.[]|select(.mergedAt==null)|.headRefName'
```

Was dort auftaucht, wird **nicht** gelöscht. `git branch -d` (klein) taugt als Schutz übrigens
nicht: Bei Squash-Merges kennt Git die Branch nicht als „merged" und verweigert **jede**.

Und: `--delete-branch` beim Merge ist trotzdem Pflicht — es ist das, was die lokale Branch
überhaupt erst als `[gone]` erkennbar macht. Ohne das bleibt sie mit lebendem Remote stehen und
fällt durch jeden Sweep (so entstanden 76 der 183).

### Mehrere Agents parallel

**Das ist der Normalzustand, kein Zwischenfall.** An diesem Repo arbeiten regelmäßig mehrere
Sitzungen gleichzeitig. `master` wandert deshalb während der eigenen Arbeit, fremde PR-Nummern
tauchen auf, und Dateien, die man gerade gelesen hat, sehen zehn Minuten später anders aus.
Nichts davon ist ein Zeichen für Direkt-Commits oder einen kaputten Stand — der Fluss
(Worktree → Branch → PR → Merge) ist genau dafür gebaut. Also nicht stutzen, sondern
nachziehen.

- **Vor jedem Worktree UND vor jedem Merge `git fetch` + `origin/master`-Stand prüfen.** Bei `BEHIND`: `git rebase origin/master`, Konflikte lösen (häufig die `package.json`-Version → auf nächste freie Patch-Version ziehen).
- **Footprint klein halten**, Branch klar benennen, zügig mergen (kurzes offenes Fenster = weniger Konflikte).
- **Gleiche Dateien nicht gleichzeitig** anfassen (v.a. Theming wie `lauflicht.scss`, geteilte Komponenten/Mixins) — sonst Merge-Konflikte und sich überschreibende Design-Entscheidungen. Bei absehbarer Überlappung Bereiche/Lanes informell abgrenzen.
- **⚠️ Die laufende App bewegt sich mit.** Eine Messreihe gilt für genau einen Commit: deployt
  eine andere Sitzung mittendrin, trifft der nächste Screenshot einen anderen Stand — ohne
  Fehlermeldung, ohne dass irgendetwas kaputt aussieht. Den Stand von **Checkout und deploytem
  Build** deshalb vor *und* nach der Reihe festhalten und bei Abweichung neu messen. Real
  passiert: #370 zeichnete das Favoriten-Icon zwischen zwei Läufen neu — die erste Aufnahme
  zeigte den weißen Haken des alten Assets, die zweite den ink-Haken des neuen, und aufgefallen
  ist es nur, weil das ausgelieferte SVG nicht mehr zum Quellbaum passte.
- **Ein Befund altert zwischen Messen und Melden.** Vor dem Absenden die genannten Dateien noch
  einmal gegen `origin/master` lesen: Was man gefunden hat, kann längst behoben sein (real: die
  `scale(0.75)`-Kompensation in `HeartSvg.vue` war mit #370 weg, während sie im Entwurf noch als
  offener Punkt stand).

## CI

GitHub Actions laufen (Lint/Tests/Build) und **gaten den Merge** — Branch Protection auf `master` erzwingt diese drei Checks als Required (`strict:false`, kein Review-Zwang, `enforce_admins:false`). Das eigentliche Qualitäts-Gate ist aber das Self-Review aus Schritt 3, und es läuft **vor** dem
PR — die CI kann nur prüfen, was sich automatisch prüfen lässt:
- **Lint** — ESLint (`yarn lint:check`)
- **Tests** — Vitest (`yarn test`)
- **Build** — Vite Build (`yarn build`)

Tests liegen in `src/**/__tests__/` als `*.test.ts`.

## Brand

```scss
$brand-red:    #FF284E;   // BCS-Rot
$brand-green:  #1D9E75;   // WAVENET-Grün
$brand-purple: #7F77DD;   // Frequenz
```

Definiert in `src/assets/scss/_variables.scss`. `$red` zeigt auf `$brand-red`.

## Dokumentation & Learnings (verbindlich)

**Jede Session, die etwas Nicht-Offensichtliches herausfindet, schreibt es auf.** Ein Learning,
das nur im Chat steht, ist beim nächsten Kontextfenster weg.

Wohin — nach Umfang und Lesehäufigkeit:

| Was | Wohin | Wann es geladen wird |
|---|---|---|
| Falle oder Konvention, die **überall** gilt; Befehl, den man ständig braucht | **diese `CLAUDE.md`** | in *jeder* Session |
| Falle oder Konvention, die nur **einen Bereich** betrifft | **`.claude/rules/<thema>.md`** mit `paths:`-Frontmatter | nur wenn eine passende Datei gelesen wird |
| Etwas, das **zwingend** passieren muss und sonst echten Schaden anrichtet | **`.claude/settings.json`** als Hook | deterministisch beim Event — sparsam einsetzen, siehe unten |
| Bauplan, Store-Landkarte, Datenfluss | **[docs/architecture.md](docs/architecture.md)**, hier nur ein Zeiger | nur auf Anforderung |
| Präferenz des Users, repo-übergreifende Policy | Memory (`~/.claude/projects/…/memory/`) | gehört nicht ins geteilte Repo |
| Offene Arbeit, Bug, Idee | GitHub-Issue (`gh issue list --repo vwellenberg/AivinNet-Client`) | einzige Backlog-Quelle, auch für Backend-Themen |

Bestehende Bereichsregeln: `styling` · `stores-and-state` · `device-sync` · `testing`
(Übersicht mit Geltungsbereich unter *Architektur-Hinweise*). Neue Regel = neue Datei in
`.claude/rules/` mit `paths:`-Glob im Frontmatter; **ohne `paths` lädt sie unbedingt** und ist
damit nur CLAUDE.md unter anderem Namen.

**Hooks: bewusst keine.** Ein eslint-Hook und ein Branch-Guard waren kurz da und sind wieder
raus — der eslint-Hook lief auf dem Windows-Arbeitsrechner mangels node ohnehin nie, und der
Guard hat mehr behindert als geschützt. Lint und Format gaten schon in der CI; die Worktree-Regel
oben wurde nie gebrochen. Wenn hier je wieder einer entsteht: er greift nur, wenn Claude Code
**in diesem Verzeichnis** gestartet wurde (Projekt-Settings kommen aus dem Arbeitsverzeichnis,
nicht aus Unterordnern).

Regeln dazu:

- **Verweisen, nicht importieren.** Zusatzdokumente als normalen Markdown-Link einbinden. Ein
  `@pfad`-Import würde die Datei bei **jedem** Sessionstart vollständig in den Kontext laden und
  damit den Zweck der Auslagerung aufheben. Nur `paths`-gescopte Rules laden wirklich bedarfsweise.
- **Diese Datei soll kurz bleiben** (Richtwert ~200 Zeilen). Wächst ein Abschnitt zur Abhandlung:
  betrifft er einen abgrenzbaren Pfad → Rule; ist er reine Beschreibung → `docs/`. Hier bleibt ein
  Zweizeiler mit Zeiger. Was bleibt: Fallen, Begründungen, Konventionen. Was geht:
  Verzeichnisbäume, Komponentenlisten, Abläufe, Historie.
- **Am Ende der Aufgabe, nicht „irgendwann":** Doku-Änderung gehört in denselben PR wie die
  Änderung, die sie beschreibt.
- **Ein Learning wird als Ursache formuliert, nicht als Symptom** — dazu, woran man es erkennt
  und was stattdessen zu tun ist. Vorbilder stehen unten unter „Learnings / Gotchas".
- **Visuelle Befunde brauchen eine Messung, keinen Eindruck** (Computed Styles, Pixel, Content-Hash).
  Was gemessen wurde, gehört mit in die Notiz — sonst ist sie beim nächsten Zweifel wertlos.
- **⚠️ Namen gegen die Wirklichkeit prüfen, bevor man sie aufschreibt.** Diese Datei behauptete
  über Monate die Repo-URLs `vwellenberg/SubspaceRadio*` — die Repos heißen seit der Umbenennung
  `AivinNet*`, nur der lokale Ordner trägt noch den alten Namen. Wer Servicenamen, Pfade oder
  Repo-URLs dokumentiert, verifiziert sie einmal gegen `git remote -v` bzw. den Server.

## Architektur

**Bauplan, Schichten und Zustandsfluss: [docs/architecture.md](docs/architecture.md).**
Kurzfassung: Vue 3 + Pinia + Vite, **Hash-Routing** (Deeplinks brauchen `#`), Wiedergabe in
`stores/player.ts` mit **zwei** `<audio>`-Elementen, Seitendaten pro Route in `stores/pages/*`
(geladen im Router-`beforeEnter`, nicht im `onMounted`), API-Pfade zentral in `config.ts::paths`.

**Zwei Konsequenzen, die man dauernd braucht:**
- **Im Gruppenmodus wird jede Transport-/Queue-Aktion abgefangen** (`ds.joined` → `ds.intercept()`).
  Wer eine neue Queue-Mutation baut, muss durch denselben Seam — sonst stille Desync.
- **Aussehen gehört in eine Rolle** (`Global/_buttons.scss`), nicht in die Komponente.

## Architektur-Hinweise

- **Wiederkehrendes UI-Element? → geteilte Komponente oder Rolle, nicht pro View kopieren.**
  **Verhalten + Markup** gehören in `src/components/shared/` (`PinButton.vue`, `HeartSvg.vue` =
  der Favoriten-Toggle, `PlayBtnRect.vue`); **Aussehen** in eine der fünf Rollen in
  [Global/_buttons.scss](src/assets/scss/Global/_buttons.scss). Konvention aus #90.
- **Eine geteilte Komponente nimmt ihre Rolle SELBST** — sie von außen zu patchen ist genau die
  Drift, die #90 einsammelt. `HeartSvg.vue` trug seine Maße lange von Hand, also wiederholten
  Album- und Artist-Header wortgleich denselben Patch. Jetzt hat die Komponente eine Prop
  `btn_role` (`quiet` = blanker Glyph, `action` = Header-Platte), und die Korrektur liegt dort, wo
  die Kollision entsteht. Neue Varianten also als **Rollen-Prop an der Komponente**, nicht als
  Regel in der aufrufenden View.
- `SearchInput :on_nav="true"` in `NavBar.vue` beibehalten — nie durch Router-Link ersetzen.
- **Das Logo ist bewusst rahmenlos** (`Logo.vue`): der Pixelplanet steht ohne Kachel, seine Kante
  ist eine harte 2-px-`drop-shadow`-Kontur in `$mem-line`, der Ring (`.logo-orbit`) erscheint nur
  beim Hover. Wer ihm wieder eine Fläche gibt, holt sich das Problem aus #318 zurück: Ink als
  *Fläche* ist sonst nirgends in der App, und im Dark-Theme liegt sie auf der Panel-Farbe
  (#17171A auf #141416) — die Kachel verschwindet, nur der Rahmen bleibt.
- **Vitest 0.x, nicht 1.x** — Vite-3-Kompatibilität.

Die bereichsgebundenen Regeln stehen in `.claude/rules/` und laden sich selbst, sobald eine
passende Datei gelesen wird:

| Rule | greift bei | Inhalt |
|---|---|---|
| `styling.md` | `src/assets/scss/**`, `src/**/*.scss`, `src/**/*.vue`, `vite.config.ts` | **Schraffur-Policy** (was sie bedeutet, wo sie wegbleibt, nie hinter Text), Zeilen-Platten, Hover-Token, Rollen, Hard-Shadows, Icon-/viewBox-Fallen, 44-px-Touch-Ziele, Regler-Geometrie, Sass-Interpolation, Bewegung |
| `stores-and-state.md` | `src/stores/**`, `src/utils/playlistMove.ts`, `src/utils/shufflePicker.ts`, `src/requests/**` | Playlist-Schreibpfade, optimistische Rollbacks, Zufall-im-Getter, virtualisierte Queue |
| `device-sync.md` | `src/stores/devicesync.ts`, `src/utils/deviceSync/**`, `src/components/DeviceSync/**`, `src/components/modals/Devices.vue`, `src/views/PairView.vue` | Seams, Timing, Auto-Rejoin, Feld-Bugs |
| `testing.md` | `src/**/__tests__/**`, `vite.config.ts` | Vitest-0.34-Fallen, Fixtures |

⚠️ **Die „greift bei"-Spalte ist keine Prosa, sondern das `paths:`-Frontmatter der jeweiligen
Datei — wortgleich.** Beides von Hand zu pflegen hat nicht funktioniert: Die Spalte nannte für
`device-sync.md` drei von fünf Globs, und `testing.md` gatete auf `vitest.config.*`, das es hier
nie gab (die Testkonfiguration steckt im `test:`-Block von `vite.config.ts`) — die Regel lud also
ausgerechnet beim Schrauben an der Konfiguration nicht, und **auffallen konnte das niemandem**:
Ein Glob ins Leere wirft keinen Fehler, er sorgt nur dafür, dass die Datei stumm bleibt.

Seitdem hält `src/components/__tests__/contextDocs.test.ts` drei Dinge fest: Jede Rule ist
gescopet, jeder Glob trifft mindestens eine existierende Datei, und diese Tabelle stimmt mit dem
Frontmatter überein. Wer einen Glob ergänzt, ergänzt ihn hier — sonst wird die Suite rot.

## Server deployen

### Frontend (dieser Client)

```bash
# Host, Account und Key stehen in der globalen ~/.claude/CLAUDE.md (nicht im Repo).
# Lokaler Ordner heisst noch SubspaceRadio-Client, auf Server + GitHub aber
# AivinNet-Client; systemd-Service heisst aivinnet.
ssh -i <key> <account>@<homeserver> "bash ~/deploy-client.sh"
```

⚠️ **Es gibt ZWEI Skripte mit diesem Namen, und nur eines holt den neuen Code.**
`~/deploy-client.sh` ist der Wrapper: `git checkout master` + `git pull --ff-only`, dann
`exec bash scripts/deploy-client.sh`. Die versionierte Datei
[scripts/deploy-client.sh](scripts/deploy-client.sh) **pullt nicht** — sie baut den Checkout, wie
er gerade dasteht, und meldet trotzdem `DEPLOYED`. Wer sie direkt aufruft, baut den alten Stand
neu und bekommt eine Erfolgsmeldung dafür (zweimal in einer Sitzung passiert; die Beschriftungen
aus #359 lagen danach weiter im alten Wortlaut im Bundle).

**Deshalb gehört zum Deploy immer die Gegenprobe an den ausgelieferten Bytes** — nicht an der
Meldung:

```bash
cd ~/AivinNet-Client && git log --oneline -1          # enthält der Checkout den Commit?
grep -oh "<neuer Text>" ~/.config/aivinnet/client/assets/*.js | sort -u
```

**Zweite Falle:** direkt nach einem Merge kann der Pull den Stand **davor** ziehen — GitHub
braucht einen Moment, bis der neue `master` überall sichtbar ist. Auch das fällt nur über die
Gegenprobe oben auf; dann einfach nochmal deployen.

**Wichtig:** Server hat IPv6-Problem — git/yarn brauchen `NODE_OPTIONS='--dns-result-order=ipv4first'`. Nach jedem sichtbaren Deploy `package.json` version bumpen (angezeigt unter **Settings → About**, zusammen mit der Server-Version — der Sticker unten in der Sidebar ist weg).

### Backend

Liegt auf dem Server unter `~/AivinNet` und läuft über **denselben** systemd-Dienst `aivinnet`
(Port 1970 — er serviert auch das gebaute Frontend aus `~/.config/aivinnet/client`). Ein
Frontend-Deploy startet also dasselbe Backend neu. Der Deploy-Befehl und die Gotchas dazu
(`uv` nicht im PATH, Health-Check) stehen in der CLAUDE.md des Backend-Repos.

⚠️ Backend-PRs gehen an `--repo vwellenberg/AivinNet`, aber **Issues liegen in diesem
Client-Repo** → dort mit „For vwellenberg/AivinNet-Client#N" referenzieren, **kein** „Closes"
(sonst schließt GitHub das Issue im falschen Repo nicht).


## Learnings / Gotchas (für alle Agents)

- **⚠️ CODE-CURRENCY ZUERST PRÜFEN (vor jeder Analyse/Diagnose/Screenshot):** Immer verifizieren, dass auf dem **aktuellen** Code gearbeitet wird — an BEIDEN Stellen: (1) **Lokal**: `git fetch` + `git rev-list --left-right --count HEAD...origin/master`; bei Rückstand ff-syncen. (2) **Deployt/Live**: Server-Checkout-HEAD (`~/AivinNet-Client`) **und** deployter Build (`~/.config/aivinnet/client`) gegen `origin/master`. **Die Headless-Screenshot-Pipeline trifft die DEPLOYTE App** — die kann viele Commits hinterherhinken, auch wenn `master` aktuell ist (real passiert: Header an 6-Commits-alter App diagnostiziert, Pin noch rechts oben statt inline). Stale → erst syncen (lokal) bzw. aktuellen `master` deployen (mit User-OK), DANN diagnostizieren/screenshotten. Nie Mockups/Befunde von veraltetem Stand als „so ist es" präsentieren. **Und danach noch einmal prüfen** — hier deployen mehrere Sitzungen, der Stand kann sich mitten in einer Messreihe ändern (siehe *Mehrere Agents parallel*).
- **⚠️ SERVICE WORKER / STALE CACHE (ZUERST LESEN):** Wenn der User sagt „Fix sieht man nicht / UI noch alt", obwohl der Deploy nachweislich korrekt auf dem Server liegt → **fast immer ein Service Worker**, der alte vorgecachte Assets ausliefert. **Strg+Shift+R und „Cache löschen" umgehen einen Service Worker NICHT.** Symptom: Headless-Screenshot (kein SW) zeigt den Fix korrekt, aber der User-Browser nicht. Diagnose: `ls ~/.config/aivinnet/client | grep -iE 'sw|workbox'` + im sw.js auf alte `index.*.js`-Hashes prüfen. **Status quo: PWA/SW ist via `selfDestroying: true` in [vite.config.ts](vite.config.ts) abgeschaltet** — nicht ohne triftigen Grund reaktivieren. Falls ein User noch einen alten SW stecken hat: Chrome DevTools (F12) → Application → Storage → „Clear site data" → Tab neu laden (das entfernt den SW; ein normaler Reload reicht nicht). Dieses Problem trat mehrfach auf — bitte SOFORT daran denken, bevor man stundenlang am CSS sucht.
- **UI-Änderungen selbst ansehen, nicht behaupten.** Auf dem Server liegt unter `~/uitest` eine
  fertige Playwright-Kiste (Chromium **und** Firefox): Screenshots pro Route × Theme × Gerät,
  Computed-Style-Audits, Regler-Vermessung, E2E für Queue und Group-Sync. **Vor dem Bauen eines
  neuen Skripts dort nachsehen** — die meisten Fragen sind schon einmal gemessen worden.
  Befehle, JWT-Prägung und die Fallen beim Messen: **[docs/verification.md](docs/verification.md)**.
- **⚠️ Gemessen wird nur an einem Baum, der einem selbst gehört.** `~/preview` wird von mehreren
  Sitzungen benutzt — eine andere kann es mitten im Lauf auf ihren Branch zurücksetzen und neu
  bauen, und dann misst man deren Code (real passiert: erste Messung gelb, zweite gegen dasselbe
  `dist` wieder teal). Eigenen Checkout anlegen und danach **am gebauten Artefakt** prüfen, dass
  die eigene Änderung wirklich drin ist. Rezept: [docs/verification.md](docs/verification.md).
- **⚠️ Reine Refactors gegen den Content-Hash beweisen.** Vite benennt Assets nach ihrem Inhalt — wenn `dist/assets/index.<hash>.css` auf Branch und master **denselben** Namen trägt, ist das gebaute CSS byte-identisch und eine Rendering-Änderung ausgeschlossen, nicht bloß unwahrscheinlich. Vorgehen: beide Seiten mit `rm -rf dist` sauber bauen, Dateinamen vergleichen, mit `cmp` gegenprüfen. Genau dieser Vergleich hat einen Sass-Interpolationsfehler gefunden, den drei grüne Gates durchgelassen hatten.
- **⚠️ Ein selbst geprägtes JWT braucht `sub` als Dict, nicht als JSON-String.** Sonst: HTTP 500
  auf jedem Endpoint, während die App-Shell weiter rendert — Chrome und Nav sind da, aber null
  Playlists und null Alben. Sieht nach kaputtem UI aus, ist ein kaputtes Token. Details und der
  Gegencheck stehen in [docs/verification.md](docs/verification.md).
- **⚠️ „Die letzte Stelle" ist ein Messergebnis, kein Satz.** Derselbe Zeilen-Hover wurde in vier
  Runden repariert (#217 Ordner-Liste + Songliste, #246 Playlist-Zeile, #256 Nav-Zeilen, #346
  Sidebar-Ordner-Kopf). Zwei dieser Commit-Texte behaupteten wörtlich, sie erwischten „die eine"
  bzw. „die letzte" hoverbare Liste ohne Rahmen — aufgezählt hatte die Menge niemand, und #246
  ließ den nächsten Fall **80 Zeilen tiefer in derselben Datei** stehen. Was dabei durchrutscht,
  ist immer die **halb** konforme Instanz: der Ordner-Kopf trug die Basis-Hälfte (reservierter
  transparenter Rand) längst, war also weder über den Marker der Vorrunde (`border: none`) noch
  beim Lesen zu finden, und sichtbar wird er nur mit angelegtem Ordner **unter dem Mauszeiger**.
  Wer eine Anatomie angleicht, zählt die Instanzen deshalb vorher über das **gemeinsame Merkmal**
  auf — nicht über die kaputte Schreibweise —, schreibt die Liste in den PR und übergibt die
  Vollständigkeit einem Zensus-Test (`rowHover`, `cardAnatomy`, `headerActionOrder`).

## Nächste Schritte

Offene Arbeit als GitHub Issues: `gh issue list --repo vwellenberg/AivinNet-Client`.

## Device Sync / Multiroom

Geräte desselben Accounts spielen synchron, jedes kann steuern, Volume und Mute bleiben pro Gerät.
Der Server ist die Quelle der Wahrheit; Transport-Befehle werden **geplant** statt sofort
ausgeführt, damit sie überall gleichzeitig wirken.

**⚠️ Die eine Regel, die überall gilt:** Sobald ein Gerät beigetreten ist, muss **jede**
Transport- und Queue-Aktion durch den Seam — `if (ds.joined && !ds.applying) { ds.intercept(…) }`.
Die lokale Liste zu splicen ändert die Server-`queue_id` nicht, also re-mirrort niemand, und der
gespiegelte `currentindex` zeigt danach auf den falschen Track (stille Desync).

Client-Architektur, Timing-Stellschrauben, Auto-Rejoin und die Feld-Bugs aus v1.3.0/v1.5.0:
`.claude/rules/device-sync.md`.
