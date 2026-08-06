# Architektur (Backend)

Wie das Backend gebaut ist — Schichten, Datenfluss, wo was liegt. Konventionen, Workflow und
Fallstricke stehen in [CLAUDE.md](../CLAUDE.md); diese Datei erklärt den Bauplan dahinter.

> Wird **nicht** in jede Session geladen. Zum Nachschlagen, bevor man ein Modul anfasst,
> das man noch nicht kennt.

## Der Kern in fünf Sätzen

Ein Flask-Prozess (`flask_openapi3`) serviert die REST-API **und** den gebauten Vue-Client.
Beim Start wird die **komplette Bibliothek aus SQLite in den RAM geladen** und lebt dort in
Klassen-Stores; die API liest fast ausschließlich aus diesen Stores, nicht aus der Datenbank.
Geschrieben wird in SQLite (Nutzerdaten, Playlists, Scrobbles) **und** in den Store — beide Seiten
hält man von Hand konsistent. Der WSGI-Server ist **bjoern: evented und single-threaded**,
weshalb jeder blockierende Aufruf die gesamte App anhält. Alles Langlaufende (Scan, Cover,
Cron) läuft deshalb in Threads oder Prozess-Pools daneben.

## Schichten

```
                 HTTP
                  │
   api/*.py       │  Blueprints, pydantic-Modelle, Auth-Gate.
                  │  Ein Modul pro Domäne, registriert in app_builder.load_endpoints()
                  ▼
   lib/*.py          Fachlogik: Scan, Tagging, Cover, Suche, Playlist-Chirurgie,
                     Group-Sessions. Möglichst pure Funktionen — hier gehören Tests hin.
                  │
        ┌─────────┴──────────┐
        ▼                    ▼
   store/*.py            db/*.py
   RAM-Wahrheit für      SQLAlchemy-Tabellen (Unterklassen von `Base`)
   Tracks/Alben/         libdata.py  = Bibliothek (TrackTable)
   Artists/Ordner/       userdata.py = alles Nutzergebundene
   Homepage                  │
                             ▼
                     SQLite (WAL), eine Datei: swingmusic.db
```

`models/` sind die Dataclasses, mit denen Stores und API arbeiten (`Track`, `Album`, `Artist`, …).
`serializers/` reduziert sie auf das, was die jeweilige Ansicht braucht (`serialize_for_card`).
`utils/` ist Werkzeug ohne Domänenwissen (Hashing, Datumsformate, Parser, Netz).

## Start-Sequenz

`__main__.py` → `start_swingmusic.py`. **Die Reihenfolge ist heikel** (steht auch als Kommentar
im Code):

1. `config_mimetypes()` — eine kaputte Windows-Registry liefert sonst falsche MIME-Typen.
2. `run_setup()` — Config-Datei anlegen, `serverId` würfeln (**das ist das JWT-Secret**),
   SQLite-Tabellen anlegen, Migrationen fahren, Default-User anlegen falls keiner existiert.
3. `app_builder.build()` — CORS, Compress, JWT, `before_request`-Auth-Gate, alle Blueprints.
   `app.static_folder` wird **erst hier** gesetzt; deshalb nie `app` direkt importieren,
   sondern `build()` aufrufen.
4. `load_into_mem()` — Tracks → Alben → Artists → Ordner, danach Scrobble-Daten, Favoriten
   und Farben auf die Store-Objekte mappen. Das ist das „Loading tracks/albums/artists… Done!"
   im Journal.
5. `run_swingmusic()` (Thread) — Plugins registrieren, Cron-Schleife starten.
6. `bjoern.run(...)`; Fallback `waitress`, wenn bjoern fehlt (das Bauen braucht `libev`).

## Die RAM-Stores

Das ist die Eigenheit, die man kennen muss:

