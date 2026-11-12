# AivinNet für Android Auto (Prototyp)

Eine kleine native Android-App, die **nur einen Zweck** hat: den AivinNet-Server im Auto
spielbar machen. Auf dem Telefon gibt es einen Anmeldebildschirm, mehr nicht. Die eigentliche
Arbeit macht ein Media3-`MediaLibraryService`; Android Auto baut seine Oberfläche selbst aus dem
Browse-Baum auf.

- **Baum:** Mixes · Playlists → Playlist → Titel (Auswahl setzt die ganze Playlist als Warteschlange)
- **Streaming:** `GET /file/<trackhash>/legacy` mit Bearer-Token, Token-Refresh bei 401
- **Offline:** markierte Mixes und Playlists werden aufs Telefon geladen und spielen auch ohne Netz (unten)
- **Scrobbles:** `POST /logger/track/log` für jeden Titel, der mindestens 5 s lief; was ohne Netz
  nicht ankommt, wird gespeichert und nachgereicht
- **Bewertung:** Im Player gibt es einen Knopf (Stern), der den laufenden Titel mit 5 bewertet. Ein
  zweiter Druck auf einen Titel mit 5 entfernt die Bewertung. Der Knopf zeigt den Stand als gefüllten
  Stern („Mit 5 Sternen bewertet“) oder leeren Stern („5 Sterne geben“). Unten: Offline-Verhalten
- **Noch nicht:** Cover (der Bild-Endpoint braucht den Authorization-Header, den das Auto nicht
  senden kann), Suche, Sprachbefehle

## Bauen

Voraussetzungen: JDK 21, Android SDK (`ANDROID_HOME`, Plattform `android-37.2`).

```bash
cd android
./gradlew assembleDebug testDebugUnitTest lintDebug
```

Das APK liegt danach unter `app/build/outputs/apk/debug/app-debug.apk`.

## Installieren

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Oder das APK aus dem CI-Lauf (Artefakt `aivinnet-auto-debug-apk`) auf das Telefon kopieren und
öffnen. Dafür muss die Installation aus unbekannten Quellen erlaubt sein.

Dann die App öffnen, Server-URL, Benutzername und Passwort eingeben und **Anmelden** drücken.
Die Anmeldung gilt für das Auto, bis man auf dem Telefon **Abmelden** drückt; ein Funkloch beim
Token-Refresh meldet **nicht** ab, nur eine Ablehnung durch den Server (401/422).

⚠️ **Die Server-URL muss unterwegs erreichbar sein.** Im Auto hängt das Telefon im Mobilnetz,
nicht im Heim-WLAN — eine LAN-Adresse (`http://192.168.…:1970`) funktioniert dort nicht. Also die
Adresse eintragen, unter der der Server von außen erreichbar ist (Domain, VPN o. ä.). Für einen
ersten Test zu Hause im WLAN geht die LAN-Adresse.

⚠️ **Debug-APKs aus dem CI sind bei jedem Lauf anders signiert.** Ein neueres APK lässt sich dann
nicht über das alte installieren („App nicht installiert“): alte Version deinstallieren und neu
anmelden. Ein fester Signierschlüssel kommt mit dem Release-Build.

## In Android Auto anzeigen (Sideload)

Eine nicht aus dem Play Store stammende App taucht in Android Auto nur auf, wenn der
Entwicklermodus an ist:

1. Android Auto öffnen und in den Einstellungen auf **Version** tippen, etwa 10-mal, bis
   der Entwicklermodus aktiv ist.
2. Im ⋮-Menü **Entwicklereinstellungen** öffnen.
3. **Unbekannte Quellen** aktivieren.

Danach erscheint „AivinNet“ unter den Medien-Apps im Auto. Wenn die App als „angemeldet nicht
möglich“ erscheint, auf dem Telefon neu anmelden.

## Offline (Funklöcher im Auto)

Markierte Mixes und Playlists werden aufs Telefon geladen und bleiben aktuell. Im Auto spielen sie
dann auch ohne Netz.

- **Markieren:** In der App unter der Anmeldung den Abschnitt **Offline** öffnen und den Schalter
  neben der Liste einschalten. Die Änderung startet sofort einen Abgleich.
- **Laden:** Standardmäßig nur über unbegrenztes WLAN. Der Schalter **Auch über Mobilfunk laden**
  erlaubt Mobilfunk. Ohne Erlaubnis wartet die Übertragung, bis passendes Netz da ist.
