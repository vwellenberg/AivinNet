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

Dann die App öffnen, Server-URL (z. B. `http://192.168.1.10:1970`), Benutzername und Passwort
eingeben und **Anmelden** drücken. Die Anmeldung gilt für das Auto, bis man auf dem Telefon
**Abmelden** drückt.

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
- Cleartext-HTTP ist erlaubt (`res/xml/network_security_config.xml`), weil die Heimserver im LAN
  ohne TLS laufen.
