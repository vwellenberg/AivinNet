---
paths:
  - "src/swingmusic/models/track.py"
  - "src/swingmusic/models/album.py"
  - "src/swingmusic/utils/hashing.py"
  - "src/swingmusic/lib/tag*.py"
  - "src/swingmusic/lib/index.py"
  - "src/swingmusic/lib/folder_index.py"
  - "src/swingmusic/utils/filesystem.py"
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

**Vor jeder Tag-Änderung** also die Hashes je Dateipfad festhalten, nach dem Rescan erneut
holen und die Referenzen umziehen. Die Zuordnung läuft über den Dateipfad, der sich ja nicht
ändert:

```python
umzug = {vorher[fp]: nachher[fp] for fp in vorher
         if fp in nachher and vorher[fp] != nachher[fp]}
# dann playlist.trackhashes, favorite.hash und scrobble.trackhash durchziehen
```

## ⚠️ Die Hashes in der Datenbank sind nicht die des laufenden Servers

Die `track`-Tabelle trägt teils noch Hashes aus der alten SHA1-Ära; `create_hash` rechnet
längst `xxh3_64`. Der `TrackStore` im RAM hat die neuen, die DB die alten — für dieselbe Datei.

Wer Hashes aus `swingmusic.db` liest und damit `/file/<hash>/legacy` aufruft, bekommt **404**,
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
- **Album aus dem Ordner — nur wenn es einen Albumordner gibt.** Liegen die Dateien direkt im
  Interpretenordner, wird sonst der Interpretenname zum Albumtitel (24 Weezer-Dateien).

## ⚠️ `album_artist` geht in den albumhash ein

`albumhash = create_hash(album, *albumartists)`. Ein falscher Album-Artist spaltet das Album,
auch wenn Albumtitel und Interpret stimmen: Bei *All That You Can't Leave Behind* trugen 10 von
11 Dateien `Neuer Künstler (4)` als Album-Artist — das Album zerfiel in zwei Teile, obwohl der
Albumname überall identisch war.

Der Hash **ignoriert Satzzeichen und Groß-/Kleinschreibung** (`create_hash` wirft alles
Nicht-Alphanumerische weg). Ein fehlender Apostroph ist also harmlos, ein Buchstabendreher
(`Josjua` vs `Joshua`) nicht.

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
