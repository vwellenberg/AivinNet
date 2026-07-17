# SubspaceRadio

Fork von [swingmx/swingmusic](https://github.com/swingmx/swingmusic) — ein selbst-gehosteter Musikplayer/Streaming-Server (Flask + SQLAlchemy Backend, separater Vue.js Webclient).

## Projekt-Setup

- **Repo:** https://github.com/vwellenberg/SubspaceRadio
- **Python:** >=3.11
- **Package Manager:** uv (nicht pip!)
- **Server:** 192.168.0.4, Port 1970, systemd Service `subspaceradio`
- **SSH:** `ssh vwellenberg@192.168.0.4` (ed25519 Key)
- **Webclient:** https://github.com/vwellenberg/SubspaceRadio-Client (Vue.js, yarn, vite)
- **Webclient lokal:** /tmp/SubspaceRadio-Client
- **Webclient auf Server:** ~/SubspaceRadio-Client, deployed nach ~/.config/swingmusic/client/

## Entwicklung

```bash
# Dependencies installieren
uv sync

# Linting
uvx ruff check src/ tests/
uvx ruff format src/ tests/

# Tests (schnell; schwere deps Flask/SQLAlchemy/Pillow werden in den Tests gemockt).
# mutagen + tinytag sind pure-Python und MÜSSEN dabei sein (Real-Bytes-Tag-Round-Trip);
# conftest importiert sie vorab, damit die Fallback-Mocks der Geschwister no-op'en.
# Lokal möglich (uv liegt unter ~/.local/bin/uv.exe, ggf. vollen Pfad nutzen).
uvx --with xxhash --with unidecode --with pendulum --with requests \
  --with 'mutagen<2' --with 'tinytag<3' --with pytest-cov \
  pytest tests/ -v --cov --cov-report=term-missing --cov-fail-under=10

# Type checking (nur strikte Module)
uvx --with xxhash --with unidecode --with pendulum mypy src/swingmusic/utils/hashing.py src/swingmusic/utils/dates.py src/swingmusic/utils/parsers.py src/swingmusic/utils/__init__.py --config-file pyproject.toml

# API-Tests (voller Stack, echter flask_openapi3-Request-Zyklus; eigener CI-Job).
# Lokal auf Windows NICHT lauffähig (bjoern braucht libev) — stattdessen auf dem
# Server gegen dessen venv laufen lassen:
#   scp -r tests_api vwellenberg@192.168.0.4:/tmp/ && \
#   ssh vwellenberg@192.168.0.4 'cd ~/AivinNet && ~/.local/bin/uv run --with pytest pytest /tmp/tests_api -v'
```

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

## Architektur-Hinweise

- **⚠️ IPv6 des Servers ist kaputt (DS-Lite) — gilt auch für Python!** Outbound-`requests` hängen minutenlang, weil urllib3 alle aufgelösten Adressen (AAAA zuerst) sequenziell mit vollem Connect-Timeout probiert; `timeout=` deckt das nicht. Und weil bjoern evented/single-threaded ist, friert dabei die GESAMTE App ein (auch `/`). Fix: `utils/net.py::prefer_ipv4()` wird in `app_builder.config_app` aufgerufen (Pendant zu `NODE_OPTIONS=--dns-result-order=ipv4first` für node). Neue Outbound-Calls zusätzlich mit harter Deadline um Futures absichern (siehe `lib/coverart.py::search_covers`, `FETCH_DEADLINE_SECONDS`) und Pools mit `shutdown(wait=False)` schließen.
- `src/swingmusic/lib/pydub/` — vendored pydub, nicht anfassen
- `bjoern` (WSGI-Server) braucht `libev-dev` + `python3-dev` zum Bauen — fehlt in vielen Umgebungen, daher CI-Tests mit `uvx` (minimale deps) statt `uv run`/voller Installation
- **Tests mocken schwere Dependencies** via `sys.modules`, damit sie ohne vollen Backend-Stack laufen. **WICHTIG — geguardete Form Pflicht:** immer `if name not in sys.modules: sys.modules[name] = MagicMock()` (bzw. `setdefault`), NIE unbedingtes `sys.modules[name] = MagicMock()`. Grund: `conftest.py` importiert die echten `mutagen`+`tinytag` vorab (wenn installiert); die geguardete Form no-op't dann und der Real-Bytes-Test `test_tag_writer_roundtrip.py` sieht die echten Libs. Ein unbedingtes Mock würde die echten Libs überschreiben und diesen Test brechen.
- **Real-Bytes-Tag-Test ko-loziert** in `tests/` (kein eigener Job): `mutagen`+`tinytag` sind pure-Python → laufen in der schnellen `uvx`-Lane mit (Versionen gepinnt: `mutagen<2`, `tinytag<3`, passend zum Prod-Major). Nur Tests, die den **vollen** Stack brauchen (Flask/SQLAlchemy → `uv sync`), bräuchten ein eigenes Verzeichnis + getrennten Job.

## Empfehlungen / Mixes (woher kommen die Vorschläge?)

Alle Personalisierung basiert auf der **lokalen Hörhistorie** (`ScrobbleTable`, pro User) plus der eigenen Bibliothek; einzige externe Quelle ist der **Swing-Music-Cloud-Server**. Ablauf:

- **Cron `mixes`** (`crons/mixes.py`, alle 12h): erst `ArtistMixes`, dann `BecauseYouListened` (nutzt die Artist-Mix-Ergebnisse).
- **Artist-Mixes** (`plugins/mixes.py` + `lib/recipes/artistmixes.py`): Meistgehörte Artists nach `playduration` aus vier Zeitfenstern (heute / 2 Tage / 7 Tage / Monat; max. 4/3/4/4 Mixe, unbelegte Slots wandern ins nächste Fenster). Pro Artist gehen die **Top-5-Tracks (Titel/Artists/Album als Klartext!)** per `POST {server}/radio` an `https://smcloud.mungaist.com`; der antwortet mit ähnlichen Track-**Weakhashes** + ähnlichen Alben/Artists. Gematcht wird ausschließlich gegen die **eigene Bibliothek** (bei Weakhash-Duplikaten gewinnt die höchste Bitrate), aufgefüllt aus lokalen Tracks der ähnlichen Alben/Artists (`fallback_create_artist_mix`), dann `balance_mix`. Qualitäts-Gates: min. 15 Tracks und min. 4 verschiedene Artists, sonst wird der Mix verworfen. `sourcehash` (Top-5-Hashes) dedupliziert gegen `MixTable`.
- **„Mixes for you"** = aus den Artist-Mixen abgeleitete Track-Mixe (`get_track_mix`); **„Because you listened …"/„Artists you might like"** speisen sich aus den im Mix-`extra` gespeicherten similar artists/albums der Cloud-Antwort.
- **Top artists week/month, Stats, Recently played** = reine lokale Scrobble-Aggregation (`utils/stats.py`, sortiert nach `playduration`); **Recently added** = Library-Timestamps. Kein Cloud-Anteil.
- **Last.fm-Plugin** (`plugins/lastfm.py`) ist NUR Scrobble-**Export** (optional), keine Empfehlungsquelle.
- **Privacy:** Für Mixes verlassen Track-Metadaten (Titel, Artist, Album) das Haus Richtung `smcloud.mungaist.com` — sonst nichts.

## Server-Deployment

```bash
# Auf dem Server (192.168.0.4):
cd ~/SubspaceRadio
git pull
sudo -n systemctl restart subspaceradio

# Status (kein sudo nötig):
systemctl status subspaceradio
journalctl -u subspaceradio -f

# Memory beobachten:
ps aux | grep swingmusic | grep -v grep | awk '{print $6/1024"MB"}'
```

Passwordless sudo ist konfiguriert für `systemctl restart/stop/start subspaceradio`.

### Webclient deployen

```bash
cd ~/SubspaceRadio-Client
git pull
NODE_OPTIONS='--dns-result-order=ipv4first' yarn install --network-timeout 120000
NODE_OPTIONS='--dns-result-order=ipv4first' yarn build
rm -rf ~/.config/swingmusic/client
cp -r dist ~/.config/swingmusic/client
sudo -n systemctl restart subspaceradio
```

**Wichtig:** Server hat IPv6-Problem — yarn/npm brauchen `NODE_OPTIONS='--dns-result-order=ipv4first'`.

## Was bisher gemacht wurde

### Backend (SubspaceRadio)
- Ruff Linting + Formatting (483 → 0 Issues)
- Pre-commit Hooks (ruff + mypy)
- CI Pipeline (GitHub Actions: Lint, Format, Mypy, Tests)
- 86 pytest Tests (Hashing, Parsers, Dates, Utils, Album-Model, Folder-Sorting)
- mypy strict für 4 Utils-Module
- Alphabetische Sortierung als Default für Ordner und Playlists
- Memory Leak Fixes (PIL Images, Watchdog, TransCodeStore, mutable default arg)
- Download-API: `/download/track/<hash>`, `/download/album/<hash>`, `/download/playlist/<id>` (ZIP)
  - Registriert in `app_builder.py` + `api/__init__.py`

### Frontend (SubspaceRadio-Client) — AivinNet Redesign
**Branding:**
- App-Name: "AivinNet" (Fork von Swing Music)
- Brand-Farben: `$brand-red: #FF284E`, `$brand-green: #1D9E75`, `$brand-purple: #7F77DD`
- Logo: Pixel-Art Planet (`logo-subspaceradio.png`) mit pulsierendem Ring-Animation (wächst/schwindet + fade)
- `$red` zeigt auf `$brand-red`

**Spotify-Redesign (laufend):**
- Ambient-Gradient: Album-Cover-Farbe fließt als Gradient über die gesamte Seite (AlbumView, ArtistView, PlaylistView)
- Track-Zeilen: Thumbnail + Titel + Künstler gestapelt, Play-Overlay bei Hover, kein Drag-Handle (ganzer Row draggbar)
- Herz-Icon ersetzt durch `+` (Plus) für nicht-favorisierte Tracks; Herz bleibt für favorisierte
- Favorit-Button erscheint rechts bei Hover, nicht links
- Cards (Album/Artist): größer (12rem), Play-Button grün unten rechts, Cover dimmt bei Hover
- PlayBtn: `$brand-green` Hintergrund
- Unten-Leiste: semi-transparent (backdrop-filter blur), Content scrollt dahinter
- Startseite: kein "Home"-Heading, "Zuletzt gehört" immer erste Sektion
- Suche: Suchleiste oben (Desktop), Search-Icon in mobiler Bottom-Bar
- Sidebar: Playlist-Bibliothek als Liste mit Thumbnails
- Download-Buttons: Track (Kontextmenü), Album (Kontextmenü), Playlist (Header-Button)

## Nächste Schritte

Siehe [ROADMAP.md](ROADMAP.md). Frontend-Änderungen laufen im Webclient-Fork (SubspaceRadio-Client).
