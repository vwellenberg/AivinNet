# Architektur (Client)

Wie der Client gebaut ist — Schichten, Zustandsfluss, wo was liegt. Konventionen, Workflow und
die lange Gotcha-Liste stehen in [CLAUDE.md](../CLAUDE.md); diese Datei erklärt den Bauplan
dahinter.

> Wird **nicht** in jede Session geladen. Zum Nachschlagen, bevor man einen Bereich anfasst,
> den man noch nicht kennt.

## Der Kern in fünf Sätzen

Vue 3 + TypeScript, Vite, Pinia — eine SPA im **Hash-Routing**-Modus, die vom Backend als
statischer Ordner ausgeliefert wird (deshalb `/#/albums/<hash>`, ohne `#` gibt es 404).
Der Zustand liegt in Pinia-Stores, die grob in drei Sorten zerfallen: **Wiedergabe**
(`player`/`queue`/`tracklist`), **Seitendaten** (`stores/pages/*`, eine pro Route) und
**Querschnitt** (`settings`, `auth`, `modal`, `notification`, …). Die Wiedergabe selbst steckt
nicht in einer Komponente, sondern in `stores/player.ts`, das **zwei** `<audio>`-Elemente
verwaltet und zwischen ihnen überblendet. Sobald ein Gerät einer Group Session beigetreten ist,
werden **alle** Transport- und Queue-Aktionen abgefangen und über den Server geplant statt lokal
ausgeführt. Aussehen liegt zentral in `assets/scss` (Rollen und Mixins), nicht in den einzelnen
Komponenten.

## Schichten

```
   views/*.vue         eine pro Route, holt Daten über ihren Page-Store
        │
   components/*.vue    Darstellung. `shared/` = wiederverwendbares Verhalten + Markup
        │
   stores/*.ts         Pinia. Der gesamte Zustand, alle Aktionen, alle Seams.
        │
   requests/*.ts       eine Datei pro Domäne, alle über useAxios()
        │
       HTTP  →  Backend (dieselbe Origin; im Dev-Modus Port 1980)
```

Quer dazu: `utils/` (pure Helfer, testbar — Farben, Playlist-Index-Arithmetik, Sync-Mathematik),
`helpers/` (Vue-nahe Helfer wie Kontextmenü, Tastatur, Media-Notification), `composables/`,
`interfaces.ts` (die Backend-Datenformen), `config.ts` (**alle** API-Pfade an einer Stelle).

## Start-Sequenz

`main.ts` steckt nur Plugins zusammen (Pinia + Persistenz, Router, v-wave, Virtual Scroller,
Motion, Auto-Animate) und mountet `App.vue`. Die eigentliche Startlogik steht in **`App.vue`**:

1. Theme-Klassen auf `document.body` setzen (`theme-dark`, `use-spotify-font`, Lauflicht-Stufe)
   — als `watch(..., { immediate: true })`, damit ein Reload nie kurz das falsche Theme malt.
   `settings.applyAutoTheme()` läuft **davor**, weil die Einstellungen synchron aus der
   Persistenz kommen.
2. `getLoggedInUser()` — bei Fehlschlag bricht der Rest ab (`useAxios` öffnet dann das
   Login-Modal).
3. Lautstärke initialisieren, **Device-Sync registrieren + Poll-Loop starten** (in `catch`
   gekapselt: ein älteres Backend ohne die Endpoints darf den Start nicht killen).
4. Root-Verzeichnisse prüfen → ggf. Einrichtungs-Modal.
5. `getAllSettings()` → `mapDbSettings()` (Server-Einstellungen über die lokalen legen).

Das Layout ist ein CSS-Grid (`#app-grid`): LeftSidebar · NavBar · `#acontent` (RouterView) ·
RightSideBar · BottomBar. Was sichtbar ist, entscheiden Breakpoints und Einstellungen.

## Zustand: die Store-Landschaft

### Wiedergabe (die drei, die zusammenhängen)

| Store | Verantwortung |
|---|---|
| `queue/tracklist.ts` | **was** in der Queue liegt (`tracklist`) und **woher** es kam (`from`) |
| `queue.ts` | **wo** man darin ist: `currentindex`, `playing`, Shuffle/Repeat-Ableitungen |
| `player.ts` | die tatsächlichen `<audio>`-Elemente, Preload, Crossfade, Fehlerbehandlung |