- **Aktualisieren:** Alle 12 Stunden, beim App-Start und nach jeder Änderung wird jede markierte
  Liste frisch abgerufen. Neue Titel werden geladen, entfernte gelöscht. Ein Titel, der noch in einer
  anderen markierten Liste steht, bleibt. **Jetzt aktualisieren** erzwingt den Lauf.
- **Im Auto:** Der Ordner **Offline** listet die markierten Listen mit ihren heruntergeladenen Titeln
  und braucht kein Netz. Mixes und Playlists fallen bei fehlendem Netz auf ihre Offline-Kopie zurück.
  Dort stehen nur die Titel, die vollständig auf dem Telefon liegen; die übrigen fehlen, statt bei
  jedem Tipp zu scheitern.
- **Speicher** (alles App-privat, bei der Deinstallation weg):
  - `files/media/`: die Titel (SimpleCache, Schlüssel = Trackhash)
  - `files/offline.json`: welche Listen offline sind, mit dem Stand beim letzten Abgleich
  - `files/scrobble-queue.json`: Plays, die der Server noch nicht bekommen hat
  - `files/rating-queue.json`: Bewertungswünsche, die der Server noch nicht bekommen hat
  - Die Anzeige in der App zählt die fertigen Downloads. **Offline-Daten löschen** entfernt Titel
    und Markierungen. **Abmelden** lässt sie liegen: wer sich wieder anmeldet, hat sie sofort.
- **Konten:** Markierungen gelten pro Server und Benutzer, denn `mix1` ist für jeden Benutzer eine
  andere Liste. Die Titel selbst teilen sich alle Konten über den Trackhash.

**Warum der Cache nur gelesen wird:** Der Player liest den Cache, schreibt aber nie hinein. Nur der
Download-Dienst schreibt. Der Cache wird nie geräumt (`NoOpCacheEvictor`), damit ein Download im Auto
nicht verschwindet. Schriebe der Player Streams hinein, wüchse der Speicher mit jedem gehörten Titel
ohne Grenze.

**Scrobble-Warteschlange:** Ein Play, den der Server nicht annehmen kann (kein Netz), wird gespeichert
und mit dem ursprünglichen Zeitstempel nachgereicht, in Reihenfolge, beim nächsten App-Start, Abgleich
oder erfolgreichen Play. Antwortet der Server mit 400, 404 oder 422, ist der Play abgelehnt und fällt
weg. 401, 408, 429, 5xx und Netzfehler lassen ihn in der Schlange. Höchstens 5000 Plays; danach fallen
die ältesten weg.

**Bewertungs-Knopf (Details):** Der Knopf wirkt auf den Titel, der gerade läuft. Sein Stand kommt in
dieser Reihenfolge: eine noch wartende Änderung in der Warteschlange, sonst `GET /ratings/<trackhash>`
beim Titelwechsel. Ohne Netz und ohne wartende Änderung ist der Stand unbekannt, und ein Druck setzt 5.
Ein Druck ändert den Knopf sofort, dann geht die Änderung über `POST /ratings/set` bzw.
`POST /ratings/clear` an den Server. Antwortet der Server nicht, wandert sie in
`files/rating-queue.json`. Pro Konto und Titel gilt die letzte Änderung: Wer offline dreimal drückt,
schickt nur den Endstand. Abgleich ist wie bei den Scrobbles (Start der App bzw. des Dienstes, jeder
Sync). Antwortet der Server mit einem 4xx außer 401, 408 und 429 (z. B. 404, Titel unbekannt), wird die
Änderung verworfen; 401, 408, 429, 5xx und Netzfehler lassen sie in der Warteschlange.

**Grenzen:** Eine Playlist, die im Netz gestartet wurde, behält ihre volle Warteschlange, auch die
nicht geladenen Titel. Fährt man danach in ein Funkloch, bricht die Wiedergabe beim ersten nicht
geladenen Titel mit einem Fehler ab; Media3 überspringt ihn nicht von selbst. Wer offline startet,
bekommt dagegen nur die geladenen Titel in die Warteschlange.

## Aussehen

- **Look der Web-App** (Memphis, `client/src/assets/scss/_candy.scss`): Papiergrund mit Raster,
  Karten mit Tintenlinie und hartem Versatzschatten, türkiser Haupt-Knopf, gelbe/korallene
  Sticker; im Dunkelmodus der indigo Grund der Web-App (`values-night/colors.xml`).
