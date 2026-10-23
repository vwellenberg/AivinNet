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

Seit #526 gibt es wieder Mixes, diesmal **lokal** („Your mixes“, unten). Sie heißen als
Playlist `mix1` … `mix4`, nicht `mix:` — diese Quelle leert `drop_mixes.py` bei jedem Start.

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
  einmal (mit seinem jüngsten Jahr), Karte „2024 · 8 plays“. War der Tag der **erste** Play des
  Albums überhaupt, heißt die Karte „First heard · 2023“ und trägt den Stempel „1st time“ (#534):
  der Jahrestag einer Entdeckung, verlässlicher als ein Erscheinungsdatum (oft nur ein Jahr, ohne
  Tag die mtime). Ein Album, das an diesem Datum vor zwei Jahren entdeckt und letztes Jahr am
  selben Datum wieder gehört wurde, steht mit dem **Entdeckungsjahr** da, nicht mit dem jüngsten
  (`rank_on_this_day(…, discovered=)`). Quelle ist der Erst-Play-Cache (`lib/first_play_cache.py`),
  nur gefragt, wenn es einen Tag zu zeigen gibt. ⚠️ Er kennt nur Plays von Tracks, die noch in
  der Bibliothek sind: Liegen ältere Plays unter einem Hash, den niemand mehr auflöst, gilt ein
  späterer Tag als „First heard“. Der Untertitel ist pro User
  (`PlayableEntry.meta`): Datum des jüngsten Jahres mit Plays plus Tagesbilanz („2 h 40 min ·
  mostly Dream.Corp · in the evening“). **„Play that day“** spielt diesen Tag in der Reihenfolge,
  in der er lief, als erzeugte Playlist `onthisday` (`lib/home/onrepeat.py`) — vom jüngsten Jahr,
  dessen Plays **noch in der Bibliothek** sind (nach einem Retag kann das neueste Jahr leer
  sein). Sie steht in `homerows.DATED_PLAYLISTS`: ein Play daraus macht **keine** Karte in
  „Recently played“, die würde morgen einen anderen Tag spielen.
- **Recently played** (lokale Scrobble-Aggregation, neu nach jedem Scrobble) und **Recently
  added** (`track.added`, neu nach jedem Scan in `lib/index.py`): beide auch beim Start
  gefüllt. ⚠️ Recently added liest **nicht** die mtime (`last_mod`): Mit ihr stand nach einer
  Tag-Reparatur der ganze `100-Musicians`-Ordner als „NEW MUSIC“ oben. Warum, und was jeder
  Schreibpfad mittragen muss: `track-tags.md`, „Hinzugefügt ist nicht geändert“.
  Die Zeile ist **für alle gleich** (gespeichert unter User 0), nur der Stempel „NEW · to you“
  ist pro User (#533): `RecentlyAddedHomepageEntry.get_items` setzt `home: {unheard: true}` auf
  jedes Album, von dem der User noch keinen Track gehört hat. Die Quelle ist derselbe
  Erst-Play-Cache wie bei „New to you“ auf Stats (`lib/first_play_cache.py`, gilt bis zum nächsten
  Play), also gibt es keine eigene Abfrage pro Aufruf. Der Stempel wird auf die **frisch
  zusammengesetzte** Karte gesetzt, nie auf die gespeicherten Items, sonst würde der Stempel eines
  Users für alle gelten.

Die Regeln und Schwellen stehen in `lib/home/homerows.py`, absichtlich ohne DB- und
Store-Imports, damit sie in der schnellen Testbahn testbar bleiben. Die Routinen dazu liegen in
`lib/recipes/homerows.py`.

### Die Empfehlungszeilen (#138)

Regeln in `lib/home/discover.py` (ebenfalls frei von DB und Stores, strikt unter mypy), Routinen
in `lib/recipes/homerows.py`. Reihenfolge auf Home: Continue → **Your mixes** → **Because you
listened** → **On repeat** → Recently played → **Your weekday evenings** → **Never played** → **Artists you might
like** → **Forgotten favorites** → Rediscover → **Almost complete** → On this day → Collections → Recently added.

- **„Your mixes“** (alle 6 h, #526; Regeln in `lib/home/mixes.py`, ebenfalls pur und strikt):
  bis zu vier Playlist-Karten „Mix 1“ … aus den Sitzungen der letzten 180 Tage (ab 50 Plays).
  Gleiches Signal wie „Because you listened“, aber über alle Artists: Kante = gemeinsame
  Sitzungen (Gewicht 1/√(Artists der Sitzung − 1)), **Nähe** = Kante / √(Sitzungen a ·
  Sitzungen b). Kerne sind die meistgehörten Artists (≥ 3 Plays), die einander **nicht** nahe
  sind (Nähe < 0,25); jeder andere Artist geht zum Kern, dem er am nächsten ist — erst ab Nähe
  0,1 (`MIX_MIN_MEMBER_AFFINITY`; ein einziger Tages-Shuffle liegt bei ~0,01). Ein Kern, dessen
  Gruppe unter 3 Artists bleibt, gibt seinen Platz ab und die Kerne werden neu gewählt —
  sonst blockierte er einen der vier Plätze. Mixes unter 8 Tracks fallen weg. Ein Mix nimmt die
  Artists reihum: ein bekannter Track (der meistgehörte **der 180 Tage** zuerst), dann ein nie
  gespielter (täglich neu gemischt; „nie“ heißt über die ganze Historie), höchstens 3 pro Album
  (Album immer aus `track_facts`), 30 Tracks. Die Karte nennt die drei stärksten Artists
  (`help_text`). Platzhalter und Artists ohne Seite sind nie Teil einer Gruppe, Sampler zählen
  für ihre Track-Artists.
  **Ein Mix wird über seinen Platz ausgeliefert** (`mix2` = zweiter Platz, `MixesEntry.mixes`
  pro User, `onrepeat.get_mix_playlist`) und **behält ihn, solange sein Kern bleibt**
  (`mixes.place_mixes`, Kern im Slot gespeichert) — sonst rückte nach einer weggefallenen
  Gruppe alles auf, und „Mix 2“ spielte unter altem Namen die Musik von „Mix 3“. Ein Platz ohne
  Mix ist ein **leerer** „Mix n“, kein 404. Nach einem Neustart (RAM leer) gilt wieder
  „stärkster zuerst“. Alle vier Ids stehen in `DATED_PLAYLISTS` (täglich neu gemischt).
- **„Because you listened to <Artist>“** (alle 6 h): Seed ist der Album-Artist mit den meisten
  Plays der letzten 7 Tage, sonst der letzten 30 (Platzhalter wie „Various Artists“ nie).
  „Ähnlich“ heißt: **lief in derselben Hörsitzung** (Pause > 30 min = neue Sitzung). Jede Sitzung
  mit dem Seed gibt jedem anderen Album darin 1/√(Zahl der anderen Alben): drei Alben an einem
  Abend sagen mehr als achtzig im Tages-Shuffle einer großen Playlist. Mindestens 2 gemeinsame
  Sitzungen, nichts aus den letzten 7 Tagen (steht schon in „Recently played“), ein Album pro
  Artist, keine ungetaggten Alben („Unknown“). Titel und Link (`/artists/<seed>`) sind **pro
  User** (`PlayableEntry.meta`) und verschwinden mit dem Seed. **„Play mix“** spielt die
  erzeugte Playlist `becauseyoulistened`: pro Album der Zeile **ein** Track, der meistgehörte
  des Users (`discover.because_mix`) — fünfzehn ganze Alben wären ein Tag. Mix, Titel und
  Karten werden zusammen gesetzt und verschwinden zusammen mit dem Seed.
- **„On repeat“** (stündlich): Tracks mit ≥ 3 Plays in 7 Tagen und mindestens dem Doppelten
  ihres Wochenschnitts der 8 Wochen davor. Sortiert nach Plays **über** dem Schnitt (Trend, nicht
  Charts), höchstens 2 pro Album. Jede Karte trägt `home: {weeks, factor}` (8 Wochen + diese,
  Faktor gegen den Schnitt, `None` unter einem Play pro Woche — dort sagt der Text „rarely before“) und zeigt daraus das „N× usual“-Badge
  (als Stempel auf dem Cover: `client/src/components/shared/CardStamp.vue`, generisch auch für andere Kachel-Hinweise; die Mini-Balken sind seit 2026-10-09 weg, `weeks` bleibt in der API). Die Zeile ist **auch eine Playlist**
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
  nie). Zuerst kommen die mit einem **Burst** (`strongest_phase`: die meisten Plays in einem
  3-Tage-Fenster, `is_burst`: mindestens 10 davon und mindestens 30 % aller Plays des Tracks). Die
  Karte sagt es dann: „24 plays · Aug 2025“ (eine Zeile auf der Karte, die Phase ist die
  stärkste 3-Tage-Spanne). Danach die früher meistgespielten, dann die
  am längsten stillen; höchstens 2 pro Album. Die Favoriten kommen aus dem RAM
  (`fav_userids` an den Tracks), nicht aus der DB. Ein Favorit ohne Bibliothekstrack fällt
  lautlos heraus — das ist die Lücke aus #433. Wie „On repeat“ auch eine Playlist
  (`forgottenfavorites`, Reihenfolge der Zeile): „Play all“, der Titel öffnet sie. Die Routine
  behält bis zu `FAVORITE_PLAYLIST_LIMIT` (100) statt 15 — die Zeile zeigt so viele, wie passen
  (`?limit=`), „Play all“ spielt alle.

- **„Almost complete“** (alle 6 h, #529; Regeln in `lib/home/almost_complete.py`, pur und
  strikt): Alben mit mindestens 4 Tracks, von denen der User mindestens 60 % je gehört hat und
  mindestens einen nie. **Die ganze Historie zählt**, anders als „Continue listening“, das nur
  abgebrochene Sitzungen unter den letzten 200 Plays kennt. Die nächsten am Ziel zuerst (wenigste
  fehlende, dann größerer Anteil), ungetaggte Alben nicht. Karte „3 songs to go“ mit Stempel
  „3 · to go“. **„Play the rest“** spielt die erzeugte Playlist `almostcomplete`: genau die
  nie gespielten Tracks, Album für Album in Album-Reihenfolge (`PlayableEntry.trackhashes`).
  Sie steht in `DATED_PLAYLISTS`, denn wer sie spielt, macht ihre Tracks zu gehörten. Aus
  demselben Grund zieht **jeder Scrobble** die Zeile im RAM nach (`almost_complete_played` →
  `after_play`): sonst stünde nach „Play the rest“ bis zum nächsten Lauf „2 songs to go“ auf einem
  durchgehörten Album, und der Knopf spielte dieselben Songs noch einmal.

**Der Grund steht schon auf der Karte** — die Hilfezeile über dem Titel ist `help_text` plus
`secondary_text` (beim Client `time`, `recover_items`): „2 sessions together · last March 2025“,
„you play Primus · never played“, „in 2 of your playlists“. Wer eine Empfehlungszeile baut,
schreibt den Grund dorthin; ein eigenes „Warum?“-Element braucht es nicht (#524).

**Welche Zeilen Home zeigt und in welcher Reihenfolge, entscheidet der User** (Settings → Home,
#532; `GET`/`PUT /nothome/layout`). Gespeichert wird pro User in `UserTable.extra["home_layout"]`,
gehalten im RAM (`HomepageStore.layouts`). Eine ausgeblendete Zeile setzt `GET /nothome` gar
nicht erst zusammen und schickt sie nicht — ⚠️ ihre Routine **läuft aber weiter**: Die Crons
rechnen pro Zeile, nicht pro User, und ein anderer User zeigt sie vielleicht. Wer eine teure Zeile
nur für Ausblender sparen will, muss das in der Routine lösen. Die Regeln stehen in `lib/home/layout.py` (pur, strikt): `DEFAULT_ORDER` ist die
Reihenfolge von Home ohne eigene Wahl, die Collections sind darin **ein** Block (`COLLECTIONS`),
und „Continue listening“ lässt sich aus-, aber nicht verschieben (`PINNED` — der Client zeichnet
sie ohnehin über allen Zeilen). ⚠️ **Eine neue Zeile gehört in `DEFAULT_ORDER`**, sonst baut Home
sie nie (`test_every_entry_has_a_place_in_the_order` hält Store und Reihenfolge zusammen). Ein
gespeichertes Layout, das sie noch nicht kennt, bekommt sie automatisch hinter die Zeile, der sie
standardmäßig folgt; Schlüssel, die keine Zeile mehr sind, fallen weg. Der Client schickt immer
die **ganze** Reihenfolge.

Drei Dinge, die beim Bauen aufgefallen sind:

- ⚠️ **`extra` ist ein geteilter Beutel, und `User.todict()` gibt ihn ganz heraus** — in jedes
  Token und jede `/auth/user*`-Antwort. Das Layout bleibt deshalb dort draußen
  (`models/user.HOME_LAYOUT_KEY`). Und wer `extra` liest, liest Schlüssel mit `.get()`: Ein
  gefülltes `extra` versprach bis dahin einen Vornamen, und die Login-Liste antwortete 500, sobald
  ein Konto ohne Vornamen sein erstes Layout speicherte.
- **Settings nennt eine Zeile bei `entry.name`, nicht bei `entry.title`.** Eine Routine darf den
  Titel umschreiben („For this time“ heißt stündlich nach dem Zeitfenster) — der Schalter darunter
  sähe dann aus, als blende er nur den Abend aus.
- **Das Gastkonto hat das Standard-Home:** Alle Gäste teilen *ein* Konto, also antwortet
  `PUT /nothome/layout` dort 403, und der Client blendet Settings → Home aus.

**„Not interested“ (#531)** im Kontextmenü einer Karte von „Never played“ (Alben) und „Artists you
might like“ (Artists): Beide Zeilen ziehen täglich aus denselben besten Kandidaten, ohne Markierung
kam eine ungewollte Karte also alle paar Tage wieder. Gespeichert pro User in einer **eigenen**
Tabelle `not_interested` (nicht `FavoritesTable` mit neuem Typ: deren Zähler und
Start-Mapping lesen jede Zeile; nicht `UserTable.extra`: das steckt in jedem Token). Gewirkt wird
an **zwei** Stellen, und beide sind nötig:

- **Beim Ausliefern** (`HomepageStore._row`, `NOT_INTERESTED_ROWS`): Home fragt die Tabelle bei
  jedem Aufruf (klein, indiziert) und lässt markierte Karten weg — so ist die Karte sofort weg und
  nach einem Undo sofort zurück, ohne auf die Routine zu warten. Die Zeile wird um so viele
  Einträge mehr angefragt, wie markiert sind, damit sie voll bleibt.
- **In der Routine** (`NeverPlayed`, `ArtistsYouMightLike`): Markiertes ist kein Kandidat, auch
  nicht für die Genre-Chips — sonst fehlte nach dem nächsten Lauf eine Karte, statt dass die
  nächste nachrückt.

⚠️ Die Hashes hängen an den Tags: `reference_migration.migrate_identity_references` zieht die
Markierungen bei jedem Retag mit (`migrate_not_interested`). Wer eine weitere Zeile markierbar
macht, trägt sie in `NOT_INTERESTED_ROWS` ein — im Server (`store/homepage.py`) **und** im Client
(`utils/homeRows.ts`); dazu der Filter in ihrer Routine. Im Client hängt der Menüeintrag über
`CardScroller`s `cardMenu` (provide/inject, `utils/cardMenu.ts`) an genau den Karten dieser Zeilen,
die Liste zum Zurücknehmen steht unter Settings → Home. Das Gastkonto markiert nicht (403).

**Welche Zeile spielbar ist, sagt der Server:** Der Eintrag im `HomepageStore` trägt
`playlist="<id>"`, und die Zeile schickt sie mit. Der Client baut daraus den Abspiel-Knopf und
den Link des Titels (ein `url` des Servers geht vor — „Because you listened“ bleibt auf dem
Artist). Eine neue spielbare Zeile ist also: Getter in `onrepeat.py`, Eintrag in
`GENERATED_PLAYLISTS` und `CUSTOM_PLAYLISTS`, `playlist=` am Store-Eintrag; nur ein anderer
Knopftext als „Play all“ braucht noch `PLAY_BUTTONS` in `client/src/utils/homeRows.ts`.
`test_every_row_playlist_is_one_the_server_generates` hält Store und Register zusammen.

⚠️ **Eine Zeile, deren Inhalt am Zeitpunkt hängt, gehört in `DATED_PLAYLISTS`** — sonst macht ein
Play daraus eine „Recently played“-Karte, die morgen etwas anderes spielt. Das gilt für
`onthisday` (ein Tag), `becauseyoulistened` (der Seed der Woche; die Karte hieße
„Because you listened to Primus“ und spielte nach dem nächsten Lauf einen anderen Artist) und
`mix1` … `mix4` (täglich neu gemischt).

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
