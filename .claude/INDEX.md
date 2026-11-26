# Index: Regeln und Doku

**Immer geladen** (per `@`-Import aus `CLAUDE.md`). Pro Datei: wann sie lädt und die
Regeln, die man kennen muss, **bevor** man in dem Bereich etwas anfasst. Das Detail steht
in der Datei. Gliederung holen: `grep -n '^## ' <datei>`, dann den Abschnitt lesen.

⚠️ **Bereichsregeln laden nicht zuverlässig von selbst.** Ihr `paths:`-Frontmatter greift, wenn
eine passende Datei mit dem **Read-Werkzeug** gelesen wird. `cat`, `sed` und `grep` per Bash lösen
nichts aus (2026-11-22: Quick play wurde komplett per Bash gelesen, `client/.claude/rules/styling.md` lud nie, und die
markierte Zeile bekam Schraffur hinter den Text). Deshalb: vor der Arbeit in einem Bereich die
Zeile hier lesen und die Regel-Datei gezielt öffnen.

Wächter: `tests/test_context_index.py`. Jede Datei unter `.claude/rules/`, `client/.claude/rules/`,
`docs/` und `client/docs/` muss hier stehen, und jeder Pfad hier muss existieren.

## Backend-Regeln (`.claude/rules/`)

- **`.claude/rules/api-endpoints.md`** (`src/aivinnet/api/**`): Ein Request gleichzeitig
  (bjoern), nichts Blockierendes im Handler. Server transkodiert nicht. Erst prüfen, dann
  mutieren. `basis / name_vom_client` ist keine Eingrenzung (Pfad-Ausbruch). flask_openapi3 4.x
  und leere Formulare. 500 ohne Traceback: Handler direkt aufrufen. `serverId` verlässt den
  Server nie.
- **`.claude/rules/database.md`** (`db/`, `migrations/`, `setup/`): Store und DB sind
  zwei Wahrheiten. Was zusammen stimmen muss, in EINE Transaktion. Schema-Änderungen erreichen
  bestehende DBs nur per Migration. SQL-`localtime` ≠ pendulum. `userid`-Filter nicht vergessen.
  SQLite vergibt die höchste ID neu. `get_all` liefert Generatoren.
- **`.claude/rules/device-sync.md`** (`groupsession.py`, `api/devicesync.py`): Server
  hält alles im RAM, Befehle geplant (`execute_at = now + 1500 ms`), Polling statt Push. Die
  behobenen Feld-Bugs nicht zurückbauen.
- **`.claude/rules/packaging-release.md`** (`install.sh`, `appimage/**`, Workflows, `Dockerfile`,
  `settings.py`): AppImage- und Docker-Fallen, Datenordner hängt vom Installationsweg ab,
  Docker bündelt den Client, Release per `scripts/release.sh`, vor `rc` das Delta reviewen.
- **`.claude/rules/playlist-writes.md`** (Playlist-/Favoriten-API und -Lib): Nie „ganze
  Liste ersetzen", nie Client-Indizes vertrauen, anker- oder positions-explizit. `added_at` ist
  eine Parallel-Map mit Trackhash-Keys.
- **`.claude/rules/recommendations.md`** (`plugins/`, `lib/home/`, `crons/`): Home-Zeilen
  und ihre Schwellen, Cron-Takte, Sender, Advent-Kalender, die vollständige Liste ausgehender
  Verbindungen. Externe Quellen nur zum Anreichern.
- **`.claude/rules/tests.md`** (`tests/**`, `tests_api/**`): `sys.modules`-Mocks nur
  geguardet, sie vergiften die Session und verstecken DB-Bugs. CI läuft in UTC. Was in welchen PR
  gehört. Windows-Pfade (POSIX speichern). `e2e/`.
- **`.claude/rules/track-tags.md`** (Track-/Album-Modelle, Hashing, Tag-Lib): trackhash =
  Titel + Album + Interpreten, nicht die Datei. Server bereinigt Namen beim Laden. Ein Hash, mehrere
  Dateien. DB-Hashes teils SHA1-Ära, immer aus der API holen. `album_artist` geht in den
  albumhash ein. Was der Indexer überspringt.

