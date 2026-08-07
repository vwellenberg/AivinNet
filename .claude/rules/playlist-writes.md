---
paths:
  - "src/aivinnet/api/playlist.py"
  - "src/aivinnet/api/playlistfolders.py"
  - "src/aivinnet/api/favorites.py"
  - "src/aivinnet/lib/playlist*.py"
  - "src/aivinnet/lib/reference_migration.py"
  - "tests/test_playlist*.py"
---

# Playlist-Schreibpfade

**Nie „ganze Liste ersetzen", nie auf Client-Indizes verlassen.** Zwei echte Datenverlust-Bugs
kamen aus derselben Wurzel: Der Client kennt die gespeicherte Trackhash-Liste **nicht**.

1. Er lädt nur eine **Seite** (~38 Zeilen von 993).
2. Er sieht **Orphan-Hashes gar nicht** — Hashes ohne auflösbaren Track. `GET /playlists/<id>`
   liefert nur auflösbare Tracks, also ist `len(tracks) < info.count`.

Daraus folgt: **Jeder Client-Index ist ein Index in die aufgelöste Teilliste, nie in die
gespeicherte Liste**, und jede vom Client gesendete „vollständige" Liste ist unvollständig.

## Was schon passiert ist

- `PUT /<id>/reorder` ersetzte die gespeicherte Liste 1:1 → ein Drag in einer 120-Track-Playlist
  machte daraus **44 Tracks**, mit HTTP 200 und „Done". Der Endpoint lehnt jetzt alles ab, was
  **keine Permutation** des Gespeicherten ist (409, `trackhash_diff`).
- `remove_from_playlist` prüfte `dbtrackhashes.index(hash) == item["index"]` → ein einziger
  Orphan davor, und die Löschung war ein **stiller No-op mit 200/„Done"**. Der Index ist jetzt
  nur noch Hinweis zur Unterscheidung von Duplikaten.

## Muster für neue Mutationen

Entweder **anker-basiert** (`PUT /<id>/move-track` mit `{trackhash, before_trackhash}`) oder
**positions-explizit pro Item** (`/sidebar-order`, `/playlistfolders/reorder` — „unlisted items
keep their position"). Die Listen-Chirurgie macht der Server auf seiner eigenen Liste.
Pure Helfer dafür in `lib/playlist_maintenance.py`, dort auch testen.

MCP-Pendant: `move_playlist_track()` macht den Drag-and-Drop-Pfad ohne Browser testbar.
`sort_playlist_tracks()` verweigert bei Orphans.

## ⚠️ `extra["added_at"]` ist ein Parallel-Map mit Trackhash-Keys

Jeder Pfad, der `trackhashes` umschreibt, muss das Map mitziehen (`migrate_added_at`) oder
aufräumen (`prune_added_at`) — sonst zeigt der Track „—" als Datum und ein Key verrottet für
immer. Die Pro-Playlist-Entscheidung liegt bewusst als pure Funktion
`playlist_migration_values()` **neben** der DB-Schleife, weil der Bug nicht in einem
Listen-Helfer saß, sondern in der Schleife, die nur eine der zwei Spalten schrieb.

## Sicherheitsnetz

`tests/test_playlist_orphan_invariants.py` formuliert die Orphan-Garantien **einmal**,
parametrisiert über alle Mutations-Helfer (`MUTATIONS`-Roster). Neue Helfer erben sie; ein
Roster-Test schlägt an, wenn ein neuer listen-umschreibender Helfer nicht registriert ist.
Nur `prune_orphan_trackhashes` darf Orphans absichtlich verwerfen.

## Audit-Stand (#53)

Alle übrigen Schreibpfade sind sauber: `/add` (`merge_trackhashes` startet an der gespeicherten
Liste), `/update` (schreibt `trackhashes` nie), `/save-item` (neue Playlist), `/sidebar-order`
und `/playlistfolders/*` (Position pro Item), Favoriten (`/favorites/add|remove` sind
hash- und typ-basiert, nie Index). Einzige gefundene Lücke war `repoint_track_references`:
Trackhash-Rewrite bei Tag-Edit ohne Migration des `added_at`-Maps.
