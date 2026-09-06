---
paths:
  - "src/stores/devicesync.ts"
  - "src/utils/deviceSync/**"
  - "src/components/DeviceSync/**"
  - "src/components/modals/Devices.vue"
  - "src/views/PairView.vue"
---

# Device Sync / Multiroom (Group Sessions)

Geräte desselben Accounts treten einer **Group Session** bei: alle spielen hörbar synchron, jedes
kann steuern, Volume und Mute bleiben pro Gerät (remote einstellbar). Der **Server ist die Quelle
der Wahrheit**, komplett im RAM (`lib/groupsession.py` im Backend, HTTP unter `/devicesync`).

## Client-Architektur

`stores/devicesync.ts` ist das Herzstück:

- **Poll-Loop** — 1 s beigetreten, 5 s solo.
- **Cristian-Clock-Offset** (`utils/deviceSync/clockSync.ts`) — das Sample mit der niedrigsten
  RTT gewinnt.
- **Geplante Command-Ausführung** — Server-`execute_at_ms` minus Offset → lokales `setTimeout`;
  Catch-up wenn verpasst; Dedupe per Command-Id.
- **Drift-Steering alle 250 ms** (`utils/deviceSync/driftSteer.ts`) — Deadband, `playbackRate`
  ±4 %, Hard-Seek über 1 s; im Pause-Zustand nur Hard-Seek-Recovery.
- **Mirror unter `applying`-Guard.**

UI: Cast-Button in `BottomBar/Right.vue` (grün = beigetreten) → `modals/Devices.vue`;
`DeviceSync/GestureOverlay.vue` für den Autoplay-Block bei Remote-Invite; QR-Pairing als
Deep-Link `/#/pair?code=…` → `views/PairView.vue` (Redeem über `/auth/pair?setcookie=true`).

## ⚠️ Die Seams — hier läuft alles durch

```ts
const ds = useDeviceSync()
if (ds.joined && !ds.applying) { ds.intercept('play', index); return }
```

- `queue.ts` — play, playPause, seek, playNext, playPrev, shuffleQueue, **clearQueue**;
  `autoPlayNext` wird zum No-op.
