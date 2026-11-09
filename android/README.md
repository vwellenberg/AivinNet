# AivinNet für Android Auto (Prototyp)

Eine kleine native Android-App, die **nur einen Zweck** hat: den AivinNet-Server im Auto
spielbar machen. Auf dem Telefon gibt es einen Anmeldebildschirm, mehr nicht. Die eigentliche
Arbeit macht ein Media3-`MediaLibraryService`; Android Auto baut seine Oberfläche selbst aus dem
Browse-Baum auf.

- **Baum:** Mixes · Playlists → Playlist → Titel (Auswahl setzt die ganze Playlist als Warteschlange)
- **Streaming:** `GET /file/<trackhash>/legacy` mit Bearer-Token, Token-Refresh bei 401
- **Scrobbles:** `POST /logger/track/log` für jeden Titel, der mindestens 5 s lief
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
- **Offen:** Scrobbles aus Funklöchern gehen noch verloren (Puffer kommt mit Offline, #747);
  `gradle-wrapper.properties` hat noch keine `distributionSha256Sum`.
- Cleartext-HTTP ist erlaubt (`res/xml/network_security_config.xml`), weil die Heimserver im LAN
  ohne TLS laufen.