| Store | Inhalt | Schlüssel |
|---|---|---|
| `TrackStore` | `trackhashmap: dict[str, TrackGroup]` | Trackhash → **alle** Dateien mit diesem Hash |
| `AlbumStore` | `albummap` | Albumhash |
| `ArtistStore` | `artistmap` | Artisthash |
| `FolderStore` | `filepaths` | Pfadmenge für den Ordner-Browser |
| `HomepageStore` | vorberechnete Startseiten-Sektionen | Entry-Name → pro User |

**Ein Trackhash steht für mehrere Dateien** (dieselbe Aufnahme in mehreren Qualitäten oder
Ordnern). `TrackGroup.get_best()` wählt die höchste Bitrate — deshalb liefert
`get_tracks_by_trackhashes()` je Hash genau *einen* Track, und deshalb ist eine Trackhash-Liste
nie dasselbe wie eine Dateiliste.

**Alben und Artists werden nicht persistiert.** Sie werden bei jedem Start aus den Tracks neu
abgeleitet (`lib/tagger.py::create_albums` / `create_artists`). Eine Änderung an der
Tag-Auswertung (Artist-Trenner, Album-Titel-Bereinigung) verändert damit rückwirkend die ganze
Bibliothek — genau deshalb löst `PUT /notsettings/update` für diese Schlüssel einen kompletten
Reindex aus.

**Regel:** Wer die DB schreibt, muss den Store nachziehen (oder `index_everything()` auslösen).
Nur die DB zu ändern wirkt bis zum nächsten Neustart wie ein No-op.

## Scan / Indexierung

`lib/index.py::index_everything()` ist der eine Einstiegspunkt (`@background` = eigener Thread).
Ausgelöst durch: Root-Verzeichnis geändert, `GET /notsettings/trigger-scan`, tag-relevante
Einstellung geändert. **Es gibt keinen periodischen Scan** — `periodic_scan.py` ist vollständig
auskommentiert.

```
IndexTracks()                       lib/tagger.py
 ├ run_fast_scandir(rootDirs)       alle Audiodateien einsammeln
 ├ filter_modded()                  mtime-Vergleich gegen TrackTable; fehlende Dateien
 │                                  und versteckte/AppleDouble-Pfade fliegen raus
 └ tag_untagged()                   Prozess-Pool (cpu/2) → get_tags() → TrackTable
        ▼
Stores neu laden, RecentlyAdded, Farb-/Favoriten-/Scrobble-Mapping
        ▼
CordinateMedia()                    lib/populate.py
 ├ ProcessTrackThumbnails           eingebettetes Cover → images/thumbnails/{xsmall,small,medium,large}
 ├ ProcessAlbumColors/ArtistColors  dominante Farbe je Bild → DB
 ├ CheckArtistImages                Künstlerbilder aus dem Netz
 └ FetchSimilarArtistsLastFM        ähnliche Artists → SimilarArtistTable
```

⚠️ **Es gibt keinen Datei-Watcher.** Der Upstream hatte einen (`lib/watchdogg.py`); in diesem
Fork war er seit dem watchdog-Upgrade nicht einmal importierbar (`BaseObserverSubclassCallable`
existiert in watchdog 6 nicht mehr), lief also nie, und wurde 2026-08 entfernt. Die Bibliothek
zieht ausschließlich per **explizitem Scan** nach: `index_everything()` aus
`GET /notsettings/trigger-scan`, beim Hinzufügen/Entfernen eines Ordners und nach einem Restore.
Kein Cron, kein Scan beim Start. Wer eine Datei außerhalb der App ändert, sieht sie bis zum
nächsten Scan nicht; Tag-Edits **aus** der App ziehen die Stores selbst nach
(`lib/track_edit.py`).

**Migrationen:** `migrations/` hat einen versionierten Mechanismus, der **derzeit inert** ist
(leere Modulliste, Apply-Schleife auskommentiert). Die beiden echten Reparaturen
(`repair_collapsed_albumhashes`, `rename_albums_after_their_folder`) laufen deshalb bei *jedem*
Start aus `setup/sqlite.py`, sind idempotent geschrieben, und ihre Reihenfolge ist relevant.

## Datenbank