Beide Queue-Stores sind persistiert (localStorage), `player` nicht — er ist Laufzeit.

`from` ist nicht dekorativ: Es trägt Typ und Herkunft der Liste (Album, Playlist, Ordner,
Suche, Favoriten, Playlist-Ordner) und speist die „Playing from"-Anzeige und das
Scrobble-`source`-Feld.

**`AudioSource` hält zwei `<audio>`-Elemente** im DOM. Der Standby-Kanal lädt den nächsten Track
vor; `switchSources()` blendet über und tauscht die Rollen. Daher stammen zwei Eigenheiten:
`audio` ist eine *veränderliche* Referenz (imperative Helfer wie `setPlaybackRate` greifen
deshalb bewusst auf `audioSource.playingSource` zu, nicht auf die gefangene Variable), und beim
ersten Abspielen läuft ein Autoplay-Bypass, weil iOS Safari den zweiten Kanal sonst blockiert.

Gapless/Silence-Skip: Ein Worker (`/workers/silence.js`, Backend-Endpoint `POST /file/silence`)
liefert die Stille an Track-Ende und -Anfang; ein Timer stößt den Wechsel vor dem eigentlichen
`ended` an. **Im Gruppenmodus ist beides aus** — es würde die Geräte auseinanderlaufen lassen.

**Zufall gehört nicht in einen Getter:** `nextindex` speist auch den Preload und den
`track_change`-Broadcast, muss also bei jedem Lesen dasselbe liefern. Gewürfelt wird in der
Aktion `rollShuffleNext()`, der Getter liest nur.

### Seitendaten

`stores/pages/*` — je Route ein Store (`album`, `artist`, `artistDiscog`, `folder`, `playlist`,
`playlists`, `itemlist`, `pinnedAlbums`). Gefüllt werden sie **im Router**, nicht in der
Komponente: `beforeEnter` setzt `state.loading` und wartet auf `fetchAll(...)`. Wer eine neue
Detailseite baut, folgt diesem Muster, statt im `onMounted` zu laden — das war die Quelle des
`AlbumsFetcher`-Races (siehe CLAUDE.md).

### Querschnitt

`settings` (groß, persistiert, spiegelt teils Server-Config), `auth`, `modal`, `notification`
(Toasts), `loader`, `interface`, `context` (Kontextmenü), `search`, `lyrics`, `colors`,
`tracker` (Scrobbling), `content-width` (Layout-Messung, kein `defineStore` sondern geteilte
Refs), `devicesync`, `playlistFolders`, `musicbrainz`, `nav`, `tabs`.

## Datenholen

Alles läuft über `requests/useAxios.ts`. Das Ding macht mehr als nur fetchen:

- schaltet den globalen Ladebalken (`loader`-Store) an und aus,
- öffnet bei **401** das Login-Modal — **außer** auf `#/pair`, wo der QR-Deep-Link erst
  einlöst und die Boot-Requests naturgemäß 401 bekommen,
- meldet bei **422 + „Signature verification failed"** ab und wieder an (das passiert, wenn
  das Config-Verzeichnis des Servers neu erzeugt wurde → neue `serverId` → alte Tokens ungültig),
- gibt Fehler als Wert zurück (`{error, data, status}`) statt zu werfen.

**Pfade werden nicht in Aufrufstellen gestrickt**, sondern kommen aus `config.ts::paths` —
inklusive der Bild-Basis-URLs. Auth ist Cookie-basiert (`withCredentials`), es gibt keinen
Router-Guard.

## Group Sessions (Multiroom)

`stores/devicesync.ts` ist der größte Store des Projekts, und er funktioniert als **Seam**:
Sobald `joined` gilt, fangen die normalen Aktionen sich selbst ab und schicken die Absicht
zum Server, statt sie lokal auszuführen.

```ts
// dieses Muster steht an jedem Transport- und Queue-Eingang
const ds = useDeviceSync()
if (ds.joined && !ds.applying) { ds.intercept('play', index); return }
```

Die Seams sitzen in `queue.ts` (play, playPause, seek, playNext, playPrev, shuffleQueue,
clearQueue; `autoPlayNext` wird zum No-op), in `queue/tracklist.ts` (`insertAt`, `removeByIndex`)
und in `player.ts` (`onAudioEnded` → der Leader plant den Trackwechsel). `applying` markiert
„ich spiegele gerade den Server" und verhindert, dass das Spiegeln erneut sendet.

