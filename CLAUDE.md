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

# Tests (schnell; minimale deps, heavy deps werden in den Tests gemockt)
# Lokal möglich (uv liegt unter ~/.local/bin/uv.exe, ggf. vollen Pfad nutzen).
uvx --with xxhash --with unidecode --with pendulum --with requests --with pytest-cov \
  pytest tests/ -v --cov --cov-report=term-missing --cov-fail-under=10

# Type checking (nur strikte Module)
uvx --with xxhash --with unidecode --with pendulum mypy src/swingmusic/utils/hashing.py src/swingmusic/utils/dates.py src/swingmusic/utils/parsers.py src/swingmusic/utils/__init__.py --config-file pyproject.toml
```

## Branch-Workflow

Pro Aufgabe/Issue:
- **Worktree + Feature-Branch** (`fix/...`, `feat/...`) von `origin/master` — NICHT direkt auf `master`.
- **PR** öffnen → **Self-Review** (`/code-review`), Findings fixen, erneut prüfen.
- **Autonom (squash) mergen, sobald Review sauber:** `gh pr merge --repo vwellenberg/AivinNet --squash --delete-branch --auto` — `--auto` merged automatisch, sobald die Required Checks grün sind (kein manuelles Warten). Kein Review-Zwang.
- **CI gatet jetzt:** Branch Protection auf `master` erzwingt die Status-Checks `Lint & Format` / `Unit Tests` (`strict:false`, kein Review-Zwang, `enforce_admins:false`). Ein direkter `--squash`-Merge vor grünem CI scheitert — deshalb `--auto` nutzen.
- Danach **Deploy** (`cd ~/AivinNet && git pull && uv sync && systemctl restart aivinnet`) + verifizieren, Worktree entfernen.
- Kein `dev`-Branch. (Policy-Memory: `feedback-workflow-pr-worktree`.)

## Code-Qualität

- **Ruff:** Linting + Formatting, konfiguriert in `pyproject.toml`
- **mypy:** Graduelle Einführung — aktuell strict für `utils/hashing.py`, `utils/dates.py`, `utils/parsers.py`, `utils/__init__.py`. Neue Module bei Bearbeitung zur strict-Liste hinzufügen.
- **Pre-commit Hooks:** ruff check --fix, ruff format, mypy (strikte Module)
- **CI:** GitHub Actions bei Push auf `dev`/`master` und bei PRs auf `master` — Lint, Format, Mypy, Tests (mit Coverage-Floor). Jobs: `Lint & Format`, `Unit Tests`.
- **Vendored Code:** `src/swingmusic/lib/pydub/` ist Third-Party, von Linting/Mypy ausgeschlossen

## Architektur-Hinweise

- `src/swingmusic/lib/pydub/` — vendored pydub, nicht anfassen
- `bjoern` (WSGI-Server) braucht `libev-dev` + `python3-dev` zum Bauen — fehlt in vielen Umgebungen, daher CI-Tests mit `uvx` (minimale deps) statt `uv run`/voller Installation
- **Tests mocken schwere Dependencies** via `sys.modules` (siehe `test_album_model.py`, `test_sortlib.py`), damit sie ohne vollen Backend-Stack laufen. Falls je Tests gegen das echte Backend nötig sind (z.B. Track-Tag-Editing, das echte Dateien schreibt): in eigenes Verzeichnis legen und in getrenntem CI-Job mit `uv sync` fahren — das `sys.modules`-Mocking würde sonst beim gemeinsamen Collecten die echten Libs vergiften.

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
