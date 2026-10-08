---
paths:
  - "src/aivinnet/db/**"
  - "src/aivinnet/migrations/**"
  - "src/aivinnet/setup/**"
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

⚠️ **Ein Teil-Neuaufbau muss dieselben Tracks wählen wie der volle** (#391). `create_artists([hash])`
nach einem Tag-Edit nahm nur Tracks, auf denen der Artist *spielt*, der Start auch die, deren
*Album-Artist* er ist. Ergebnis: Soundtracks und Sampler fielen nach jedem Edit von der
Artist-Seite. Und was der Start aufsummiert, läuft über alle User (`plays_by_trackhash`), nicht
über `get_current_userid()`: Das ist außerhalb eines Requests immer User 1.

⚠️ **Ein Rescan tauscht die Stores einzeln aus, und der Server bedient weiter** (#391).
Zwischen `TrackStore.load_all_tracks` und den `map_*`-Aufrufen am Ende von `_index_everything`
liegen Sekunden bis Minuten. In dieser Zeit landen Plays und Favoriten auf den **frischen**
Objekten und zugleich in der DB. Deshalb gilt für jeden, der nach einem Neuaufbau Daten aus der
DB auf die Stores legt:

- **Setzen, nie addieren oder umschalten.** `map_scrobble_data` addierte die DB-Summen: Ein Play
  in diesem Fenster zählte doppelt. `map_favorites` schaltete um: Ein frisch gesetzter Favorit
  war danach wieder aus. Beide setzen jetzt den DB-Stand (`set_favorite_user(True, …)`).
- **Ein Index, der in einen Store zeigt, wird aus diesem Store gebaut und direkt nach ihm
  getauscht.** `FolderStore.map` (Pfad → Hash) las früher die Tabelle ein zweites Mal, und zwar
  erst nach Alben und Artists. Bis dahin suchte die Ordneransicht neue Hashes in der alten Map,
  und jede Datei, deren Hash der Scan geändert hatte, fehlte in ihrem Ordner.
- **Über die Live-Dicts nie direkt iterieren.** Ein Album-Apply fügt aus einem Worker-Thread
  Schlüssel hinzu, dann wirft die Iteration „dictionary changed size during iteration“. Erst
  `list(cls.albummap.values())` bzw. `list(AlbumStore.albummap)` nehmen, wie
  `TrackStore.get_flat_list` es schon tat.

## ⚠️ Was zusammen stimmen muss, gehört in EINE Transaktion — und ein Rollback braucht keine DB

Jede Tabellen-Hilfsmethode (`insert_one`, `remove_tracks_by_filepaths`, …) committet für sich.
Hintereinander aufgerufen sind sie **keine** Einheit: Am 2026-09-30 tauschte eine Tag-Änderung
ihre Track-Zeile als DELETE + INSERT in zwei Commits, ein `database is locked` kam dazwischen,
und der Rollback — der dafür wieder in die DB schrieb — scheiterte an derselben Sperre. Fünf
Tracks waren aus der Bibliothek verschwunden, die Dateien lagen unberührt daneben.

Erkennbar an zwei Helfer-Aufrufen, die nur gemeinsam einen gültigen Zustand ergeben. Stattdessen:
eine Session, alles darin (Vorbild `TrackTable.replace_by_filepath(tags, also=…)`, das die
Referenz-Migration in dieselbe Transaktion zieht), Store erst **nach** dem Commit. Dann muss ein
Rollback nur noch die Datei zurücklegen. Regressionstest: `tests_api/test_track_edit_db_lock.py`
(hält die Sperre über den Rollback hinweg — eine Sperre, die ihn durchlässt, versteckt den Bug).

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

## ⚠️ Die `get_all`-Lesemethoden liefern Generatoren, keine Listen

`ScrobbleTable.get_all`, `TrackTable.get_all` & Co. sind Generatoren. `if not rows:` ist dann
**immer** `False`, und `len()` wirft. So lief „Recently played“ immer alle 20 Batches durch und
zeigte dieselben Karten mehrfach (#391), ohne dass ein Test rot war. Wer leer/voll oder die Länge
braucht: erst `list(...)`, oder `next(iter(...), None)`.

## ⚠️ Kein Ergebnis darf seinen Cursor über die Sitzung hinaus behalten (#363)

`Base.execute` (`db/__init__.py`) ist ein Generator, und die Aufrufer lesen das Ergebnis
**nach** dem Ende der Sitzung (`next(cls.execute(...)).scalars()`). Mit `yield_per`
(Streaming) blieb dabei das SQLite-Statement auf der **gepoolten** Verbindung offen und hielt
einen Lese-Schnappschuss. SQLAlchemy 2.1 finalisiert es beim Schließen der Sitzung nicht mehr
(2.0 tat es), und Python ≥ 3.11 setzt Statements beim `rollback` nicht mehr zurück. Der nächste
**Schreiber**, der genau diese Verbindung bekam, scheiterte sofort mit `database is locked`,
sobald inzwischen irgendwer geschrieben hatte.

Woran man es erkennt: **sporadische** 500er mit `database is locked` auf einfachen Inserts
(Favorit, Scrobble, Geräte-Registrierung), die nach ein paar Sekunden — oder beim zweiten
Klick — gehen. Kein langer Schreiber, kein zweiter Prozess (`fuser` zeigt nur die App).

Darum gilt:

- `Base.execute` **friert** zeilenliefernde Ergebnisse ein (`result.freeze()()`), bevor die
  Verbindung zurück in den Pool geht. Nicht wieder auf reines Streaming umstellen.
- Wer selbst in einem `with DbEngine.manager()` streamt und als Generator ausliefert
  (`TrackTable.get_all`), schließt das Ergebnis im `finally`.
- Nachstellen geht ohne die App: ein Pool mit **einer** Verbindung, halb gelesener Stream,
  fremder Schreiber, eigener Schreiber (`tests_api/test_db_stream_release.py`).
  ⚠️ Der Stream muss dabei **länger als ein `yield_per`-Batch** sein (>100 Zeilen) — sonst
  liest das erste `next()` ihn schon zu Ende, und der Test ist auch ohne Fix grün (#367).
- **Wächter:** `tests/test_db_streams_released.py` — ein Zensus über jede Funktion, die ein
  `yield_per` auf eigener Session/Verbindung ausführt (nicht über `cls.execute`): Sie muss
  einfrieren oder im `finally` schließen. Für eine Ja/Nein-Abfrage gar nicht erst streamen.
