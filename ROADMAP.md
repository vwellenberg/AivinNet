# SubspaceRadio / AivinNet — Roadmap

Offene Features und geplante Verbesserungen (keine Phasen-Struktur, priorisierung nach Bedarf).

---

## Frontend / UI

- [ ] **Suche neu gestalten** — aktuell noch nicht zufriedenstellend (Layout, UX)
- [ ] **Sidebar Thumbnails verfeinern** — Playlist-Liste in der Sidebar weiter polieren
- [ ] **Home-Seite verbessern** — Sektionen, Layout, Content
- [ ] **Ordner-Kacheln lesbarer** — Namen werden abgeschnitten, Tiles besser gestalten
- [ ] **Ordner-Sortierung** — Sortier-Dropdown rechts oben soll auch für Ordner greifen (aktuell nur Songs)
- [ ] **Playlist: Listenansicht** — alternative Darstellung als kompakte Liste

## Backend / Daten

- [ ] **Manuelle Metadaten-Bearbeitung** — Modal/Seitenleiste mit editierbaren Feldern (Titel, Künstler, Album, Genre, Jahr); Backend schreibt Tags via `mutagen` direkt in die Audiodatei
- [ ] **Auto-Tag Button** — Album angeben → Metadaten automatisch von MusicBrainz holen und in Dateien schreiben
- [ ] **Album-Cover via MusicBrainz / Cover Art Archive** — fehlende Cover automatisch nachladen
- [ ] **Last.fm Plugin erweitern** — für fehlende Track-Infos und Scrobbling-Verbesserungen

## Tests / CI / DevOps

- [ ] **Tests für neue Frontend-Komponenten** — wo sinnvoll möglich
- [ ] **Auto-Deploy** — Self-hosted GitHub Actions Runner auf dem Server: Push → automatisch bauen + deployen
- [ ] **Coverage-Schwelle** — `pytest --cov`, Minimum 70% in CI
- [ ] **Frontend-Build-Check** — Vite-Build in SubspaceRadio-Client CI

---

## Erledigt

- [x] Alphabetische Sortierung als Default (Ordner + Playlists)
- [x] Drag & Drop in Playlists
- [x] Wiedergabestatistiken (Tracks, Alben, Künstler)
- [x] Memory Leaks gefixt (PIL, Watchdog, TransCodeStore, mutable default)
- [x] Download-API (`/download/track`, `/download/album`, `/download/playlist`)
- [x] Ruff Linting + Formatting, Pre-commit Hooks, CI Pipeline, 86 pytest Tests
- [x] AivinNet Branding (Farben, Logo, Pixel-Art Planet mit Puls-Animation)
- [x] Spotify-Redesign: Track-Zeilen (Thumbnail + gestapelt, Play-Overlay, DnD)
- [x] Spotify-Redesign: Cards (12rem, grüner Play-Button unten rechts, Hover-Dim)
- [x] Spotify-Redesign: Ambient-Gradient (Album/Artist/Playlist-View)
- [x] Spotify-Redesign: Bottom-Bar semi-transparent (backdrop-filter blur)
- [x] Favorit-Icon: `+` für nicht-favorisiert, Herz für favorisiert, nur bei Hover rechts
- [x] Startseite: kein "Home"-Heading, "Zuletzt gehört" immer zuerst
- [x] Sidebar: Playlist-Bibliothek als Liste mit Thumbnails
- [x] Suche: Suchfeld auf Desktop (NavBar), Search-Icon in mobiler Bottom-Bar