Eine SQLite-Datei, WAL-Modus, Zugriff über `DbEngine.manager()`. Alle Tabellen erben von
`db/__init__.py::Base` (`insert_one`, `all`, `count`, …).

| Modul | Tabellen |
|---|---|
| `db/libdata.py` | `track` — die einzige persistierte Bibliothekstabelle |
| `db/userdata.py` | `user`, `favorite`, `scrobble`, `playlist`, `playlistfolder`, `page` (Collections), `mix`, `artistdata`, `notlastfm_similar_artists`, `plugin`, `device` |

⚠️ **`Base.execute` liefert sein Result aus einem bereits geschlossenen Session-Scope.** Wer dort
eine gemappte Entity materialisiert (`select(cls)` + `.scalar()`), bekommt „identity map is no
longer valid". Für Lookups **Spalten** selektieren (`select(cls.id)`); Vorbild ist `count()`.
Das war ein 500er bei jeder Wiederholungs-Registrierung eines bekannten Geräts.

## Auth

Cookie- **oder** Header-JWT (`flask_jwt_extended`), Secret ist die `serverId` aus der
Config-Datei — wer das Config-Verzeichnis löscht, invalidiert alle Tokens.
`app_builder.check_auth_need()` ist die Allowlist: `/`, statische Client-Dateien, Bilder und
`/auth/{login,users,pair,logout,refresh}` gehen ohne Token durch, **alles andere** läuft durch
`verify_jwt_in_request()`. Cookie-Tokens verlängert `after_request` automatisch, Header-Tokens
(Mobile, Dritte) nicht.

⚠️ Beim Selbst-Prägen eines Tokens muss `sub` ein **Dict** sein (`{"sub": {"id": 1}}`) — der
`user_lookup_loader` macht `jwt_data["sub"]["id"]`. Ein JSON-String dort ergibt HTTP 500 auf
jedem Endpoint, während die App-Shell weiter rendert: sieht aus wie ein kaputtes UI, ist ein
kaputtes Token.

## API-Oberfläche

Ein Blueprint je Modul, registriert in `app_builder.load_endpoints()`. Die URL-Präfixe folgen
nicht durchgehend dem Modulnamen:

| Präfix | Modul | Inhalt |
|---|---|---|
| `/album` `/artist` `/track` `/folder` | gleichnamig | Detailansichten |
| `/playlists` `/playlistfolders` `/favorites` | gleichnamig | Bibliotheks-Mutationen |
| `/search` `/getall` | gleichnamig | Suche, paginierte Listen |
| `/file` | `stream.py` | Audio-Auslieferung |
| `/img` | `imgserver.py` | Cover, Artist-, Playlist- und Nutzerbilder |
| `/nothome` | `home/` | Startseiten-Sektionen |
| `/notsettings` | `settings.py` | Config + `trigger-scan` |
| `/logger` | `scrobble/` | Play-Log **und** alle Statistiken |
| `/devicesync` | `devicesync.py` | Multiroom (Mechanik in CLAUDE.md) |
| `/auth` | `auth.py` | Login, Profile, QR-Pairing |
| `/plugins/*` | `api/plugins/` | Lyrics, Mixes |

`/docs` liefert die generierte OpenAPI-Oberfläche — der schnellste Weg, eine Signatur
nachzuschlagen, ohne den Code zu lesen.

## Audio-Auslieferung

Praktisch läuft alles über `GET /file/<trackhash>/legacy`: Der Client erzwingt den Legacy-Pfad
(`getUrl()` setzt `use_legacy = true` fest), weil die Playback-Engine mit dem gechunkten
Endpoint nicht sauber umgeht. Der chunked/transcodierende Zweig ist auskommentiert —
`Range`-Support und Transcoding (ffmpeg, `TransCodeStore` mit 50er-Cache) liegen also brach.

Pfadauflösung: erst über den `filepath`-Query, sonst über den Trackhash mit der höchsten
Bitrate, die tatsächlich auf der Platte liegt. Path-Traversal wird gegen die Root-Verzeichnisse
geprüft. `POST /file/silence` liefert die Stille-Paddings für den Gapless-Übergang des Clients.