Mechanik in Stichworten: Poll-Loop (1 s joined, 5 s solo), Cristian-Uhrenabgleich
(`utils/deviceSync/clockSync.ts`, niedrigste RTT gewinnt), serverseitig geplante Ausführung
(`execute_at_ms` − Offset → lokaler Timer), Drift-Steuerung über `playbackRate` ±4 % mit
Hard-Seek-Fenster, Per-Device-Latenz-Trim. Details und die Feld-Bugs stehen in CLAUDE.md.

## Styling

```
assets/scss/
├── _variables.scss      Farben (u. a. die Brand-Farben aus src/brand-colors.json), Maße
├── _candy.scss          Memphis-Design-System: candy-shadow, candy-raised,
│                        candy-row-base/-hover, range-geometry
├── _motion.scss         Bewegungs-Vokabular (Dauer, Kurven, Staffelung)
├── _mixins.scss         allgemeine Mixins
├── ProgressBar.scss     Regler; liest nur --range-*, deklariert nichts
└── Global/
    ├── _buttons.scss    die fünf Button-ROLLEN (btn-primary/action/quiet/pill/toggle-on)
    ├── _button-classes.scss  wer welche Rolle trägt, inkl. Header-Staffelung
    ├── basic.scss       Reset + globale Button-Basis + Schatten-Ausnahmeliste
    ├── app-grid.scss    das Layout-Grid
    ├── index.scss       Theme-Tokens (--mem-*), body.theme-dark kippt sie
    └── …                Karten, Scrollbars, Lauflicht, Zustände
```

Zwei Regeln, aus denen fast alle Styling-Fallen folgen:

1. **Aussehen gehört in eine Rolle, nicht in die Komponente.** Ein Button, der von Hand
   `background: transparent; border: none; padding: 0` schreibt, ist fast immer ein übersehener
   Fall.
2. **Themes laufen über CSS-Custom-Properties** (`--mem-*`), umgeschaltet durch eine Klasse auf
   `document.body`. Sass-Variablen sind Bauzeit, Custom Properties sind Laufzeit — und Sass
   wertet **nichts** innerhalb eines Custom-Property-Werts aus (`#{}` interpolieren!).

Die Brand-Farben haben genau **eine** Quelle: `src/brand-colors.json`, per Vite-Injection ins
SCSS und als Re-Export nach TypeScript. Nicht hardcoden.

## Routing

`createWebHashHistory` — alle Deeplinks tragen `#`. Nur `HomeView` wird statisch importiert,
alles andere ist ein Lazy-Chunk. Die Routen mit `beforeEnter` (Ordner, Playlists, Playlist,
Album, Artist) laden ihre Daten dort. Route-Namen kommen aus dem exportierten `Routes`-Objekt,
nicht als String-Literal.

## Tests

Vitest **0.x** (nicht 1.x — Vite-3-Kompatibilität), Tests liegen als `*.test.ts` in
`src/**/__tests__/`. Getestet wird das, wo Fehler teuer waren: Store-Logik, Request-Schichten,
pure Utils (`playlistMove`, `shufflePicker`, Sync-Mathematik). Reines Markup/CSS wird stattdessen
per Headless-Screenshot verifiziert.

Gates: `yarn lint:check`, `yarn test`, `yarn build` und `vue-tsc --noEmit` — alle vier sind
Required Checks auf `master`.

## Wo fange ich an?

| Frage | Datei |
|---|---|
| Wie startet die App? | `App.vue` (`onMounted`), nicht `main.ts` |
| Wo kommt Ton her? | `stores/player.ts` (`AudioSource`) |
| Warum spielt der falsche Track? | `stores/queue.ts` (`nextindex`, Shuffle) |
| Wer lädt die Seitendaten? | `router/index.ts` → `stores/pages/<seite>.ts` |
| Wie heißt der Endpoint? | `config.ts::paths` |
| Warum greift mein CSS nicht? | `Global/_buttons.scss` (Rollen), `_candy.scss` (Mixins) |
| Warum passiert lokal nichts? | Group-Session-Seam — `ds.joined` in `queue.ts` |