- **App-Icon = der Pixel-Planet der Web-App** (`client/src/assets/icons/logos/logo-subspaceradio.png`)
  mit Tintenumriss und dem korallenen Mond seiner Hover-Umlaufbahn, als adaptives Icon mit
  Monochrom-Ebene. Erzeugt aus dem 28×28-Zellraster des Planeten, **nearest-neighbour**
  skaliert (sonst verschwimmen die Pixel) auf eine 72-Zellen-Fläche (1 Zelle = 1,5 dp), damit
  Planet *und* Mond im 66-dp-Sicherheitskreis jeder Launcher-Maske liegen — bei 2 dp/Zelle wurde
  der Mond von runden Masken abgeschnitten. `login_planet.png` ist dasselbe Raster in groß und
  wird ungefiltert gezeichnet (`login_planet_crisp.xml`).

## Technisches

- Kotlin (eingebaut in AGP 9, kein eigenes Kotlin-Plugin), Android Views (kein Compose), Media3 1.11.1,
  OkHttp 5, minSdk 26, targetSdk 36. **compileSdk 37.2**, weil `okhttp-android` 5.5.1 das per
  AAR-Metadaten verlangt; das Laufzeitverhalten bestimmt weiter targetSdk 36. Gradle 9 und AGP 9 gehen
  nur zusammen: AGP 8.13 konfiguriert unter Gradle ≥ 9.6 nicht mehr.
- Versionen: `gradle/libs.versions.toml`
- Die Logik, die sich ohne Android testen lässt (Media-IDs, JSON, Stream-URLs, Scrobble-Regel),
  liegt in reinen Klassen mit Tests unter `app/src/test`.
- **Wer die Bibliothek durchblättern darf** (`ControllerTrust.kt`): Der Dienst ist exportiert,
  damit Android Auto ihn binden kann — also kann sich jede App verbinden. Blättern dürfen nur das
  System, Android Auto (Paketname gegen die UID geprüft) und die App selbst; alle anderen
  (auch Bluetooth/AVRCP) bekommen nur Play/Pause/Weiter. ⚠️ Die Befehle stehen dort **explizit**:
  `AcceptedResultBuilder(session, controller)` gibt jedem Controller ohne System-Vertrauen
  Media3s *untrusted*-Vorgaben, und die sind nur lesend — Android Auto sähe den Baum, könnte
  aber nichts starten, und nicht einmal Pause ginge (geprüft im Quelltext von Media3 1.11.1).
- **Playlist-Cache** (`BrowseSupport.kt`, 10 min): Ein Tipp im Auto spielt genau die Liste, die
  angezeigt wurde. Mixes sind Fächer, die der Server neu befüllt — ohne Cache fände der Tipp den
  Titel nach einem Neuaufbau nicht mehr. Browse-Antworten sind auf 500 Einträge gekappt (Binder-
  Limit), die Warteschlange enthält trotzdem die ganze Playlist.
- **Unverschlüsselt:** `http://` zu einer Adresse außerhalb von LAN/VPN zeigt nach der Anmeldung
  eine Warnung (`Transport` in `Urls.kt`) — im Mobilnetz gingen Passwort und Tokens im Klartext.
- **Hintergrund-Sync:** `DownloadService.sendAddDownload(…, foreground = false)` ist ein
  `startService`, den Android 8+ aus dem Hintergrund mit `IllegalStateException` ablehnt — genau
  dort läuft der 12-h-Worker. Dann bekommt der `DownloadManager` die Aufträge direkt (auf dem
  Main-Looper, auf dem er gebaut wurde), und der Worker hält den Prozess bis zu 8 min am Leben.
- **Token nur an den eigenen Server** (`SameServer`): Ein Download, der noch unter einem anderen
  Konto/Server in der Warteschlange steht, bekommt nicht das Token des aktuell angemeldeten.
- **Offen:**
  - `gradle-wrapper.properties` hat noch keine `distributionSha256Sum`.
  - Wer eine Playlist online geöffnet hat und binnen 10 min (Playlist-Cache) im Funkloch einen
    Titel antippt, bekommt die volle Online-Liste als Warteschlange, nicht nur die geladenen Titel.
  - Der Cache-Schlüssel ist der Trackhash; ersetzt der Server eine Datei bei gleichen Tags (z. B.
    FLAC → MP3), wird ein fertiger Download nicht erneuert.
  - Der erste Zugriff auf die Offline-Daten (`OfflineEngine.get`) lädt den Cache-Index auf dem
    Main-Thread — bei sehr vielen geladenen Titeln kann der erste Start spürbar hängen.
  - „Offline-Daten löschen“ wartet auf einen laufenden Sync, ohne Fortschrittsanzeige.
- Cleartext-HTTP ist erlaubt (`res/xml/network_security_config.xml`), weil die Heimserver im LAN
  ohne TLS laufen.
