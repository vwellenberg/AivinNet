# SubspaceRadio

Fork von [swingmx/swingmusic](https://github.com/swingmx/swingmusic) — ein selbst-gehosteter Musikplayer/Streaming-Server (Flask + SQLAlchemy Backend, separater Vue.js Webclient).

## Projekt-Setup

⚠️ **Der lokale Ordner heißt noch `SubspaceRadio`, alles andere heißt `AivinNet`.** Repo, Server-Checkout
und systemd-Unit wurden umbenannt — wer die alten Namen tippt, bekommt „Unit not found" bzw. „No such file".

⚠️ **Alles heißt seit 2026-08-07 `aivinnet`** (vorher `swingmusic`): Distribution, Modul
(`src/aivinnet/`), Konsolenbefehl, Wheel (`aivinnet-<version>-py3-none-any.whl`), Config-Ordner
(`~/.config/aivinnet/`) und Datenbank (`aivinnet.db`). Nur die `swingmx/swingmusic`-URLs bleiben
— Upstream-Attribution, von der AGPL-3.0 verlangt.

**Der Config-Ordner wandert beim Start** (`legacy_paths.py`, aufgerufen aus `Paths.__init__`,
**bevor** irgendetwas `config_dir` liest oder anlegt). Zwei Eigenschaften machen das sicher, und
beide sind wichtiger als die Umbenennung selbst:

- **Nie überschreiben:** verschoben wird nur, wenn das Ziel *nicht* existiert.
- **Ein Fehlschlag ist folgenlos:** die Pfad-Properties **lösen auf** statt anzunehmen (neuer
  Name bevorzugt, sonst der alte, bei Neuinstallation der neue). Scheitert das Umbenennen an
  Rechten oder einem Lock, findet die App ihre Bibliothek trotzdem — verifiziert an einer Kopie
  der echten 126-MB-Installation.

⚠️ **Die Datenbank sind DREI Dateien.** SQLite im WAL-Modus hält `-wal` und `-shm` daneben, und
die sind nur mit einem gleichnamigen `.db` gültig (die Live-Installation hatte eine **10,9 MB**
große WAL). Sie wandern als Satz, **Sidecars zuerst, die DB zuletzt**, und ein Fehler rollt die
Sidecars zurück — umgekehrt bliebe eine DB ohne das WAL zurück, das ihre jüngsten Transaktionen
hält.

Wer hier weiterarbeitet, muss **`swingmusic.db` (Datei) von `aivinnet.db` (Modul)
unterscheiden** — genau daran ist der erste Anlauf gescheitert: eine Schutzregel für den
Dateinamen ließ ~100 `from swingmusic.db …`-Importe stehen, und die schnelle Testbahn **mockt
dieses Modul weg**, also blieben alle 589 Tests grün, während die App beim Start gecrasht wäre.
Sicherheitsnetz dagegen: `tests/test_internal_imports_resolve.py`.

| | |
|---|---|
| **Repo** | `vwellenberg/AivinNet` (Fork von [swingmx/swingmusic](https://github.com/swingmx/swingmusic)) |
| **Client-Repo** | `vwellenberg/AivinNet-Client` — dort liegen auch **alle Issues**, auch die Backend-Themen |
| **Python / Paketmanager** | >=3.11, **uv** (nicht pip) |
| **Standard-Port** | 1970, systemd-Unit **`aivinnet`** (nicht `subspaceradio`) |
| **Eigenes Deployment** | Pfade, Zugang und Server-Eigenheiten: `MAINTAINER.local.md` (gitignored) |

## Entwicklung

```bash
# Dependencies installieren
uv sync

# Linting
uvx ruff check src/ tests/
uvx ruff format src/ tests/

# Unit-Tests (schnelle Lane; läuft lokal, uv liegt unter ~/.local/bin/uv.exe)
uvx --with xxhash --with unidecode --with pendulum --with requests \
  --with 'mutagen<2' --with 'tinytag<3' --with pytest-cov \
  pytest tests/ -v --cov --cov-report=term-missing --cov-fail-under=10

# Type checking (nur die strikten Module)
uvx --with xxhash --with unidecode --with pendulum mypy src/aivinnet/utils/hashing.py src/aivinnet/utils/dates.py src/aivinnet/utils/parsers.py src/aivinnet/utils/__init__.py --config-file pyproject.toml
```

⚠️ **Die API-Tests (`tests_api/`) laufen auf Windows nicht** — bjoern braucht libev. Sie gehören
auf den Server. Der Befehl dafür und die Test-Konventionen (was in welchen PR gehört, die
`sys.modules`-Mock-Falle) stehen in `.claude/rules/tests.md` — lädt automatisch, sobald eine
Testdatei gelesen wird.

## Branch-Workflow

Pro Aufgabe/Issue:
- **Worktree + Feature-Branch** (`fix/...`, `feat/...`) von `origin/master` — NICHT direkt auf `master`.
- **Tests gehören in denselben PR (Pflicht):**
  - **Bugfix ⇒ Regressionstest**, der den Bug reproduziert (vor dem Fix rot, danach grün). Kein Bugfix-PR ohne Test.
  - **Neue/geänderte Endpoints oder Request-Modelle ⇒ `tests_api/`-Abdeckung** des echten Request-Zyklus (multipart-Optionalität und flask_openapi3-File-Mapping brechen NUR dort sichtbar — zweimal live passiert: #36→#167/#39).
  - Neue Lib-Logik ⇒ Unit-Test in `tests/` (fast lane).
  - Realistische Fixtures verwenden — z. B. trägt `Album.image` den `?pathhash=`-Suffix; ein Test mit geschöntem `hash.webp` hat #34 übersehen.
- **Self-Review — VOR dem PR, nicht danach.** `/code-review` auf den Arbeits-Diff laufen lassen, Findings fixen, erneut prüfen — erst dann den PR öffnen. Die Reihenfolge ist der Punkt: Steht der Schritt hinter „PR öffnen", entfällt er in der Praxis (sobald der PR offen ist und die CI grün läuft, sieht das Paket fertig aus — so sind im Client 5 PRs ohne Review durchgerutscht). **Grüne CI ist kein Review.** Fallback ohne `/code-review`: den eigenen Diff `git diff origin/master...HEAD` vollständig lesen und im PR-Text vermerken, dass das Tool-Review nicht lief.
- **PR** öffnen.
- **Autonom (squash) mergen, sobald Review sauber:** `gh pr merge --repo vwellenberg/AivinNet --squash --delete-branch --auto` — `--auto` merged automatisch, sobald die Required Checks grün sind (kein manuelles Warten). Kein Review-Zwang.
- **CI gatet jetzt:** Branch Protection auf `master` erzwingt die Status-Checks `Lint & Format` / `Unit Tests` (`strict:false`, kein Review-Zwang, `enforce_admins:false`). Ein direkter `--squash`-Merge vor grünem CI scheitert — deshalb `--auto` nutzen.
- Danach **deployen und verifizieren** (Befehl: `MAINTAINER.local.md`), Worktree entfernen — und am Rundenende **einmal die Leichen wegkehren** (siehe unten).
- Kein `dev`-Branch. (Policy-Memory: `feedback-workflow-pr-worktree`.)

### Branch-Hygiene — `--delete-branch` räumt nur die HÄLFTE

Am 2026-08-07 lagen **183 tote Branches** herum (hier 51, im Client 139 — nach dem Kehren 2 bzw. 3).
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

```bash
git fetch --prune
git branch -vv | grep ': gone]' | awk '{print $1}'      # ERST ansehen
git branch -vv | grep ': gone]' | awk '{print $1}' | xargs -r git branch -D
```

⚠️ **`[gone]` ist KEIN Beleg für einen Merge** — und `git branch -D` fragt nicht nach. Ein PR, der
**ohne** Merge geschlossen wurde, hinterlässt dieselbe Markierung, und dann ist die lokale Branch
die einzige verbliebene Kopie. (Dieses Repo hatte davon keinen, der Client 3 von 388 — selten
genug, um es zu vergessen, oft genug, um Arbeit zu verlieren.) Vor einem Massenlauf gegenprüfen:

```bash
gh pr list --repo vwellenberg/AivinNet --state closed --limit 1000 \
  --json headRefName,mergedAt --jq '.[]|select(.mergedAt==null)|.headRefName'
```

Was dort auftaucht, wird **nicht** gelöscht. `git branch -d` (klein) taugt als Schutz nicht: Bei
Squash-Merges kennt Git die Branch nicht als „merged" und verweigert **jede**.

Und: `--delete-branch` beim Merge bleibt Pflicht — es ist das, was die lokale Branch überhaupt
erst als `[gone]` erkennbar macht. Ohne das steht sie mit lebendem Remote da und fällt durch jeden
Sweep (so entstanden 76 der 183).

## Code-Qualität

- **Ruff:** Linting + Formatting, konfiguriert in `pyproject.toml`
- **mypy:** Graduelle Einführung — aktuell strict für `utils/hashing.py`, `utils/dates.py`, `utils/parsers.py`, `utils/__init__.py`. Neue Module bei Bearbeitung zur strict-Liste hinzufügen.
- **Pre-commit Hooks:** ruff check --fix, ruff format, mypy (strikte Module)
- **CI:** GitHub Actions bei Push auf `dev`/`master` und bei PRs auf `master` — Lint, Format, Mypy, Tests (mit Coverage-Floor). Jobs: `Lint & Format`, `Unit Tests`, `API Tests` (voller Stack via `uv sync` + libev, Verzeichnis `tests_api/`).
- **Vendored Code:** `src/aivinnet/lib/pydub/` ist Third-Party, von Linting/Mypy ausgeschlossen

## Dokumentation & Learnings (verbindlich)

**Jede Session, die etwas Nicht-Offensichtliches herausfindet, schreibt es auf.** Ein Learning,
das nur im Chat steht, ist beim nächsten Kontextfenster weg.

Wohin — nach Umfang und Lesehäufigkeit:

| Was | Wohin | Wann es geladen wird |
|---|---|---|
| Falle oder Konvention, die **überall** gilt; Befehl, den man ständig braucht | **diese `CLAUDE.md`** | in *jeder* Session |
| Falle oder Konvention, die nur **einen Bereich** betrifft | **`.claude/rules/<thema>.md`** mit `paths:`-Frontmatter | nur wenn eine passende Datei gelesen wird |
| Etwas, das **zwingend** passieren muss und sonst echten Schaden anrichtet | **`.claude/settings.json`** als Hook | deterministisch beim Event — sparsam einsetzen, siehe unten |
| Bauplan, Modul-Landkarte, Datenfluss | **[docs/architecture.md](docs/architecture.md)**, hier nur ein Zeiger | nur auf Anforderung |
| Präferenz des Users, repo-übergreifende Policy | Memory (`~/.claude/projects/…/memory/`) | gehört nicht ins geteilte Repo |
| Offene Arbeit, Bug, Idee | GitHub-Issue im **Client**-Repo | einzige Backlog-Quelle, siehe unten |

Bestehende Bereichsregeln: `api-endpoints` · `database` · `device-sync` · `packaging-release` ·
`playlist-writes` · `recommendations` · `tests` · `track-tags`. Neue Regel = neue Datei in `.claude/rules/` mit
`paths:`-Glob im Frontmatter; ohne `paths` lädt sie unbedingt und ist damit nur CLAUDE.md unter
anderem Namen.

**Aktiver Hook** (`.claude/settings.json`, mit `/hooks` einsehbar): Nach jedem Write/Edit an einer
`.py` läuft `ruff check --fix` + `ruff format` auf genau dieser Datei (`--force-exclude`, damit
das vendorte pydub ausgenommen bleibt). Das ist alles — ein Branch-Guard war kurzzeitig da und
wurde wieder entfernt: Er hat mehr behindert als geschützt, und die Worktree-Regel unten wurde
ohnehin nie gebrochen.

⚠️ Hooks greifen nur, wenn Claude Code **in diesem Verzeichnis** gestartet wurde — Projekt-Settings
kommen aus dem Arbeitsverzeichnis, nicht aus Unterordnern.

⚠️ **`ruff check --fix` löscht einen Import, dessen Verwender noch nicht existiert.** Wer erst den
Import setzt und den `@decorator` im nächsten Edit, bekommt den Import zwischendurch entfernt und
steht am Ende mit einem `NameError` beim Modul-Import da — den kein Lint anzeigt, weil die Datei
danach wieder sauber ist. Also **Import und erste Verwendung in einem Edit** (oder Verwendung
zuerst). Aufgefallen ist es erst, als die Testsuite gegen den kopierten Baum lief.

Regeln dazu:

- **Verweisen, nicht importieren.** Zusatzdokumente als normalen Markdown-Link einbinden. Ein
  `@pfad`-Import würde die Datei bei **jedem** Sessionstart vollständig in den Kontext laden und
  damit den Zweck der Auslagerung aufheben. Nur `paths`-gescopte Rules laden wirklich bedarfsweise.
- **Diese Datei soll kurz bleiben** (Richtwert ~200 Zeilen). Wächst ein Abschnitt zur Abhandlung:
  betrifft er einen abgrenzbaren Pfad → Rule; ist er reine Beschreibung → `docs/`. Hier bleibt ein
  Zweizeiler mit Zeiger. Was bleibt: Fallen, Begründungen, Konventionen. Was geht:
  Verzeichnisbäume, Modulübersichten, Abläufe, Historie.
- **Am Ende der Aufgabe, nicht „irgendwann":** Doku-Änderung gehört in denselben PR wie die
  Änderung, die sie beschreibt.
- **Ein Learning wird als Ursache formuliert, nicht als Symptom** — dazu, woran man es erkennt
  und was stattdessen zu tun ist. Vorbilder stehen unten in der Fallen-Liste.
- **⚠️ Namen gegen die Wirklichkeit prüfen, bevor man sie aufschreibt.** Diese Datei behauptete
  über Monate einen systemd-Dienst und Pfade, die es nach der Paket-Umbenennung gar nicht mehr
  gab — und niemandem fiel es auf, weil eine Anleitung plausibel aussieht, solange sie niemand
  ausführt. Wer Servicenamen, Pfade oder Repo-URLs dokumentiert, verifiziert sie einmal am
  laufenden System.

## Architektur

**Bauplan, Schichten und Datenfluss: [docs/architecture.md](docs/architecture.md).** Kurzfassung:
Ein Flask-Prozess serviert API *und* Client; die komplette Bibliothek wird beim Start aus SQLite
in RAM-Stores (`store/*.py`) geladen und von dort gelesen; Alben und Artists sind **abgeleitet**,
nicht gespeichert; der WSGI-Server bjoern ist evented und single-threaded.

**Zwei Konsequenzen, die man dauernd braucht:**

1. **DB-Schreiben ohne Store-Update ist bis zum Neustart ein No-op.** Store nachziehen oder
   `lib/index.py::index_everything()` auslösen.
2. **⚠️ Der Server verarbeitet genau EINEN Request gleichzeitig — nichts Blockierendes im
   Request-Pfad.** Auf Linux läuft die App unter **bjoern**, einem evented, single-threaded
   WSGI-Server (`pyproject.toml`: bjoern auf allem außer win32, waitress nur unter Windows;
   nachgeprüft am 2026-07-31 im laufenden Prozess). Es gibt keinen Thread-Pool, der einen
   hängenden Handler auffängt: **ein blockierender Aufruf hält die gesamte App an, auch `/`.**
   Daraus folgt konkret:
   - Ausgehendes HTTP nur mit IPv4-Präferenz **und** harter Deadline (siehe IPv6-Punkt unten).
   - Häufig gepollte Endpoints RAM-only halten — kein DB-Write, kein Datei-I/O
     (Vorbild: `/devicesync/poll`, 1 s pro Gerät).
   - **Keine langlebigen Verbindungen** (WebSocket, SSE). Ein Push-Kanal müsste als eigener
     Prozess neben der App laufen.
   - Langlaufendes gehört in einen Thread (`utils/threading.py::background`) oder Prozess-Pool,
     nie in den Handler.

## Architektur-Hinweise

- **⚠️ PLAYLIST-SCHREIBPFADE: nie „ganze Liste ersetzen", nie auf Client-Indizes verlassen.**
  Der Client kennt die gespeicherte Trackhash-Liste nicht (er lädt nur eine Seite und sieht
  Orphan-Hashes gar nicht) — daraus kamen **zwei echte Datenverlust-Bugs**. Neue Mutationen
  anker-basiert oder positions-explizit bauen, die Listen-Chirurgie macht der Server.
  Volle Begründung, Muster und Sicherheitsnetz: `.claude/rules/playlist-writes.md`
  (lädt automatisch, sobald eine Playlist-Datei gelesen wird).
- **⚠️ Auf Anschlüssen ohne funktionierendes IPv6 (DS-Lite o. ä.) hängt ausgehendes HTTP —
  auch in Python.** Das ist kein Sonderfall eines einzelnen Hosts, sondern der Grund, warum
  `prefer_ipv4()` existiert; wer es entfernt, bricht genau dort. Outbound-`requests`
  hängen minutenlang, weil urllib3 alle aufgelösten Adressen (AAAA zuerst) sequenziell mit
  vollem Connect-Timeout probiert; `timeout=` deckt das **nicht** ab. Zusammen mit dem
  single-threaded Server friert dabei die ganze App ein. `utils/net.py::prefer_ipv4()` läuft
  global in `app_builder.config_app`; neue Outbound-Calls zusätzlich mit harter Deadline um
  Futures absichern (`lib/coverart.py::search_covers`) und Pools mit `shutdown(wait=False)`
  schließen.
- **⚠️ TRACKHASH HÄNGT AN DEN TAGS, NICHT AN DER DATEI** (`create_hash(title, album, *artists)`):
  ein Formatwechsel ändert **keinen** Hash, eine Tag-Korrektur **jeden** betroffenen — Playlists,
  Favoriten und Scrobbles zeigen danach ins Leere und müssen mitgezogen werden. Zweite Falle: die
  Hashes **in der Datenbank** stammen teils noch aus der SHA1-Ära, der laufende Server rechnet
  xxh3 — Hashes immer aus der API holen, nie aus `swingmusic.db`. Ableitungsregeln,
  Platzhalter-Fallstricke, MusicBrainz-Abgleich, Indexer-Blindstellen: `.claude/rules/track-tags.md`.
- `src/aivinnet/lib/pydub/` — vendored pydub, nicht anfassen.

Bereichsregeln laden sich selbst, sobald eine passende Datei gelesen wird:
`.claude/rules/api-endpoints.md` · `database.md` · `playlist-writes.md` · `track-tags.md` ·
`tests.md`.

## Auslieferung an Dritte (Release + Installer)

Freunde installieren per **AppImage** (`install.sh` im Repo-Root), gebaut vom Workflow `Release`
(`.github/workflows/build.yml`, `workflow_dispatch`). Vorher `.github/changelog.md` anpassen —
das ist der Release-Body.

⚠️ Dort lauern mehrere Fallen, die schon zugeschlagen haben — zuletzt der AppDir-Name, an dem
beide AppImage-Jobs des ersten Release-Versuchs starben. Details:
`.claude/rules/packaging-release.md` (lädt beim Anfassen von `install.sh`, `appimage/**`, den
Workflows oder `settings.py`).

## Empfehlungen / Mixes

Alle Personalisierung kommt aus der **lokalen Hörhistorie** (`ScrobbleTable`, pro User) plus der
eigenen Bibliothek. Einzige externe Quelle ist `smcloud.mungaist.com`, und zwar nur für
Artist-Mixe — dorthin gehen Track-Metadaten (Titel, Artist, Album) im **Klartext**. Das
Last.fm-Plugin ist reiner Scrobble-Export, keine Empfehlungsquelle.

**Zweite externe Quelle (seit 2026-08-06): der Lyrics-Finder.** Das Plugin `lyrics_finder`
(Musixmatch, inoffizielle Desktop-API) ist **ab Werk aktiv** inklusive `auto_download` — beim
Öffnen der Lyrics-Seite ohne lokale Lyrics gehen **Titel + Artist im Klartext** an
`apic-desktop.musixmatch.com`; gefundene Lyrics werden als `.lrc` neben die Audiodatei
geschrieben. Abschaltbar in den Settings; ein Opt-out überlebt Neustarts (Marker-Mechanik in
`plugins/register.py`). Sonst verlässt nichts das Haus.

Vollständige Pipeline, Qualitäts-Gates und Cron-Takte: `.claude/rules/recommendations.md`.

## Server-Deployment

⚠️ **Steht nicht mehr hier: `MAINTAINER.local.md` im Repo-Root** (per `*.local.md`
gitignored, liegt also nur lokal).

Dieses Repo ist **öffentlich**. Die Deploy-Anleitung beschrieb ausschließlich den Server des
Autors — sudoers-Regeln, dessen DS-Lite-IPv6-Problem, dessen Pfade. Für jemanden, der am Code
mitarbeitet, ist das nutzlos, und für die Nachbarschaft ist es eine Landkarte. Alles über *diese*
Maschine gehört in die lokale Datei, nie in `README.md` oder hierher.

Host, Account und Key stehen weiterhin in der globalen `~/.claude/CLAUDE.md` — ein Zuhause für
Zugangsdaten, nicht zwei.

Der **Client** wird aus seinem eigenen Repo deployt und vom selben Dienst serviert; die
Anleitung steht in der CLAUDE.md des Clients.

## Nächste Schritte

Der Backlog lebt **ausschließlich** in den GitHub-Issues — und zwar im **Client**-Repo, auch für
Backend-Themen: `gh issue list --repo vwellenberg/AivinNet-Client`. Keine zweite Liste im Repo anlegen;
die frühere `ROADMAP.md` ist genau daran gescheitert (sie führte „Manuelle Metadaten-Bearbeitung" noch als
offen, während das Feature längst live war).

## Device Sync / Multiroom (Group Sessions)

Geräte desselben Users spielen synchron, jedes kann steuern. **Der Server ist die Quelle der
Wahrheit und hält alles im RAM** (`lib/groupsession.py` = pure Logik, `api/devicesync.py` = HTTP);
persistent ist nur die Geräte-Registry. Transport-Befehle werden **geplant** statt sofort
ausgeführt (`execute_at = now + 1500 ms`), damit sie überall gleichzeitig wirken.

Mechanik, Timing-Konstanten und die vier Feld-Bugs aus v1.3.0: `.claude/rules/device-sync.md`.