- `queue/tracklist.ts` — `insertAt`, `moveTrack` **und** `removeByIndex` (Add to queue / Reorder /
  Remove). Wer eine Queue-Mutation baut, ruft **eine dieser drei** auf, statt selbst zu splicen:
  `insertAfterCurrent` („Play next") hat das getan und dabei nicht nur den Seam verloren, sondern
  auch das `clearNextAudio()` aus `insertAt` — es fügt genau auf `nextindex` ein, das vorgeladene
  Audio war also der gerade verdrängte Track (#434).
- `player.ts` — `onAudioEnded`: der Leader plant `track_change`. Gapless und Crossfade sind im
  Gruppenmodus **aus**.
- `tracker.ts` — nur der Scrobble-Leader submittet; Nicht-Leader verwerfen die Akkumulation.
- `settings` — repeat wird geteilt.

**Jede** neue Queue-Mutation muss durch `intercept()` → `sendQueueSet`. Die lokale Liste zu
splicen ändert die Server-`queue_id` **nicht**, also re-mirrort niemand, und der gespiegelte
`currentindex` zeigt danach auf den falschen Track — stille Desync.

- **Der Index muss mitreisen.** Nur der Client weiß, ob die Entfernung *vor*, *auf* oder *nach*
  dem laufenden Track lag: darunter ⇒ `currentindex - 1`; **auf** ihm ⇒ Index bleibt (der nächste
  rutscht nach) und `position_ms: 0`; letzter Track ⇒ in die verkürzte Liste geklemmt. Der Server
  klemmt zwar auch, aber er kann die Absicht nicht rekonstruieren.
- **⚠️ „Queue ersetzen" ist nicht „Queue leeren".** `PlayBtn.vue`/`TopTracks.vue` riefen
  `clearQueue()` als Vorspiel zu `setFromSearch(...)` + `play()`. Lokal ein No-op — mit dem Seam
  ein **queue-set einer leeren Queue**, das gegen das echte rennt (beide `void`, Reihenfolge der
  Antworten nicht garantiert). Wer eine Queue ersetzt, ruft **nur** `setFromX` + `play()`.
- **⚠️ Eine leere Gruppen-Queue muss überall stoppen.** `reconcileTransport` behandelte „kein
  aktueller Track" als Resolve-Lücke und stieg früh aus → das alte Audio lief weiter, während der
  Anker auf 0 stand, und der Steer-Loop riss es alle 250 ms zurück. Leere Queue ⇒
  `queue.playing = false`, `pausePlayingSource()`, `resetRate`, `loadedTrackhash = ''`. Dazu Guard
  in `onTrackEnded`: ein `track_change` in eine leere Session beantwortet der Server mit 400.
- **Die Liste wird gezählt, nicht aufgeschrieben.** `queue.groupmode.test.ts` prüft eine *feste*
  Auswahl von Actions — eine neue Mutation ohne `intercept` bleibt dort grün, und genau so ist
  #434 durchgerutscht. Der Zensus `queue/__tests__/queueSeamCensus.test.ts` liest stattdessen den
  Quelltext beider Queue-Stores: jede Action, die `this.tracklist` strukturell schreibt, muss den
  Seam vor der Mutation erreichen oder mit Begründung in `LOCAL_BY_DESIGN` stehen.
- E2E: `~/uitest/queueseams.js`.

## Zufallswiedergabe in der Gruppe

Der Leader würfelt für alle: `onTrackEnded()` schickt `queue.nextindex` statt `i + 1`, und weil
der Index **im Command mitreist**, landen alle Geräte auf demselben Track. Vorher rechnete die
Stelle hart sequentiell — der Shuffle-Knopf sah aktiv aus und wirkte nur beim manuellen „Next"
(#324).

⚠️ **Ein gespiegelter Index-Sprung ist ein Track-Wechsel.** `applyState` und der
`track_change`-Command schreiben `currentindex` bewusst direkt; ohne `rollShuffleNext()` bleibt
das Ziel auf dem gerade gestarteten Track stehen, und der Getter fällt (seit #317) auf die
sequentielle Zeile zurück — die Gruppe würde nach dem ersten Sprung wieder der Reihe nach laufen.
Neu gewürfelt wird **nur bei echter Änderung**: der Poll läuft jede Sekunde, und ein Wurf pro Tick
machte `nextindex` zum wandernden Ziel.

⚠️ **`shuffle` ist — anders als `repeat` — KEIN geteilter Zustand.** Es gibt kein Feld dafür im
Server-State; es gilt die Einstellung des Geräts, das gerade handelt (Leader beim Ausspielen, der
Drückende beim manuellen „Next"). Wer das ändern will, braucht ein Feld im Backend-State, nicht
nur Client-Code.

## ⚠️ Weitere Gotchas

- **Der `applying`-Guard darf nie ein `await` überspannen.** Resolve **vor** dem Guard;
  `withApplying()` ist sync-only, Tiefe gezählt. Sonst laufen User-Aktionen im Netzwerkfenster
  lokal statt als Broadcast.
- **Bei Leave** verhindert das `leaveSuppressUntil`-Fenster, dass ein in-flight Poll das Gerät
  sofort re-adoptiert. Re-Adopt (Page-Reload mitten in der Session) erzwingt Full-Re-Mirror
  (`queueId`-Reset).
- Scheduled Timer werden bei leave/toSolo/Queue-Wechsel gecancelt; `executeCommand` prüft
  Membership; der `track_change`-Index wird geclampt.
- **Positionen immer als ganze Millisekunden senden.** `audio.currentTime * 1000` ist ein Float;
  ein Float ließ jedes `queue-set` mit **422** auflaufen → Server-Queue blieb leer → jedes
  `track_change` scheiterte mit 400. Symptom: „gleicher Song wird angezeigt, aber nichts startet,
  Next tot" — scheinbar sporadisch, weil ein Join bei Position exakt 0 funktionierte.
  `getCurrentTimeMs()` rundet.
- **Sync-Requests nie stillschweigend verwerfen.** `sendQueueSet`/`sendCmd` melden Nicht-2xx per
  Toast und `console.error`. Ein verschlucktes 422 sah exakt aus wie eine gesunde Gruppe.
- **Autoplay-Prompt:** Der `GestureOverlay` **ist** die Meldung — kein zusätzlicher Error-Toast
  (Autoplay-Rejects feuern mehrfach → gestapelte rote Toasts über dem Dialog).
- **QR-Pairing:** Auf `/#/pair` darf der 401 der Boot-Requests kein Login-Modal öffnen
  (`useAxios` prüft die Route), sonst wirkt das Scannen kaputt.

## Timing — vier Stellschrauben

Wenn „klingt versetzt" gemeldet wird, **in dieser Reihenfolge** prüfen:

1. **Clock-Kalibrierung beim Join** (`calibrateClock()`, 4 Polls à ~120 ms). Der Estimator behält
   das Sample mit der niedrigsten RTT. Direkt nach dem Join gab es früher nur *eines* — ein
   langsames Sample ⇒ Wiedergabe startet messbar versetzt und kriecht erst langsam in Position.
2. **Snap-Window** (`SNAP_WINDOW_MS 2500`, `SNAP_HARD_MS 80`). In den ersten 2,5 s nach einem
   Transport-Command wird ein Offset > 80 ms **hart gesucht** statt über playbackRate ausgeglichen.
   Das langsame Ausgleichen war das, was am Track-Anfang als Verzögerung hörbar war.
3. **Deadband 25 ms** (`driftSteer.ts`). 50 ms zwischen zwei Lautsprechern im selben Raum sind als
   Kammfilter hörbar — das darf das Deadband nicht verschlucken.
4. **Per-Device-Trim** (`utils/deviceSync/audioOffset.ts`, UI im Devices-Panel). Ausgabe-Latenz
   (Bluetooth 100–200 ms, TV/Soundbar mehr) ist für jedes Protokoll unsichtbar und braucht einen
   manuellen Regler (±1000 ms, lokal persistiert, wird auf `expectedPositionMs` addiert).

## Gruppen-Bildung und Auto-Rejoin

„Invite" joint das eigene Gerät **implizit** und seedet die Gruppe mit dem, was hier läuft —
niemand soll „sich selbst beitreten" müssen. „Join group" erscheint nur, wenn bereits eine Gruppe
läuft.

**Auto-Rejoin:** Ein Gerät, das *unfreiwillig* aus der Gruppe fiel (Reap nach 30 s, Netzlücke,
Serverneustart), tritt einer **noch laufenden** Gruppe beim nächsten Poll selbst wieder bei.
Marker `aivinnet.group_member` in localStorage; gesetzt beim Join, gelöscht **nur** bei bewusstem
Ausstieg (Leave, „Not now", per `play_here` entfernt) — `toSolo()` lässt ihn absichtlich stehen,
das ist der unfreiwillige Pfad.

⚠️ **Harte Regel: Auto-Rejoin darf nie eine Gruppe ERZEUGEN** (`groupRunning`-Check auf ein
anderes beigetretenes Gerät), sonst startet ein geöffnetes Handy ungefragt Gruppen-Wiedergabe.
Backoff `AUTO_REJOIN_COOLDOWN_MS` 60 s gegen Flapping.

## ⚠️ Verifikationsfalle

Der erste E2E jointe **per API** und startete Chromium mit
`--autoplay-policy=no-user-gesture-required` — beides umging genau die Pfade, die im Alltag
brechen, und meldete grün, während das Feature kaputt war. Group-Sync **immer** über echte
UI-Klicks und ohne Autoplay-Flag verifizieren (`~/uitest/verify3.js`).

Weitere Falle: Die Bottom-Bar tauscht auf Phones die Aux-Gruppe gegen die Navigation — ein Button,
der nur dort hängt, **existiert auf dem Handy nicht**. Der Devices-Button liegt deshalb zusätzlich
in `BottomBar/Left.vue` und im NowPlaying-Header.
