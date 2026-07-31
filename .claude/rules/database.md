---
paths:
  - "src/swingmusic/db/**"
  - "src/swingmusic/migrations/**"
  - "src/swingmusic/setup/**"
---

# Datenbank

Eine SQLite-Datei (WAL), Zugriff über `DbEngine.manager()`. Alle Tabellen erben von
`db/__init__.py::Base`. `db/libdata.py` hält die einzige persistierte Bibliothekstabelle
(`track`), `db/userdata.py` alles Nutzergebundene.

## ⚠️ `Base.execute` liefert aus einem bereits geschlossenen Session-Scope

Wer dort eine **gemappte Entity** materialisiert (`select(cls)` + `.scalar()`), bekommt
„identity map is no longer valid".

```python
select(cls.id).where(...)     # richtig — Spalten selektieren
select(cls).where(...)        # FALSCH bei Lookups über Base.execute
```

`DeviceTable.upsert` tat genau das → **jede Wiederholungs-Registrierung eines bekannten Geräts
war ein HTTP 500.** Vorbild für den richtigen Weg ist `count()`.

## ⚠️ Store und DB sind zwei Wahrheiten

Die Bibliothek lebt zur Laufzeit in den RAM-Stores (`store/*.py`), nicht in der DB. **Nur die DB
zu schreiben wirkt bis zum nächsten Neustart wie ein No-op.** Entweder den Store mitziehen oder
`lib/index.py::index_everything()` auslösen.

Alben und Artists sind **abgeleitet**, nicht gespeichert — sie entstehen bei jedem Start aus den
Tracks (`lib/tagger.py::create_albums` / `create_artists`). Eine Migration, die Hashes anfasst,
muss deshalb **danach einen Scan auslösen** (`GET /notsettings/trigger-scan`); sonst verlieren
Alben ihr Bild, die eines hätten.

## Migrationen

Der versionierte Mechanismus in `migrations/` ist **derzeit inert** (leere Modulliste, Apply-
Schleife auskommentiert) — eine dort registrierte Migration liefe nie. Die beiden echten
Reparaturen laufen stattdessen bei *jedem* Start aus `setup/sqlite.py`:
`repair_collapsed_albumhashes()`, dann `rename_albums_after_their_folder()`. Beide sind
idempotent geschrieben, und ihre **Reihenfolge ist relevant** — die Umbenennung findet ihre
Zeilen über den Ordner-Albumhash, den die Reparatur davor schreibt.

Wer eine neue Migration ergänzt: entweder denselben idempotenten Weg gehen, oder den
versionierten Mechanismus zuerst reaktivieren. Nicht registrieren und hoffen.