## Client-Regeln (`client/.claude/rules/`, Pfade relativ zu `client/`)

- **`client/.claude/rules/styling.md`** (`*.vue`, `*.scss`; **die längste Regel im Repo**, nie ganz lesen, immer per Gliederung suchen):
  - Aussehen kommt aus einer **Rolle** (`btn-*`, `mem-row-plate`, `candy-raised` …), nie Rahmen +
    Fläche + Zeiger von Hand (Zensus `handDrawnPlates`).
  - **Schraffur heißt „drückbar" und läuft nie durch Text.** Inhaltsliste, in der jede Zeile
    drückbar ist ⇒ `$hatch: false` an **Platte, Hover und Aktiv** (Zensus `rowHover`). Wo sie
    bleibt, unter Text `mem-hatch-clear`.
  - Text auf dem Memphis-Grund braucht eine Platte (`--mem-veil`). `$red` ist Tinte, als
    Textfarbe im Dark-Theme unsichtbar. Dunkelmodus: Tönungen gehen mit runter.
  - Icons über `color`, nie `fill`. Touch-Ziele 44 px. Ein `<button>` als Grid-Container
    zentriert seine Spur (`grid-template-columns: minmax(0, 1fr)`).
  - `:hover` latcht auf Touch. App-Höhe nie aus `vh`. Scroller reservieren die Player-Bar, auch für den Fokus (`scroll-padding`, aus demselben Token).
    Daueranimationen müssen aufhören können.
- **`client/.claude/rules/stores-and-state.md`** (`src/stores/**`, Queue-/Playlist-Utils,
  `src/requests/**`): Nie die geladene Tracklist als ganze Liste senden. Optimistisch
  heißt Rollback. Kein Zufall im Getter. Shuffle merkt sich Indizes, jede Queue-Mutation zieht sie
  mit. Zustand pro Hash. Queue ist virtualisiert. `image="None"` ist truthy.
- **`client/.claude/rules/device-sync.md`** (`stores/devicesync.ts`, `utils/deviceSync/**`): Jede Transport-/Queue-Aktion durch den Seam (`ds.joined` → `ds.intercept`).
  Devices-Panel zeigt Server-Wahrheit. Timing gemessen, nicht geschätzt.
- **`client/.claude/rules/infinite-scroll.md`** (Fetcher, Paginierung, Such-Views):
  Nachladen auf Sichtbarkeit, nicht beim Mounten. `useAxios` lehnt nicht ab, sondern liefert
  `{ error, data: undefined }`.
- **`client/.claude/rules/testing.md`** (`src/**/__tests__/**`): `?raw` liefert bei
  `.scss` leer, also `readFileSync`. Ein Zensus über Bezeichner ist wertlos, jede Regel einmal
  rot stellen. `flushPromises` statt `nextTick`. Realistische Fixtures. Neue Request-Funktion ⇒
  Zeile im Vertrags-Test.

## Doku (nur auf Anforderung lesen)

- **`docs/architecture.md`**: Backend-Bauplan (Schichten, Stores, Datenfluss).
- **`client/docs/architecture.md`**: Client-Bauplan (Pinia, Router, Player mit zwei `<audio>`).
- **`client/docs/verification.md`**: UI selbst prüfen, headless (`~/uitest` auf dem Server,
  JWT prägen, Messfallen).
- **`docs/README.md`**, **`docs/docker.md`**, **`docs/privacy.md`**, **`docs/remote-access.md`**:
  Nutzer-Doku (Installation, Docker, Datenschutz, Zugriff von außen).
- **`scripts/systemd/README.md`**: Deploy bei jedem Merge (Timer, Retry, Rollback).
- **`android/README.md`**: Android-Auto-App bauen und sideloaden.
- **`mcp_server/README.md`**: MCP-Server für AivinNet.
- **`contributing/README.md`**: Projektstruktur für Mitwirkende.
- **`client/FEATURES.md`**: Was der Client gegenüber Upstream anders kann.
- `MAINTAINER.local.md` (gitignored, nur lokal): eigener Server, Pfade, Zugang.