## Bilder

`/img/...` liefert aus dem **Config-Verzeichnis**, nicht aus dem Quellbaum. Die Größen entstehen
beim Scan aus dem eingebetteten Cover. Fehlt eine, sucht `send_file_or_fallback` zuerst im Ordner
des Tracks nach `cover|front|back|folder|album|artwork.{jpg,png,webp}`, cached das Ergebnis, und
degradiert sonst auf die größte vorhandene andere Größe, bevor das Platzhalterbild kommt.

Der `?pathhash=`-Parameter macht diese Ordnersuche überhaupt erst möglich — deshalb trägt
`Album.image` diesen Suffix, und deshalb muss man ihn vor jedem Datei-Lookup abschneiden
(`image.split("?", 1)[0]`).

## Hintergrundarbeit

`crons/__init__.py` fährt **eine** `schedule`-Schleife in einem Thread:

- `Mixes` alle 12 h — Artist-Mixe, danach „Because you listened" (Details in CLAUDE.md,
  Abschnitt *Empfehlungen*; einzige externe Quelle ist `smcloud.mungaist.com`).
- `TopArtists` (Woche/Monat), `RecentlyPlayed`, `RecentlyAdded` — reine lokale Aggregation.
- Group-Session-Reaper alle 2 s, breit abgesichert, damit ein Fehler dort nie die gemeinsame
  Schleife killt.

Alles Weitere läuft über `utils/threading.py::background` (Scan, Thumbnail-Cache) oder über
Prozess-Pools (Tags lesen, Farben extrahieren) — nie im Request-Pfad.

## bjoern-Disziplin

Der WSGI-Server ist evented und single-threaded. Daraus folgt hart:

- **Kein blockierendes I/O im Request-Pfad.** Ein hängender ausgehender HTTP-Aufruf friert die
  *gesamte* App ein, auch `/`.
- **Ausgehende Requests brauchen IPv4 und eine harte Deadline.** `utils/net.py::prefer_ipv4()`
  läuft in `config_app`; zusätzlich Futures mit Deadline absichern (Vorbild `lib/coverart.py`).
- **Keine langlebigen Verbindungen** (WebSocket, SSE). Multiroom löst das mit Polling plus
  serverseitig geplanter Ausführung; `/devicesync/poll` ist strikt RAM-only.

## Konfiguration und Ablage

Die Laufzeit-Config ist eine JSON-Datei im Config-Verzeichnis (`config.py::UserConfig`),
**nicht** die Datenbank. Darin u. a. `rootDirs`, `serverId` (= JWT-Secret) und die
Tag-Verarbeitungsoptionen.

```
config folder
└── swingmusic
    ├── assets            Platzhalterbilder (default.webp, artist.webp, playlist.svg)
    ├── client            der deployte Vue-Build  ← app.static_folder
    ├── images
    │   ├── artists       large / medium / small
    │   ├── mixes         original / medium / small
    │   ├── playlists
    │   └── thumbnails    large / medium / small / xsmall
    ├── plugins
    │   └── lyrics
    └── swingmusic.db
```

## Wo fange ich an?

| Frage | Datei |
|---|---|
| Wie kommt ein Endpoint zustande? | `app_builder.py` → `api/<domäne>.py` |
| Woher kommen die Daten? | `store/*.py` (RAM), sonst `db/userdata.py` |
| Warum sieht ein Album so aus? | `lib/tagger.py::create_albums` + `utils/parsers.py` |
| Warum fehlt ein Cover? | `lib/taglib.py::extract_thumb` → `api/imgserver.py` |
| Wie wird abgespielt? | `api/stream.py::send_track_file_legacy` |
| Wer schreibt Playlists? | `api/playlist.py` + `lib/playlist_maintenance.py` |
| Multiroom? | `lib/groupsession.py` (pure Logik) + `api/devicesync.py` |
