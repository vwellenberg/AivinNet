---
paths:
  - "src/aivinnet/plugins/**"
  - "src/aivinnet/lib/recipes/**"
  - "src/aivinnet/lib/home/**"
  - "src/aivinnet/crons/**"
  - "src/aivinnet/store/homepage*.py"
  - "src/aivinnet/api/home/**"
---

# Empfehlungen / Home — woher die Vorschläge kommen

**Empfehlungen rechnet die App selbst, aus der eigenen Hörhistorie** (`ScrobbleTable`, pro User)
plus der eigenen Bibliothek. Seit #138 gibt es sechs Zeilen, die über „was lief zuletzt“
hinausgehen (Abschnitt unten). Kein Cloud-Anteil, kein Dienst, der wegsterben kann. Offen in #138
bleibt der Vergleich externer Dienste (ListenBrainz & Co.) als **optionale** Anreicherung.

## Was es gab: Mixes (entfernt)

Die Mixes hingen an `smcloud.mungaist.com` (Swing-Music-Cloud). Ihre Startseiten-Zeilen
„Mixes for you“, „Because you listened …“ und „Artists you might like“ wurden aus den
Ähnlichkeitslisten gerendert, die in jedem Mix gespeichert waren. Der Dienst antwortete ab
31.05.2026 durchgehend mit **HTTP 502**. Daraufhin wurde das Feature komplett entfernt: Plugin,
Cron, Routen und Modell (#76/#77). `migrations/drop_mixes.py` löscht beim Start die Tabelle `mix`
und leert die `mix:`-Quellen der Scrobbles. Die Scrobbles selbst bleiben, denn das sind echte
Plays.

**Lehre daraus, Kriterium für #138:** Kein externer Dienst darf die einzige Quelle einer Zeile
sein. Die Zeilen liefen noch Wochen nach dem Tod des Dienstes, weil sie vom Zwischenspeicher
lebten, und niemand bemerkte den Ausfall.

## Was Home heute zeigt

Die Crons stehen in `crons/__init__.py` und laufen in einer `schedule`-Schleife, jeder Job hinter
`_guarded`.

- **„Continue listening“** (`lib/recipes/continuelistening.py`): bis zu drei Karten. Das sind die
  zuletzt gehörten, nicht beendeten Alben bzw. Playlists aus den neuesten 200 Scrobbles mit
  `al:`/`pl:`-Quelle. Gefüllt wird beim Start, danach nach jeder Wiedergabe neu.
- **„Rediscover“**: Alben mit ≥ 5 Plays insgesamt und keinem in den letzten 60 Tagen, täglich.
  Dazu der Button „Surprise me“ (`GET /nothome/surprise`, zufälliges Album, RAM).
- **„On this day“** (stündlich, Server-Zeitzone): derselbe Kalendertag in den letzten 15 Jahren.
  Gezeigt werden die **Alben der gehörten Tracks**, nicht die Quellen — vorher wurde ein Tag in
  einer Playlist zu einer einzigen Playlist-Karte. Pro Jahr meistgehört zuerst, jedes Album
  einmal (mit seinem jüngsten Jahr), Karte „2024 · 8 plays“. Der Untertitel ist pro User
  (`PlayableEntry.meta`): Datum des jüngsten Jahres mit Plays plus Tagesbilanz („2 h 40 min ·
  mostly Dream.Corp · in the evening“). **„Play that day“** spielt diesen Tag in der Reihenfolge,
  in der er lief, als erzeugte Playlist `onthisday` (`lib/home/onrepeat.py`) — vom jüngsten Jahr,
  dessen Plays **noch in der Bibliothek** sind (nach einem Retag kann das neueste Jahr leer
  sein). Sie steht in `homerows.DATED_PLAYLISTS`: ein Play daraus macht **keine** Karte in
  „Recently played“, die würde morgen einen anderen Tag spielen.
- **Recently played** (lokale Scrobble-Aggregation, neu nach jedem Scrobble) und **Recently
  added** (Library-Timestamps, neu nach jedem Scan in `lib/index.py`): beide auch beim Start
  gefüllt.

Die Regeln und Schwellen stehen in `lib/home/homerows.py`, absichtlich ohne DB- und
Store-Imports, damit sie in der schnellen Testbahn testbar bleiben. Die Routinen dazu liegen in
`lib/recipes/homerows.py`.

### Die Empfehlungszeilen (#138)

Regeln in `lib/home/discover.py` (ebenfalls frei von DB und Stores, strikt unter mypy), Routinen
in `lib/recipes/homerows.py`. Reihenfolge auf Home: Continue → **Because you listened** → **On
repeat** → Recently played → **Your weekday evenings** → **Never played** → **Artists you might
like** → **Forgotten favorites** → Rediscover → On this day → Collections → Recently added.

- **„Because you listened to <Artist>“** (alle 6 h): Seed ist der Album-Artist mit den meisten
  Plays der letzten 7 Tage, sonst der letzten 30 (Platzhalter wie „Various Artists“ nie).
  „Ähnlich“ heißt: **lief in derselben Hörsitzung** (Pause > 30 min = neue Sitzung). Jede Sitzung
  mit dem Seed gibt jedem anderen Album darin 1/√(Zahl der anderen Alben): drei Alben an einem
  Abend sagen mehr als achtzig im Tages-Shuffle einer großen Playlist. Mindestens 2 gemeinsame
  Sitzungen, nichts aus den letzten 7 Tagen (steht schon in „Recently played“), ein Album pro
  Artist, keine ungetaggten Alben („Unknown“). Titel und Link (`/artists/<seed>`) sind **pro
  User** (`PersonalTitleEntry.meta`) und verschwinden mit dem Seed.
- **„On repeat“** (stündlich): Tracks mit ≥ 3 Plays in 7 Tagen und mindestens dem Doppelten
  ihres Wochenschnitts der 8 Wochen davor. Sortiert nach Plays **über** dem Schnitt (Trend, nicht
  Charts), höchstens 2 pro Album. Jede Karte trägt `home: {weeks, factor}` (8 Wochen + diese,
  Faktor gegen den Schnitt, `None` unter einem Play pro Woche — dort sagt der Text „rarely before“) und zeigt daraus das „N× usual“-Badge
  (`client/src/components/HomeView/RepeatFactor.vue`; die Mini-Balken sind seit 2026-10-09 weg, `weeks` bleibt in der API). Die Zeile ist **auch eine Playlist**
  (`onrepeat`, `lib/home/onrepeat.py`, aus dem RAM-Store der Zeile): „Play all“ spielt sie, der
  Titel öffnet sie. ⚠️ Eine neue erzeugte Playlist gehört in **`lib/home/generated_playlists.py`** (das
  Register, das Endpoint und Home-Karten lesen) **und** in `homerows.CUSTOM_PLAYLISTS` (nur Namen,
  für die schnelle Testbahn). Ein Test in `tests_api/test_home_discover_api.py` prüft, dass beide
  übereinstimmen — fehlt sie in einem, 404t ihre Seite oder sie verschwindet aus „Recently
  played“.
- **„Never played“** (alle 6 h, täglich neu gezogen): Alben ohne einen einzigen Play des Users.
  Punkte = 2 × Anteil des Album-Artists an den eigenen Plays + Anteil des bestgehörten Genres.
  Gezogen aus den besten 3 × 15 (höchstens 2 pro Artist), Zufall mit dem Tag als Seed, damit die
  Zeile nicht ewig dieselbe bleibt. Erst ab **50 Plays** Historie (vorher ist fast alles
  ungehört, die Zeile wäre nur die Bibliothek). Alben von „Unknown“ (ungetaggt) fliegen raus,
  Sampler von „Various Artists“ nicht. Button „Play one“ im Client (zufälliges Album der
  angezeigten Karten). **Genre-Chips** über der Zeile: die meistgehörten Genres des Users mit
  mindestens 2 ungehörten Alben (höchstens 4), jeder mit eigenen Items in der Antwort
  (`ChipsEntry`) — Umschalten braucht keinen Request. Im Client gestrichelter Rahmen und
  „0 plays“-Marke auf dem Cover (CSS über die Zeilenklasse `home-row-never_played`).

- **„Your weekday evenings“** (stündlich, Titel nach dem Zeitfenster): Woche geteilt in
  Werktag/Wochenende × Morgen (ab 5 Uhr) / Nachmittag (11) / Abend (17) / Nacht (22). Alben mit
  ≥ 3 Plays im aktuellen Fenster (letzte 180 Tage), deren Anteil dort mindestens das 1,5-Fache
  ihres Gesamtanteils ist — sonst ist es ein Liebling zu jeder Stunde. Nichts aus den letzten
  24 h, keine ungetaggten Alben, höchstens 2 pro Artist („Various Artists“ zählt nicht). Die
  Stunden nach Mitternacht gehören zur Nacht davor (Samstag 1 Uhr = Freitagnacht). Läuft **zur
  vollen Stunde** (`on_the_hour`), nicht „jede Stunde ab Serverstart“ — sonst hinge der Titel
  bis zu 59 Minuten hinter dem Zeitfenster. ⚠️ **Server-Zeitzone**, wie „On this day“: der Titel
  ist für alle User gleich und wird global gesetzt, zusammen mit den Items.
- **„Artists you might like“** (alle 6 h): Artists aus den **eigenen Playlists** des Users, die
  dort neben seinen 10 meistgehörten Artists (90 Tage) stehen, die er selbst aber weniger als
  5-mal gespielt hat. Gewicht pro Playlist 1/√(Zahl der anderen Artists) — eine Handvoll-Playlist
  zählt mehr als eine „alles“-Liste. Bei Samplern zählen die Track-Artists statt „Various
  Artists“ (`TrackFacts.track_artists`). Ohne Playlists keine Zeile.
- **„Forgotten favorites“** (alle 6 h): Favoriten-Tracks ohne Play in den letzten 60 Tagen (oder
  nie). Die früher meistgespielten zuerst, dann die am längsten stillen; höchstens 2 pro Album.
  Die Favoriten kommen aus dem RAM (`fav_userids` an den Tracks), nicht aus der DB.

⚠️ **Eine Routine, die über User läuft, fragt zwischen ihnen `crons.cron_stopping()`** (Import in
der Funktion, sonst zirkulär). `stop_cron_jobs` wartet nur begrenzt; ein Job, der beim Schließen
der DB noch in SQLite steckt, lässt den Prozess mit SIGSEGV sterben (CLAUDE.md, „STOPPEN“).

⚠️ **`Album.genrehashes` ist ein String, keine Liste** — der Scanner speichert die Hashes mit
Leerzeichen verbunden (`tagger.py`), `Track.genrehashes` dagegen ist eine Liste. `tuple()` des
Album-Felds zerlegt es in Zeichen, und kein Genre passt mehr: „Never played“ nannte deshalb seit
#396 nie ein Genre als Grund. Album-Genres aus `album.genres` (Liste von Dicts) lesen, und in
Fixtures die echte Form verwenden.

⚠️ **Jede Routine loggt ein leeres Ergebnis mit Grund** (kein Seed, zu kurze Historie, …): eine
leere Zeile sieht sonst genauso aus wie eine, die nie gelaufen ist.

⚠️ **Scrobbles mit Trackhashes, die nicht mehr in der Bibliothek sind, zählen nirgends** — auch
nicht für die Historien-Schwelle von „Never played“. Nach einer großen Tag-Korrektur (Hashes
ändern sich, `track-tags.md`) kann eine Zeile deshalb verschwinden, bis die Scrobbles mitgezogen
sind. Die Reihen „Top artists this week/month“ sind von Home entfernt, die
Stats-Seite hat eigene Charts (`utils/stats.py`, sortiert nach `playduration`).

**Ähnliche Künstler auf Artist- und Album-Seiten** kommen aus `notlastfm_similar_artists`
(`SimilarArtistTable`), gefüllt von Last.fm, aber **nur** mit `enableOnlineMetadata` (ab Werk
aus). Auf Home erscheinen sie nicht.

Das **Last.fm-Plugin** (`plugins/lastfm.py`) ist **nur** Scrobble-Export (optional), keine
Empfehlungsquelle.

⚠️ **Privacy:** Wer eine neue externe Quelle für Empfehlungen ergänzt, ändert damit das
Datenschutz-Versprechen. Die Quelle gehört dann unten in die Tabelle und in die CLAUDE.md
(Abschnitt „Empfehlungen / Home“). Muster für den Weg nach draußen: Host-Allowlist
(`ALLOWED_HOST_SUFFIXES` in `lib/coverart.py`), harte Deadline, nur im Cron, nie im Request-Pfad.

## Ausgehende Verbindungen im Überblick

Damit „sonst nichts“ nachprüfbar bleibt, steht hier die vollständige Liste. In diese Tabelle
wird jede neue Quelle eingetragen:

| Wohin | Was | Wann |
|---|---|---|
| `apic-desktop.musixmatch.com` | Titel + Artist im Klartext | Lyrics-Seite ohne lokale Lyrics (Neuinstallation: aus; Settings → Plugins) |
| `musicbrainz.org` / `coverartarchive.org` | Albumtitel + Album-Artist im Klartext | **nur auf Anforderung**: Cover holen, und seit #221 Titel/Nummern holen |
| Deezer / Last.fm | Artist-Namen | nur mit `enableOnlineMetadata` (ab Werk **aus**) |

`smcloud.mungaist.com` steht seit dem Rückbau der Mixes nicht mehr in dieser Liste. Im Code gibt
es keinen Aufruf mehr dorthin.

⚠️ **Die Dateinamen-Quelle des Metadaten-Dialogs (`source: "filenames"`) geht NIRGENDWOHIN.** Sie
liest die Pfade der eigenen Bibliothek und rechnet lokal. Deshalb ist sie auch die Antwort für
Alben, die man aus Datenschutzgründen nicht nachschlagen möchte. Wer die beiden Quellen in der UI
zusammenlegt, nimmt dem Nutzer genau diese Wahl.
