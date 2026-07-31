# SubspaceRadio

Fork von [swingmx/swingmusic](https://github.com/swingmx/swingmusic) — ein selbst-gehosteter Musikplayer/Streaming-Server (Flask + SQLAlchemy Backend, separater Vue.js Webclient).

## Projekt-Setup

⚠️ **Der lokale Ordner heißt noch `SubspaceRadio`, alles andere heißt `AivinNet`.** Repo, Server-Checkout
und systemd-Unit wurden umbenannt — wer die alten Namen tippt, bekommt „Unit not found" bzw. „No such file".

| | |
|---|---|
| **Repo** | `vwellenberg/AivinNet` (Fork von [swingmx/swingmusic](https://github.com/swingmx/swingmusic)) |
| **Client-Repo** | `vwellenberg/AivinNet-Client` — dort liegen auch **alle Issues**, auch die Backend-Themen |
| **Python / Paketmanager** | >=3.11, **uv** (nicht pip) |
| **Server** | `192.168.0.4`, Port 1970, systemd-Unit **`aivinnet`** (nicht `subspaceradio`) |
| **SSH** | `ssh -i /c/Users/vwell/.ssh/id_ed25519 vwellenberg@192.168.0.4` |
| **Backend auf dem Server** | `~/AivinNet` |
| **Client auf dem Server** | `~/AivinNet-Client`, gebaut nach `~/.config/swingmusic/client/` |

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
uvx --with xxhash --with unidecode --with pendulum mypy src/swingmusic/utils/hashing.py src/swingmusic/utils/dates.py src/swingmusic/utils/parsers.py src/swingmusic/utils/__init__.py --config-file pyproject.toml
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
- **PR** öffnen → **Self-Review** (`/code-review`), Findings fixen, erneut prüfen.
- **Autonom (squash) mergen, sobald Review sauber:** `gh pr merge --repo vwellenberg/AivinNet --squash --delete-branch --auto` — `--auto` merged automatisch, sobald die Required Checks grün sind (kein manuelles Warten). Kein Review-Zwang.
- **CI gatet jetzt:** Branch Protection auf `master` erzwingt die Status-Checks `Lint & Format` / `Unit Tests` (`strict:false`, kein Review-Zwang, `enforce_admins:false`). Ein direkter `--squash`-Merge vor grünem CI scheitert — deshalb `--auto` nutzen.
- Danach **Deploy** (`cd ~/AivinNet && git pull && uv sync && systemctl restart aivinnet`) + verifizieren, Worktree entfernen.
- Kein `dev`-Branch. (Policy-Memory: `feedback-workflow-pr-worktree`.)

## Code-Qualität

- **Ruff:** Linting + Formatting, konfiguriert in `pyproject.toml`
- **mypy:** Graduelle Einführung — aktuell strict für `utils/hashing.py`, `utils/dates.py`, `utils/parsers.py`, `utils/__init__.py`. Neue Module bei Bearbeitung zur strict-Liste hinzufügen.
- **Pre-commit Hooks:** ruff check --fix, ruff format, mypy (strikte Module)
- **CI:** GitHub Actions bei Push auf `dev`/`master` und bei PRs auf `master` — Lint, Format, Mypy, Tests (mit Coverage-Floor). Jobs: `Lint & Format`, `Unit Tests`, `API Tests` (voller Stack via `uv sync` + libev, Verzeichnis `tests_api/`).
- **Vendored Code:** `src/swingmusic/lib/pydub/` ist Third-Party, von Linting/Mypy ausgeschlossen

## Dokumentation & Learnings (verbindlich)

**Jede Session, die etwas Nicht-Offensichtliches herausfindet, schreibt es auf.** Ein Learning,
das nur im Chat steht, ist beim nächsten Kontextfenster weg.

Wohin — nach Umfang und Lesehäufigkeit:

| Was | Wohin | Wann es geladen wird |
|---|---|---|
| Falle oder Konvention, die **überall** gilt; Befehl, den man ständig braucht | **diese `CLAUDE.md`** | in *jeder* Session |
| Falle oder Konvention, die nur **einen Bereich** betrifft | **`.claude/rules/<thema>.md`** mit `paths:`-Frontmatter | nur wenn eine passende Datei gelesen wird |
| Bauplan, Modul-Landkarte, Datenfluss | **[docs/architecture.md](docs/architecture.md)**, hier nur ein Zeiger | nur auf Anforderung |
| Präferenz des Users, repo-übergreifende Policy | Memory (`~/.claude/projects/…/memory/`) | gehört nicht ins geteilte Repo |
| Offene Arbeit, Bug, Idee | GitHub-Issue im **Client**-Repo | einzige Backlog-Quelle, siehe unten |

Bestehende Bereichsregeln: `api-endpoints` · `database` · `device-sync` · `packaging-release` ·
`playlist-writes` · `recommendations` · `tests`. Neue Regel = neue Datei in `.claude/rules/` mit
`paths:`-Glob im Frontmatter; ohne `paths` lädt sie unbedingt und ist damit nur CLAUDE.md unter
anderem Namen.

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
  über Monate den systemd-Dienst `subspaceradio` und die Pfade `~/SubspaceRadio*` — beides
  existiert nicht (korrekt: `aivinnet`, `~/AivinNet*`). Wer Servicenamen, Pfade oder Repo-URLs
  dokumentiert, verifiziert sie einmal auf dem Server.

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
- **⚠️ IPv6 des Servers ist kaputt (DS-Lite) — gilt auch für Python.** Outbound-`requests`
  hängen minutenlang, weil urllib3 alle aufgelösten Adressen (AAAA zuerst) sequenziell mit
  vollem Connect-Timeout probiert; `timeout=` deckt das **nicht** ab. Zusammen mit dem
  single-threaded Server friert dabei die ganze App ein. `utils/net.py::prefer_ipv4()` läuft
  global in `app_builder.config_app`; neue Outbound-Calls zusätzlich mit harter Deadline um
  Futures absichern (`lib/coverart.py::search_covers`) und Pools mit `shutdown(wait=False)`
  schließen.
- `src/swingmusic/lib/pydub/` — vendored pydub, nicht anfassen.

Bereichsregeln laden sich selbst, sobald eine passende Datei gelesen wird:
`.claude/rules/api-endpoints.md` · `database.md` · `playlist-writes.md` · `tests.md`.

## Auslieferung an Dritte (Release + Installer)

Freunde installieren per **AppImage** (`install.sh` im Repo-Root), gebaut vom Workflow `Release`
(`.github/workflows/build.yml`, `workflow_dispatch`). Vorher `.github/changelog.md` anpassen —
das ist der Release-Body.

⚠️ Dort lauern mehrere Fallen, die schon zugeschlagen haben — allen voran, dass ein
`pip install swingmusic` das **Upstream**-Paket von PyPI ziehen und damit still deren Backend
mit unserem Client ausliefern kann. Details: `.claude/rules/packaging-release.md` (lädt beim
Anfassen von `install.sh`, `appimage/**`, den Workflows oder `settings.py`).

## Empfehlungen / Mixes

Alle Personalisierung kommt aus der **lokalen Hörhistorie** (`ScrobbleTable`, pro User) plus der
eigenen Bibliothek. Einzige externe Quelle ist `smcloud.mungaist.com`, und zwar nur für
Artist-Mixe — dorthin gehen Track-Metadaten (Titel, Artist, Album) im **Klartext**. Sonst
verlässt nichts das Haus. Das Last.fm-Plugin ist reiner Scrobble-Export, keine Empfehlungsquelle.

Vollständige Pipeline, Qualitäts-Gates und Cron-Takte: `.claude/rules/recommendations.md`.

## Server-Deployment

```bash
# Backend deployen (eine Sitzung, vom Arbeitsrechner aus):
ssh -i /c/Users/vwell/.ssh/id_ed25519 vwellenberg@192.168.0.4 \
  "cd ~/AivinNet && NODE_OPTIONS='--dns-result-order=ipv4first' git pull -q && \
   ~/.local/bin/uv sync && sudo -n systemctl restart aivinnet && \
   sleep 4 && systemctl is-active aivinnet"

# Status + Logs (kein sudo nötig):
systemctl status aivinnet
journalctl -u aivinnet -f      # erfolgreicher Start endet mit „Loading tracks/albums/artists... Done!"

# Speicher beobachten:
ps aux | grep swingmusic | grep -v grep | awk '{print $6/1024"MB"}'
```

- Passwortloses sudo gilt für `systemctl restart/stop/start aivinnet` — **ohne** `.service`,
  sonst greift die sudoers-Regel nicht.
- **`uv` liegt nicht im PATH der nicht-interaktiven SSH-Shell** → vollen Pfad `~/.local/bin/uv`.
- Der Server hat ein **IPv6-Problem** (DS-Lite): git/yarn brauchen
  `NODE_OPTIONS='--dns-result-order=ipv4first'`, Python deckt `utils/net.py::prefer_ipv4()` ab.

Der **Client** wird aus seinem eigenen Repo deployt (`~/AivinNet-Client`, `scripts/deploy-client.sh`),
serviert aber derselbe Dienst — die Anleitung steht in der CLAUDE.md des Clients.

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
