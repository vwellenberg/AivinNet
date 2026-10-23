---
paths:
  - "src/aivinnet/models/track.py"
  - "src/aivinnet/models/album.py"
  - "src/aivinnet/utils/hashing.py"
  - "src/aivinnet/lib/tag*.py"
  - "src/aivinnet/lib/index.py"
  - "src/aivinnet/lib/folder_index.py"
  - "src/aivinnet/utils/filesystem.py"
  - "src/aivinnet/lib/track_edit.py"
  - "src/aivinnet/lib/reference_migration.py"
  - "src/aivinnet/lib/name_cleanup.py"
  - "src/aivinnet/api/track.py"
  - "mcp_server/server.py"
  - "src/aivinnet/utils/stats.py"
  - "src/aivinnet/api/album.py"
---

# Track-Tags, Titel und Hashes

Aus einer Reparaturrunde über die ganze Bibliothek (WMA-Ablösung, 550+ Platzhalter-Tags,
MusicBrainz-Abgleich). Alles hier ist an echten Daten aufgelaufen, nicht hergeleitet.

## Der trackhash hängt an drei Tags — an sonst nichts

```python
self.trackhash = create_hash(self.title, self.album, *(a["name"] for a in self.artists))
```

Daraus folgt beides, und beides ist wichtig:

- **Format und Pfad sind egal.** 210 Dateien von WMA nach MP3 zu konvertieren hat *keinen*
  einzigen Hash verändert — Playlists, Favoriten und Historie überlebten das unangetastet.
- **Jede Änderung an Titel, Album oder Interpret bricht die Zuordnung.** Playlist-Einträge,
  Favoriten und Scrobbles zeigen danach ins Leere. Sie zählen weiter mit, lassen sich aber
  nicht mehr anzeigen — das ist genau die Orphan-Lücke aus `playlist-writes.md`.

