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

## ⚠️ Schema-Änderungen erreichen bestehende DBs NICHT

`create_all` legt nur fehlende Tabellen an — es **ändert keine vorhandene**. Ein geändertes
`mapped_column` (Constraint, Typ, Nullability) wirkt deshalb nur auf frischen Installationen;
die Datenbank des Servers behält ihr altes Schema für immer. SQLite kann Constraints außerdem
nicht per `ALTER TABLE` entfernen: **die Tabelle muss neu gebaut werden** (neue Tabelle, Zeilen
kopieren, alte droppen). Vorbild und Baumuster: `migrations/favorites_unique_per_user.py`.

Drei Punkte, an denen dieser Umbau schiefgeht:

- **Erkennung über die Struktur, nicht über eine Versionsnummer** — `PRAGMA index_list` /
  `index_info` fragen, ob die Tabelle noch die alte Form trägt. Das macht die Reparatur
  automatisch idempotent (zweiter Lauf findet nichts) und braucht keinen Migrationsstand.
- **Indizes wandern beim `RENAME` mit und behalten ihre Namen** → vor dem Umbau die per
  `CREATE INDEX` angelegten (`PRAGMA index_list`, `origin == "c"`) droppen, sonst scheitert die
  neue Tabelle an „index ix_… already exists".
- **`PRAGMA foreign_keys` wirkt nur außerhalb einer Transaktion.** sqlite3 öffnet vor dem ersten
  INSERT implizit eine — also `isolation_level = None` setzen und `BEGIN`/`COMMIT` selbst fahren.
  Ohne ausgeschaltete FKs kippt der Umbau an Alt-Zeilen, deren User es nicht mehr gibt.

Das Ziel-Schema aus dem Modell kompilieren (`CreateTable(Model.__table__)`), nicht als DDL-String
danebenlegen — sonst driften Reparatur und `create_all` auseinander. Der Test dazu vergleicht
beide Tabellen strukturell (`tests_api/test_favorites_table_roundtrip.py`).

## ⚠️ Nutzergebundene Tabellen: der `userid`-Filter fehlt schnell

In `db/userdata.py` hat jede Zeile einen `userid` — aber der Filter steht **nicht** automatisch
in der Query. `FavoritesTable` zeigte alle drei Spielarten des Fehlers gleichzeitig
(AivinNet-Client#435): ein globales `unique=True` auf `hash` (Zweit-User → IntegrityError → 500),
ein `DELETE … WHERE hash` ohne User (löschte fremde Zeilen) und Lookups/Zähler, die die Daten
aller User zusammenwarfen. Wer eine Methode dort anfasst, prüft alle Geschwister-Methoden mit:
`unique=True` gehört bei diesen Tabellen in ein `UniqueConstraint(<spalte>, "userid")`.
