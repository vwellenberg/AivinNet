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
- **Noch nicht:** Cover (der Bild-Endpoint braucht den Authorization-Header, den das Auto nicht
  senden kann), Suche, Sprachbefehle

## Bauen

Voraussetzungen: JDK 21, Android SDK (`ANDROID_HOME`, Plattformen 36).

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

**Grenzen:** Eine Playlist, die im Netz gestartet wurde, behält ihre volle Warteschlange, auch die
nicht geladenen Titel. Fährt man danach in ein Funkloch, bricht die Wiedergabe beim ersten nicht
geladenen Titel mit einem Fehler ab; Media3 überspringt ihn nicht von selbst. Wer offline startet,
bekommt dagegen nur die geladenen Titel in die Warteschlange.

## Technisches

- Kotlin, Android Views (kein Compose), Media3 1.11.1, OkHttp, minSdk 26, target/compileSdk 36
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
- **Offen:** `gradle-wrapper.properties` hat noch keine `distributionSha256Sum`.
- Cleartext-HTTP ist erlaubt (`res/xml/network_security_config.xml`), weil die Heimserver im LAN
  ohne TLS laufen.