**Ein Rescan trägt die Referenzen selbst mit** (`lib/index.py::_carry_references`, #433): Er merkt
sich vor dem Scan Pfad → Hash und zieht nach dem Laden die Referenzen um, wo der Hash einer Datei
wechselte und kein anderes Stück ihn noch hält (`lib/rescan_remap.py`). Das deckt Tag-Änderungen
von außen ab. Die Regel darunter beschreibt, was dieser Pfad im Kern tut:

**Vor jeder Tag-Änderung** also die Hashes je Dateipfad festhalten, nach dem Rescan erneut
holen und die Referenzen umziehen. Die Zuordnung läuft über den Dateipfad, der sich ja nicht
ändert:

```python
umzug = {vorher[fp]: nachher[fp] for fp in vorher
         if fp in nachher and vorher[fp] != nachher[fp]}
# dann playlist.trackhashes, favorite.hash und scrobble.trackhash durchziehen
```

⚠️ **Den Umzug GLEICHZEITIG anwenden, nie Paar für Paar** (`migrate_track_references_many`).
Vertauschte Titel (A→B, B→A) oder eine um eins verschobene Reihe (1→2, 2→3, …) bilden auf
einen Hash ab, der selbst noch umzieht: Paar für Paar verschmolz der erste Schritt zwei Songs
zu einem Eintrag, und nach einer Verschiebung zeigte alles auf den letzten Titel (#296). Der
Album-Apply nutzt dafür `ReferenceBatch`: Nur Umbenennungen auf den Hash einer anderen Datei
im Batch warten bis zum Ende, alle anderen ziehen weiter atomar mit ihrer Zeile um.

**Alben und Artists ziehen mit ihrer LETZTEN Datei um** (`track_edit._retired_identities`): ihre
Favoriten (#296), die Sidebar-Pins eines Albums (`pinned_album`) und ihre Karten in den
Home-Sammlungen (#481), alles in derselben Transaktion wie die Zeile, über **eine** Stelle:
`reference_migration.migrate_identity_references`. Solange noch eine Datei den alten Namen trägt,
gibt es das alte Album und es behält alles. Bis #481 zogen nur die Favoriten mit; jeder Speicher
war einzeln verdrahtet, und jeder vergessene verlor lautlos: Home und die Sidebar überspringen
einen Hash, den sie nicht auflösen können. **Wer eine neue Stelle baut, die Album- oder
Artist-Hashes speichert, hängt sie in diese Funktion.** Noch nicht drin: die Quellen `al:`/`ar:`
der Scrobbles (Recently played, Continue listening). ⚠️ Ein Rescan nach einer Änderung **von
außen** zieht nur Track-Referenzen um (`_carry_references`), nichts davon.

## ⚠️ Der Server bereinigt Titel und Interpreten beim LADEN — die Dateien bleiben, wie sie sind

Seit 2026-10 nimmt `models/track.py` beim Aufbau jedes Tracks zwei Dinge von den Namen ab
(`utils/parsers.py`):

- **Eine Tracknummer vor dem Titel** (`strip_track_number`): „049 Saint Wenceslaus Theme" →
  „Saint Wenceslaus Theme", „6-001 Fistcuffs" (CD-Präfix) → „Fistcuffs". Nur mit **zweitem
  Zeugen**, denn eine Zahl allein beweist nichts („007 Theme", „7 Seconds", „24-7"): die eigene
  Tracknummer aus den Tags (dann null-gepolstert, mit Satzzeichen „7. Intro" oder mit CD-Präfix),
  oder — nur null-gepolstert und ohne andere Tracknummer in den Tags — ein Dateiname, der mit
  **derselben** Zahl beginnt. Unpolstert ist der Dateiname kein Zeuge: ein Song, der nach seiner
  eigenen Nummer heißt, liegt in einer Datei mit seinem Namen („3 Libras.mp3" ist Track 3).
  Und die Zahl muss **vor** Wörtern stehen: „24-7", „1-Up", „1.5 Degrees" bleiben.
  Gemeldet war: „saint" fand den Titel nicht unter den Top-Treffern, und die Nummer stand doppelt
  in der Liste.
- **Eine Rolle vor dem Interpreten** (`strip_artist_credit`): „Composed by Adam Sporka" → „Adam
  Sporka" (auch „Music by", „Original Score by", „Arranged/Performed/… by", „Komponiert von").
  Bewusst **nicht** „Written by" (es gibt die Band „Written by Wolves") und „Produced by".

Weil beides in `trackhash` (Titel, Interpreten) und `artisthash` (Name) eingeht, ändern sich die
Hashes **ohne** Scan und ohne Dateiänderung — beim ersten Start mit dem neuen Code. Jeder Track
merkt sich deshalb, wie er vorher hieß (`Track._legacyhash`, `_legacy_artisthashes`, beide mit
Unterstrich, also nie in einer API-Antwort), und `lib/name_cleanup.py::carry_cleaned_names()`
zieht direkt nach `TrackStore.load_all_tracks` (beim Start in `setup.load_into_mem` und nach
jedem Scan in `index._index_everything`, in dem auch ein Backup-Restore endet) Playlists,
Favoriten, Scrobbles, Artist-Favoriten, Artist-Karten in Home-Sammlungen und Artist-Bilder um
(ein Bild nur, solange der Besitzer über den **neuen** Namen nicht selbst entschieden hat). Dieselben Regeln wie beim Rescan
(`remap_by_path`): Ein alter Hash, den noch ein anderer Track trägt, bleibt; einer, der sich auf
zwei neue verteilt, kann keinem folgen. Es **liest erst und schreibt nur, was noch referenziert
ist** — ab dem zweiten Start schreibt es nichts, und ein Fehler darin verhindert den Start nicht.

Was daraus folgt:

- **Die Datei behält das Original, alles im Client zeigt den bereinigten Namen** — auch der
  Tag-Editor (`EditTrack.vue` füllt aus dem Track der API). Er schickt nur, was sich geändert hat;
  wer dort einen bereinigten Titel anfasst, schreibt den bereinigten in die Datei. Wer „den echten
  Titel" sucht (`ffprobe`, MCP-Tools), sieht die Nummer.
- **Eine neue Tracknummer nimmt den gezeigten Titel mit** — im **Editor**, nicht im Server:
  `EditTrack.vue` schickt den Titel, wie er dastand, sobald sich die Nummer ändert. Unter Nummer
  50 bestätigt nichts mehr die „049", die Nummer stünde wieder im Titel — und ein Umbenennen
  schrieb „50 - 049 Saint Wenceslaus Theme.mp3". Nur der Editor weiß, was der Mensch gesehen hat;
  Batch-Schreiber und MCP-Tools setzen weiter genau die Felder, die sie schicken.
- **Gespeicherte Queues im Browser tragen die alten Hashes.** Der Umzug hält dafür seine eigene
  Zuordnung alt → neu im RAM (`name_cleanup.current_trackhash`, bei jedem Laden neu gesetzt), und
  `/file/<hash>/legacy` wie `/logger/track/log` lösen einen alten Hash darüber auf: die Queue
  spielt weiter, und der Scrobble zählt gleich für den **neuen** Hash. Bewusst nicht über den
  Pfad — der kann inzwischen einen anderen Song tragen, und ein unbekannter kostete einen Lauf
  über den ganzen Store, auf dem einzigen Request-Thread.
- **Ein Umzug, der zweimal dasselbe Ziel hat, schreibt es einmal.** Zwei alte Artist-Hashes, die
  auf denselben neuen fallen („Composed by X" und „Music by X"), dürfen in einer Home-Sammlung
  nicht zu zwei gleichen Karten werden; `move_collection_items` behält die erste. Und die
  `user-set`-Markierung eines Artist-Bilds zieht erst mit, wenn **alle** Größen kopiert sind: Sie
  lässt jeden späteren Start diesen Artist überspringen, eine fehlgeschlagene Größe würde sonst
  nie nachgeholt.
- **Der Album-Hash bleibt der alte.** Er kommt aus der Spalte (`album_hash` mit Ordner); bei
  `mergeAlbums` rechnet `map_with_config` mit den **getaggten** Album-Interpreten, damit kein
  Cover und kein Album-Favorit verwaist.
- **Wer Hashes außerhalb des Modells nachrechnet** (Migrationen wie `album_title_from_folder`,
  Skripte), rechnet mit den Rohnamen und bekommt den alten Hash. Das ist in Ordnung, solange der
  Umzug danach durch `carry_cleaned_names` läuft — Migrationen laufen vor dem Laden.

Ein neuer Bereinigungsschritt im Modell braucht dasselbe: den alten Hash in
`remember_legacy_identity` mitschreiben, sonst verwaisen die Referenzen lautlos. Und er darf
nur den **Titel** ändern, nie den Albumnamen einer Single (der hängt am Album-Hash). Tests:
`tests/test_parsers.py` (Regeln), `tests/test_name_cleanup_mapping.py` (was umzieht, Verdrahtung),
`tests_api/test_name_cleanup.py` (Umzug gegen die echten Tabellen), `tests_api/test_search_word_ranking.py` (die Suche), e2e: der Soundtrack in
`e2e/make_library.py`.

**Die Suche rangiert in Stufen** (`lib/searchlib.py::_rank`): exakt (100) > die Anfrage beginnt
ein **Wort** (90–99) > sie steckt irgendwo drin (80–89) > nur ähnlich (WRatio, unter 80). Vorher
lagen „Saints" (91) und „Saint Wenceslaus Theme" (90) gleichauf, und die Top-Treffer haben vier
Track-Plätze. Ein oder zwei Zeichen rangieren **nur** nach Enthaltensein (`_rank_short`): WRatio
skaliert dort einen Teiltreffer für lange Titel auf 0,6 herunter, so verlor „Abandoned by …" für
„ab" gegen jeden kurzen „kebab"-Titel — und der volle WRatio-Lauf war pro Tastendruck der teure
Teil.

## ⚠️ Ein Hash, mehrere Dateien — nie per Hash *eine* Datei adressieren

Gleiche Tags ⇒ gleicher Hash, egal welches Format: `X.mp3` neben `X.wav` (100-Musicians/
500-Dream.Corp) teilen sich einen, ebenso alle Dateien eines Albums, deren Tags „Track 1" sagen.
Der `TrackStore` hält dafür eine `TrackGroup`, und `get_best()` wählt die **höchste Bitrate**.

Live 2026-10-02: ein Batch schickte 149 × `PUT /track/<hash>/tags` (eine pro Datei), bekam
149 × 200 — und keine einzige MP3 wurde angefasst. Beide PUTs eines Paars landeten über
`get_best()` auf der WAV. Seitdem gilt:

- **`PUT /track/<hash>/tags` rät nicht mehr.** Teilen sich mehrere Dateien den Hash, muss
  `filepath` im Body sagen, welche; ohne kommt **409** mit den Kandidaten in `filepaths`, und
  nichts wird geschrieben. Ein `filepath`, der den Hash nicht trägt, ist 404. Die Antwort nennt
  in `track.filepath` immer die Datei, die tatsächlich geschrieben wurde.
- Der Client-Editor und das MCP-Tool `set_track_tags` schicken den Pfad mit; `get_playlist`
  liefert ihn dafür. Batches über einen Ordner: **immer** mit `filepath`.
- ⚠️ **Geschrieben wird in einem Job, nicht im Request (#376).** Der Edit kopiert die ganze
  Audiodatei als `.bak`, bevor er schreibt — im Request hielt das bei einer großen WAV auf
  langsamer Platte **jeden** Hörer an (ein Request zur Zeit). Was der RAM beantworten kann,
  kommt sofort (400 keine Felder, 409 `busy`, 404, 409 `filepaths`, über `resolve_track`),
  sonst `{"job": id}`; Ergebnis `{track, rename?}` über `/metadata/job/<id>`. Der Job hat
  keinen „aktuellen User“: `serialize_track(…, userid=…)` mit der ID aus dem Request, sonst
  meldet `is_favorite` den Favoriten von User 1. Client (`editTrackTags`) und MCP pollen.
- Dieselbe Falle im Browser: die Queue zog einen Einzeledit per Hash nach und gab so dem
  unberührten Zwilling Pfad und Tags der editierten Datei. `retagTrack` gleicht deshalb per
  **altem Pfad** ab, wie schon `followFileChanges`.

Wer einen neuen Schreibpfad baut: Ziel ist eine **Datei**, also Pfad (`edit_track_tags_by_filepath`).
Ein Hash ist nur als Gruppe sinnvoll — Referenzen (Playlists, Favoriten) zeigen auf die Gruppe.

## ⚠️ Hinzugefügt ist nicht geändert: `added` statt `last_mod`

`last_mod` ist die **mtime**, also der letzte *Schreibvorgang*. Jeder Tag-Edit, jedes in die
Datei geschriebene Cover und jeder Album-Apply setzt sie auf jetzt, und der nächste Scan liest
die Datei als neue Zeile ein. „Recently added“, „Date added“ (Alben, Artists, Ordner) und die
Standardreihenfolge eines Ordners lasen bis 2026-10 genau das. Nach einer Tag-Reparatur stand
deshalb der ganze Ordner `100-Musicians` (2954 Tracks) als „NEW MUSIC“ auf Home, und ein
bearbeiteter Song rutschte ans Ende seines Ordners.

Seitdem trägt jede Zeile `added` (`migrations/track_added.py`, `lib/date_added.py`):

- **Neue Datei:** ihre mtime, wie früher.
- **Neu geschriebene Zeile:** `added` wird **mitgenommen**, und zwar vom Rescan
  (`filter_modded` merkt es sich, `tag_untagged` setzt es) und vom Tag-Editor (`track_edit._edit`).
  Ein Rename behält die Zeile und damit auch `added`.
- **Zeilen von vor der Spalte** (NULL) füllt `backfill_added` nach dem Laden: die mtime, außer
  der Track wurde **vor** ihr schon gespielt. Ein Play beweist, dass die Datei da war. Ein
  bearbeiteter, aber nie gespielter Track behält die Bearbeitung als Datum, weil nichts in der DB
  es besser weiß.

`last_mod` bleibt, was es ist: die Frage des Scans „hat sich die Datei geändert?“. **Wer einen
neuen Schreibpfad baut, der die `track`-Zeile neu anlegt, setzt `tags["added"]` aus der alten
Zeile.** Fehlt es, landet die Datei wieder als „neu“ auf Home. Grenze: Wird eine Datei erst
bearbeitet und dann **außerhalb** der App verschoben, sieht der Scan eine fremde neue Datei, und
`added` wird ihre (frische) mtime.

**Dieselbe Falle eine Ebene höher: die mtime eines Verzeichnisses.** „Folder date“ in der
Ordneransicht las sie bis 2026-10. Sie ändert sich mit jedem Eintrag, der im Ordner entsteht oder
verschwindet, und solche Einträge legt die App selbst an: die `.bak` jedes Tag-Edits, eine `.lrc`
vom Lyrics-Finder, ein Rename. Seitdem ist ein Ordner so neu wie die neueste Datei, die in ihn
**hinzugefügt** wurde (`FolderStore.newest_added`, größtes `added` darunter, ohne Dateisystem).
Gelesen wird aus `FolderStore.added` (Pfad → `added`), gebaut im selben Durchlauf wie `map`:
Der Weg über `map` in den Track-Store kostete an der Wurzel von 200k Dateien 321 ms auf dem
einzigen Request-Thread, das eigene Dict 55 ms. ⚠️ Wer `map` pflegt, pflegt `added` mit
(`index_file(..., added)`, `move_filepath` nimmt es mit). Wer ein Datum für etwas Abgeleitetes
braucht (Ordner, Album, Artist), nimmt es aus den `added` der Tracks, nie aus `os.stat`.

## Dateien umbenennen: der Hash bleibt, drei Stellen ziehen mit

Ein Rename (`lib/track_rename.py`, #144) ändert **keinen** Hash — dafür alles, was den Pfad
führt: die `track`-Zeile (`TrackTable.update_filepath`, `last_mod` bleibt, deshalb sieht der
nächste Scan die Datei als unverändert), die Track-Objekte im `TrackStore` und den
`FolderStore`, dazu die `.lrc` gleichen Namens daneben.

Zwei Einstiege, ein Muster: der Album-Dialog (`api/metadata.py`, Namen aus der Vorschau) und der
Einzel-Editor (`PUT /track/<hash>/tags` mit `rename_file`). Der Editor rechnet den Namen über
`track_rename.name_after_tags` — Nummernbreite und CD-Präfix kommen dort vom **ganzen Album**,
sonst stünde ein einzeln umbenanntes `3 - Titel` neben `03 - Anderes`. Ein Rename, der nicht geht,
macht die Tags nicht rückgängig: die Antwort meldet ihn in `rename`, der Request bleibt 200.

⚠️ **`FolderStore.map` (Pfad → Hash) ist die Stelle, die vergessen wird.** Die Ordneransicht
findet ihre Tracks darüber — und bis #144 hat auch eine **Tag-Änderung** sie nicht nachgezogen:
„The Guild 2" zeigte nach der Titel-Reparatur 0 von 94 Dateien im Ordner, bis zum nächsten
vollen Scan. Wer Pfad oder Hash ändert, ruft `FolderStore.index_file` / `move_filepath`.

⚠️ **Die vierte Stelle liegt im Browser: die Queue.** Sie hält eigene, persistierte Kopien der
Tracks, und gestreamt wird über Pfad **und** Hash (`/file/<hash>/legacy?filepath=`). Retitle +
Rename im Metadaten-Dialog änderte beides; die Queue kannte danach nur noch Werte, die der
Server nicht mehr auflösen kann — jeder Titel 404, der Player sprang durch die ganze Queue
(live 2026-09-24, Battle Realms). Deshalb: wer Tags oder Namen per Client ändert, zieht die
Queue nach — Einzeledit `tracklist.retagTrack`, Batch `tracklist.followFileChanges`
(per **altem Pfad**, der Hash ist nicht eindeutig). Andere Geräte behalten ihre alte Queue; der
Player hört dort nach `utils/skipGuard.ts` drei Fehlschlägen in Folge auf, statt durchzurasen.

## ⚠️ Die Hashes in der Datenbank sind nicht die des laufenden Servers

Die `track`-Tabelle trägt teils noch Hashes aus der alten SHA1-Ära; `create_hash` rechnet
längst `xxh3_64`. Der `TrackStore` im RAM hat die neuen, die DB die alten — für dieselbe Datei.

Wer Hashes aus der Datenbank (`aivinnet.db`) liest und damit `/file/<hash>/legacy` aufruft, bekommt **404**,
obwohl alles in Ordnung ist. Das hat in einer Session zweimal auf eine falsche Fährte geführt.

**Hashes immer aus der laufenden API holen** (`POST /folder`), nie aus der Datenbank.

## Platzhalter erkennen: drei Fälle, nicht einer

Windows Media Player hinterlässt `Track 07`, `Neuer Künstler (109)`, `Neuer Titel (100)`.
Wer nur auf solche **Texte** prüft, erwischt zwei Drittel der Fälle nicht:

| Fall | Im Tag steht | Bibliothek zeigt |
|---|---|---|
| Platzhalter-Text | `"Track 07"` | Track 07 |
| Tag leer | `""` | aus dem Dateinamen abgeleitet |
| Tag fehlt ganz | *(kein Feld)* | `Unknown` |

Die letzten beiden Fälle kosteten je einen Nachzieh-Durchlauf: erst 4 Alben, die sich vom
Album gelöst hatten (fehlendes `album`), dann 85 Tracks ohne Interpret. **Alle drei Fälle in
einem Durchgang abfragen.**

## Ableitungsregeln, die sich bewährt haben

- **Titel aus dem Dateinamen**, führende Tracknummer entfernt. Aber: Manche Dateinamen tragen
  den Platzhalter selbst (`Genesis - 03 - Track  3.ogg`). Ein Regex nur am Stringanfang lässt
  53 solcher Fälle durch — auch **am Ende** prüfen (`\b(track|spur|titel)\s*\d+\s*$`).
- **Interpret aus der Pfadebene** unterhalb des Musikordners, Sortierpräfix weg
  (`800-Red Hot Chili Peppers` → `Red Hot Chili Peppers`).
  ⚠️ **Nur, wenn die Pfadebene ein Interpret ist.** `500-Dream.Corp` ist ein *Label*-Ordner (die
  Bandcamp-Seite von Dream.Corp veröffentlicht auch CD, Webinar™, 汎用CAD …). Ein WAV-Nachzug
  schrieb dort allen WAVs `Dream.Corp` als Interpret und Album-Artist — die sechs CD-Alben
  zerfielen in je eine MP3-Hälfte (CD) und eine WAV-Hälfte (Dream.Corp). Vorher die MP3-Zwillinge
  im selben Ordner fragen; sie tragen die Bandcamp-Tags.
- **Album aus dem Ordner — nur wenn es einen Albumordner gibt.** Liegen die Dateien direkt im
  Interpretenordner, wird sonst der Interpretenname zum Albumtitel (24 Weezer-Dateien).

## ⚠️ Ohne Interpret-Tag liest der Indexer den Dateinamen — die Tracknummer darf kein Interpret sein

Fehlen `artist` **und** `albumartist`, zerlegt `taglib.extract_artist_title` den Dateinamen an
` - `. Bis 2026-10-02 wurde `01 - Titel` dabei als „Interpret – Titel" gelesen: Interpret `01`,
`02` … — und weil der Album-Artist in den albumhash eingeht, zerfiel jedes Album in **ein Album
pro Track** (Saving Private Ryan, Manor Lords, Evil Genius, Mavi; 38 Dateien). Eine rein
numerische erste Hälfte gilt seitdem als Tracknummer. Fehlt nur **einer** der beiden Tags, ist
nichts zu tun: der andere springt ein.

Seit 2026-10-02 zusätzlich: Eine **null-gepolsterte** Nummer vor Text (`05 Dark - Light`) ist
ebenfalls Tracknummer, der Bindestrich gehört zum Titel. Ohne führende Null bleibt es Interpret
(`50 Cent`, `3 Doors Down`). Zweite Falle in derselben Funktion: Sie bekommt schon den **Stem**
und schnitt trotzdem noch eine „Endung" ab — `01. Intro` wurde zu `01`.

⚠️ **Eine Parser-Änderung erreicht den Bestand nicht** (anders als eine Bereinigung im Modell,
siehe oben — die greift bei jedem Start). Der Scan liest eine Datei nur neu, wenn
sich ihr `last_mod` ändert — die 455 Titel, die der Doppel-Schnitt verstümmelt hatte („090",
„H.A.M"), standen nach dem Fix weiter so da. Bestand gezielt nachziehen, und zwar per
`/metadata/album/apply` (Dateipfad): der neue Titel ändert den trackhash, der Weg zieht
Playlists/Favoriten mit. Ein erzwungener Voll-Rescan täte das **nicht**.

⚠️ `CD - Album - 01 Titel` ist **kein** Lesefehler: Bei Dream.Corp heißt der Künstler wirklich
„CD" (Bandcamp-Tag). Vor einer Massenkorrektur die Rohtags der Datei ansehen (`ffprobe`), nicht
nur, was die Bibliothek anzeigt.

**Prüfliste** (`lib/library_audit.py`, Einstellungen → MusicBrainz → *Check library*): findet
zerfallene Alben, Nummern als Interpret, Platzhalter. Live aus dem RAM-Store, also nach jedem Scan
aktuell. Schreibt nur auf Klick, und „Merge" ändert nur den Album-Interpreten (nicht im
trackhash), per Dateipfad. Ein Album-Titel, der nur der Ordnername ist, zählt **nicht** als
zerfallen — sonst steht jeder Sammelordner loser Singles auf der Liste.

Beim Nachziehen per Skript auf den **Schaden** filtern (beide Tags leer), nicht auf die
Namensform `NN - Titel` — sonst überschreibt man Nachbardateien, die schon richtig getaggt waren.

## ⚠️ `album_artist` geht in den albumhash ein

`albumhash = create_hash(album, *albumartists)`. Ein falscher Album-Artist spaltet das Album,
auch wenn Albumtitel und Interpret stimmen: Bei *All That You Can't Leave Behind* trugen 10 von
11 Dateien `Neuer Künstler (4)` als Album-Artist — das Album zerfiel in zwei Teile, obwohl der
Albumname überall identisch war.

Der Hash **ignoriert Satzzeichen und Groß-/Kleinschreibung** (`create_hash` wirft alles
Nicht-Alphanumerische weg). Ein fehlender Apostroph ist also harmlos, ein Buchstabendreher
(`Josjua` vs `Joshua`) nicht.

## ⚠️ `Track.extra` hält rohe Tag-Werte — und ihre Form hängt vom Leser ab

`extra` ist alles, was `taglib.py` aus `tags.as_dict()` nicht selbst einsortiert. tinytag 2
liefert dort **jedes Feld als Liste von Strings** (`"track_total": ["12"]`), Zeilen aus der
tinytag-1-Zeit tragen nackte Zahlen — beide stehen in derselben Bibliothek nebeneinander. Ein
`int(extra.get(...))` crasht also an jeder neu indexierten Datei mit „Track 1/12"-Tag (Picard
schreibt das standardmäßig): `POST /album` antwortete für ganze Bibliotheken mit 500, im Client
sichtbar als `Cannot read properties of undefined (reading 'image')`.
Zahlen aus `extra` immer über
`utils/parsers.py::tag_int()` lesen; Vorbilder für Strings: `Track.explicit`, `Lyrics.__init__`.

## Was der Indexer stillschweigend überspringt

Beides erzeugt Musik, die auf der Platte liegt und in der Bibliothek fehlt — ohne Fehlermeldung
an der Oberfläche:

- **Dateinamen mit führendem Punkt.** Sie gelten als versteckte Systemdateien. Betraf eine Band,
  die wirklich `...Und Null Sekunden` heißt — 38 MB unsichtbare Musik. Umbenennen reicht; die
  Tags bleiben, damit der Name in der Bibliothek stimmt.
- **Beschädigte Dateien.** OGGs mit CRC-Fehlern werden übersprungen. Sie sind meist **nicht
  verloren**: `ffmpeg -err_detect ignore_err -i kaputt.ogg -c:a libvorbis -q:a <stufe>` schreibt
  sie neu, danach liest der Indexer sie. Von 12 beschädigten Dateien kamen 11 praktisch
  vollständig zurück (Verlust 0,03–17 s), eine verlor 59 s.
  Die Qualitätsstufe an der Quelle ausrichten, nicht pauschal wählen — die Bitraten lagen
  zwischen 190 und 500 kbps.

**Folgeeffekt beachten:** Reparierte Dateien kommen mit ihren alten Tags in die Bibliothek. Sie
waren bei früheren Tag-Durchläufen nicht dabei und brauchen einen eigenen Nachzug.

## ⚠️ Ein Release-Datum ist ein Kalendertag, kein Zeitpunkt (#391)

`taglib.parse_date` speichert „2020“ als 2020-01-01 00:00 **UTC**. Wer das Jahr mit
`datetime.fromtimestamp(...)` (Server) oder `new Date(...).getFullYear()` (Client) liest, bekommt
westlich von UTC **2019** — jedes Album mit reinem Jahres-Tag ein Jahr zu früh, der Dekaden-Chip
eines Artists bei „2020“ ein Jahrzehnt zu früh. Leser für Tag-Daten: Server
`utils/dates.tag_year()`, Client `utils/dates.ts::releaseYear()`. Echte Zeitpunkte (hinzugefügt,
gespielt) bleiben lokal (`formatDate`).

`parse_date` nimmt nur noch eine Jahreszahl vorn (mit Monat/Tag, wenn sie folgen) oder eine
alleinstehende vierstellige Jahreszahl. `pendulum.parse(strict=False)` machte aus „1“ den 1. des
**laufenden** Monats und aus „May 2019“ den heutigen Tag im Mai — solche Alben wanderten mit jedem
Scan. Ohne Jahr: `None`, der Indexer nimmt dann die mtime.

## ⚠️ Ein Rescan löscht nur, wofür er einen Beleg hat (#391)

`filter_modded` las „Datei lässt sich nicht stat'en" als „gelöscht" und fragte nie, ob der
Musikordner selbst da war: NAS offline, USB-Platte ab, Bind-Mount leer — der nächste Rescan
löschte **jede** `track`-Zeile dieses Ordners. Seitdem entscheidet `utils/filesystem.ScanScope`
je Zeile:

- Datei vom Scan gefunden → wird wie immer geprüft, egal wo sie liegt. Wichtig für Symlinks:
  der Scanner speichert den **aufgelösten** Pfad, der zu keinem Wurzel-Präfix passen muss —
  nach Präfix allein flogen solche Zeilen bei jedem Scan raus und wurden neu getaggt.
- Wurzel, unter der der Scan **nichts** fand, oder Ordner, den er nicht auflisten konnte
  (`run_fast_scandir(unreadable=…)`, z. B. ESTALE) → Zeile bleibt unangetastet (Warnung im
  Log). Ein wirklich geleerter Ordner behält seine Zeilen also, bis er aus den Einstellungen fliegt.
- Zeile außerhalb aller Wurzeln oder unter `excludeDirs` → fliegt raus. Das „außerhalb" aber
  **nur, wenn jede Wurzel geantwortet hat** — sonst könnte es die Offline-Wurzel unter anderer
  Schreibweise sein.
- Präfixe immer über `dir_prefix()` (aufgelöst wie der Scanner, genau ein `/` am Ende):
  `startswith("/music/Rock")` trifft sonst `/music/Rock and Roll/`. Derselbe Fehler steckte in
  `api/settings.get_child_dirs` (hätte mit dem neuen Aufräumen echte Zeilen gekostet) und in der
  Ordnerzählung `FolderStore.count_tracks_containing_paths`, die außerdem eine Wurzel hinter
  einem Symlink mit 0 zählte.

Ein Ordner hat **eine** Reihenfolge, wenn keine Sortierung gewählt ist:
`sortlib.folder_order`, also `added` (oben, „Hinzugefügt ist nicht geändert“) und danach der Pfad. Diese Reihenfolge
gilt für die Ordneransicht, „Play“ auf der Ordnerkarte (`/folder/tracks/all`) und „als Playlist
speichern“. Früher sortierte die Ansicht nach der mtime auf der Platte, die anderen beiden nach
`last_mod`. Bei Gleichstand entschied einmal die Verzeichnisreihenfolge, einmal die Hash-Reihenfolge,
und ein aus einem Zip entpacktes Album ist ein einziger Gleichstand (#391).

**Grenze:** Belegt wird pro Wurzel. Ein Share, der *unterhalb* einer antwortenden Wurzel hängt
(`/media/nas` unter `/media`), ist abgehängt ein leerer Ordner wie jeder andere — seine Zeilen
fliegen wie früher. Shares deshalb selbst als Wurzel eintragen.

Wer einen neuen Lösch- oder Aufräumpfad über die Bibliothek baut: erst „war die Quelle
erreichbar?", dann löschen. Fehlende Antwort ist kein leeres Ergebnis.

## MusicBrainz-Abgleich: über die Laufzeit, nie über den Titel

Titel und Tracknummern sind bei solchen Alben ja gerade das Kaputte. Was trägt:

1. Trackzahl muss exakt stimmen, jede Laufzeit innerhalb weniger Sekunden, der Schnitt deutlich
   darunter. Gute Treffer lagen bei **0,0 s** — bei einer echten Übereinstimmung ist die
   Abweichung winzig, nicht „ganz okay".
2. **Prüfanker nutzen:** Dateien, die schon einen echten Titel haben, müssen zum
   MusicBrainz-Titel derselben Position passen. Bei *Room on Fire* bestätigten neun vorhandene
   Titel die Zuordnung, sodass der zehnte zweifelsfrei war.
3. **Mehrere Pressungen passen fast immer.** Dann prüfen, ob sie dieselben Titel tragen — sonst
   ist die Wahl geraten. Verglichen wird der **Kern ohne Klammerzusätze**:
   `Mama (live from Frankfurt/2007)` und `Mama (Frankfurt)` sind derselbe Song.
4. **Zuordnung über die Tracknummer**, nicht über die Dateisortierung — nur so überlebt sie
   Lücken, wenn der Sammlung ein Stück fehlt.

**Grenze des Verfahrens:** Bei einer Zusammenstellung ohne Albumbezug bringt die Laufzeit
nichts. 378 Weezer-Releases passten nicht, und die Einzelsuche lieferte pro Datei 11–24
mögliche Titel — bei einer Band mit dreistelliger Songzahl ist die Dauer kein Beweis. Ein vom
Nutzer genannter Titel (`Buddy Holly`) lag sogar 3 s neben der Datei und wäre nie gefunden
worden. Dort hilft nur akustisches Fingerprinting oder Nachfragen.

## Arbeitsweise, die sich als richtig erwiesen hat

- **Scope zuerst eingrenzen.** Ein Filter über die ganze Bibliothek fand 4664 „Platzhalter" —
  über 3000 davon Spiele-Soundtracks und Soundeffekte, wo `Unknown` der korrekte Zustand ist.
  Nur `100-Musicians` ist echte Musik.
- **Am sichtbaren Schaden ansetzen, nicht am theoretisch möglichen.** Ein Durchlauf über alle
  Dateien hätte 1992 Dateien angefasst, um ein ableitbares `albumartist` zu ergänzen, das
  niemanden stört. Ausgangspunkt ist, was die Bibliothek als Platzhalter *anzeigt*: 85 Tracks.
- **Backup vor dem ersten Schreibvorgang**, nicht am Ende der Schleife. Ein Abbruch nach zwei
  Dateien hinterließ Änderungen ohne Sicherung.
- **Trockenlauf ist Pflicht.** Jede der drei Regelverschärfungen oben kam aus einem Trockenlauf,
  bevor eine Datei angefasst wurde.

## ⚠️ Auf den Rescan richtig warten

```bash
# falsch: findet den Log-Eintrag des VORHERIGEN Scans und bricht sofort ab
until journalctl -u aivinnet --since "3 min ago" | grep -q "Loading artists... Done!"; do …

# richtig: Zeitmarke vor dem Trigger setzen
MARKE=$(date "+%Y-%m-%d %H:%M:%S"); sleep 1
curl … /notsettings/trigger-scan
until journalctl -u aivinnet --since "$MARKE" | grep -q "Loading artists... Done!"; do …
```

Mit der falschen Variante meldet die anschließende Prüfung unveränderte Zahlen und sieht aus
wie „Änderung hat nicht gegriffen".

## WAV-Dateien taggen

⚠️ **Eine WAV kann ZWEI Tag-Blöcke tragen, und tinytag mischt sie.** Von ffmpeg konvertierte
Dateien haben einen RIFF-`LIST/INFO`-Block mit den Quell-Tags; ein später per mutagen
angelegter ID3-Chunk kommt *dazu*, statt ihn zu ersetzen. tinytag liefert dann beide Werte
(`artist: ["CD", "Dream.Corp"]`): der erste wird Interpret, der zweite liegt unsichtbar in
`Track.extra`. Einen Album-Artist kennt INFO gar nicht — der kommt allein aus ID3-`TPE2`. `WAVE(fp).tags`
zeigt **nur** den ID3-Teil; prüfen also mit `TinyTag.get(fp).as_dict()`, nicht mit mutagen.
Reparatur über `PUT /track/<hash>/tags` (mit `filepath`) schreibt den ID3-Teil sauber neu.

`MutagenFile(pfad, easy=True)` liefert bei WAV ohne vorhandenen Tag-Block kein beschreibbares
Objekt, und ein separates `ID3(pfad)` wirft `ID3NoHeaderError` — bei WAV sitzt der ID3-Block in
einem eigenen Chunk, nicht am Dateianfang. Der Weg führt über die `WAVE`-Klasse:

```python
w = WAVE(fp)
if w.tags is None:
    w.add_tags()
w.tags.setall("TPE1", [TPE1(encoding=3, text=[interpret])])
w.save()
```

Bei anderen Formaten reicht `add_tags()` + `save()` — danach die Datei aber **neu öffnen**,
sonst greift das vereinfachte Interface nicht (`'…' not a Frame instance`).
