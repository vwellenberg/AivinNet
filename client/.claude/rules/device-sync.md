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

- **Poll-Loop** — 1 s beigetreten, 5 s solo; Antworten sind nummeriert, eine ältere als die
  zuletzt angewandte fliegt raus (sonst rollt ein spät landender Poll die Gruppe zurück).
- **Cristian-Clock-Offset** (`utils/deviceSync/clockSync.ts`) — das Sample mit der niedrigsten
  RTT gewinnt.
- **Zustand statt Kommandos** — jede Transport-Änderung kommt als Zustand mit Anker in der
  Zukunft. Liegt der Anker vorn, wird der Zustand **gehalten** (`pending`), sein Audio auf dem
  Standby-Element vorbereitet und zur Anker-Zeit übernommen (`commit` → `alignTransport`);
  liegt er zurück, sofort (Join, Catch-up). Transport-**Kommandos** führt der Client nicht aus,
  nur die gezielten (Volume, Mute, Invite, Play-here).
- **Drift-Steering alle 250 ms** (`utils/deviceSync/driftSteer.ts`) — auf dem Median der letzten
  drei Messungen: ab 25 ms `playbackRate` 2–4 %, bis unter 8 ms; über 100 ms ein kompensierter
  Seek. Nach jedem Eingriff 1 s Ruhe, dann Messung — und aus ihr lernt das Gerät seine Start-
  und Seek-Latenz (`utils/deviceSync/latency.ts`, in localStorage).
- **Leader bucht den nächsten Track** ~4 s vor Songende auf dessen exaktes Ende (`bookNextTrack`,
  `execute_at_ms` im Command) — die Gruppe spielt lückenlos durch.
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
- `player.ts` — `onAudioEnded`: der Leader plant `track_change`, **falls** er den nächsten Track
  nicht schon gebucht hat (`bookNextTrack`, dann tut `ended` nichts). Das Solo-Gapless und
  Crossfade sind im Gruppenmodus **aus**; die Gruppe hat ihr eigenes Umschalten über das
  Standby-Element (`prepareGroupStandby` / `switchToGroupStandby`, harter Schnitt ohne Fade).
- `tracker.ts` — nur der Scrobble-Leader submittet; Nicht-Leader verwerfen die Akkumulation.
- `settings` — repeat wird geteilt.

**Jede** neue Queue-Mutation muss durch `intercept()` → `sendQueueSet`. Die lokale Liste zu
splicen ändert die Server-`queue_id` **nicht**, also re-mirrort niemand, und der gespiegelte
`currentindex` zeigt danach auf den falschen Track — stille Desync.

- **Der Index muss mitreisen.** Nur der Client weiß, ob die Entfernung *vor*, *auf* oder *nach*
  dem laufenden Track lag: darunter ⇒ `currentindex - 1`; **auf** ihm ⇒ Index bleibt (der nächste
  rutscht nach) und `position_ms: 0`; letzter Track ⇒ in die verkürzte Liste geklemmt. Der Server
  klemmt zwar auch, aber er kann die Absicht nicht rekonstruieren.
- **⚠️ Eine Bearbeitung beim Hören ist `live: true`.** Add, Remove (nicht des laufenden Tracks),
  Reorder und der Seed des ersten Joiners schicken die Position *jetzt*. Ohne das Flag legte der
  Server sie `LEAD_MS` in die Zukunft — jedes „Zur Queue hinzufügen" ließ **alle Geräte 1,6 s
  zurückspringen** (gemessen). Mit dem Flag bleibt der Anker unverändert, solange der laufende
  Track weiterläuft: niemand seekt. Ein Neustart (neues Album, Nachfolger nach Remove, Clear,
  Shuffle) ist **nicht** live.
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

⚠️ **Ein gespiegelter Index-Sprung ist ein Track-Wechsel.** `commit` schreibt `currentindex`
bewusst direkt; ohne `rollShuffleNext()` bleibt
das Ziel auf dem gerade gestarteten Track stehen, und der Getter fällt (seit #317) auf die
sequentielle Zeile zurück — die Gruppe würde nach dem ersten Sprung wieder der Reihe nach laufen.
Neu gewürfelt wird **nur bei echter Änderung**: der Poll läuft jede Sekunde, und ein Wurf pro Tick
machte `nextindex` zum wandernden Ziel.

⚠️ **`shuffle` ist — anders als `repeat` — KEIN geteilter Zustand.** Es gibt kein Feld dafür im
Server-State; es gilt die Einstellung des Geräts, das gerade handelt (Leader beim Ausspielen, der
Drückende beim manuellen „Next"). Wer das ändern will, braucht ein Feld im Backend-State, nicht
nur Client-Code.

## ⚠️ Das Devices-Panel zeigt SERVER-Wahrheit — ein lokaler Wechsel ist dort unsichtbar

Jede Zeile im Panel rendert aus `ds.devices`, und diese Liste kommt ausschließlich aus dem Poll.
Nach einem Leave sind das **bis zu 5 Sekunden** (die Solo-Kadenz, die `toSolo()` gerade erst
eingestellt hat): `ds.joined` ist längst `false`, die Zeile sagt weiter „In group" und bietet
Regler und *Leave* an. Aus Nutzersicht hat der Knopf nichts getan — obwohl der Request unterwegs
war. Deshalb setzt jeder Pfad, der die Mitgliedschaft lokal kennt, die eigene Zeile selbst:
`markSelfJoined()` in `leave()`, `playHereLeave()` und im Join.

**Und jeder Knopf, der ein Round Trip ist, benennt seinen Zustand** (`membershipPending`
`'join' | 'leave'` im Store, per-Gerät-Pending in `Devices.vue`) und nimmt derweil keine Klicks
mehr an. Ohne das tippt man zweimal und schickt zwei Joins — ein Join dauert wegen
`calibrateClock()` ~1 s, und zwei parallele Joins rennen zwei Snapshots in den Queue-Mirror.

⚠️ **`leave()` wartet auf einen laufenden Join, statt sich wegzuwerfen.** Das „Not now" des
`GestureOverlay` landet exakt in diesem Fenster (`needsGesture` wird *während* `runJoin()`
gesetzt). Ein dort verworfenes Leave ließe das Gerät in der Gruppe, die es gerade abgelehnt hat —
und schlimmer: `rememberMembership(true)` aus dem Join überlebte, Auto-Rejoin liefe später
hinterher. Die Kehrseite ist bewusst in Kauf genommen: Hängt der Join-Request, hängt auch das
Leave (ein Timeout-Race würde genau den Bug wieder einbauen).

## ⚠️ Weitere Gotchas

- **Der `applying`-Guard darf nie ein `await` überspannen.** Resolve **vor** dem Guard;
  `withApplying()` ist sync-only, Tiefe gezählt. Sonst laufen User-Aktionen im Netzwerkfenster
  lokal statt als Broadcast.
- **Bei Leave** verhindert das `leaveSuppressUntil`-Fenster, dass ein in-flight Poll das Gerät
  sofort re-adoptiert. Re-Adopt (Page-Reload mitten in der Session) erzwingt Full-Re-Mirror
  (`queueId`-Reset).
- Ein gehaltener Zustand (`pending`) fällt bei leave/toSolo und bei jedem neueren Zustand weg —
  gilt immer nur der **neueste**. `toSolo()` setzt außerdem eine laufende Steuer-Rate zurück,
  sonst spielte das Gerät solo den Rest des Tracks gestreckt weiter.
- **Zwischen einem Next und seiner Anker-Zeit** zeigt und spielt das Gerät noch den alten Track.
  Ein zweites Next zählt deshalb vom Track, zu dem die Gruppe unterwegs ist (`upcomingIndex`),
  und Previous macht das Next rückgängig — sonst käme schnelles Skippen nie über einen Track
  hinaus.
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

## Timing — was gemessen wurde und was daraus folgt

Gemessen mit zwei echten Browsern auf einer Uhr (`~/syncprobe`, siehe
[docs/verification.md](../../docs/verification.md)). Der Dauerbetrieb lag schon vorher bei
0–25 ms; kaputt waren die **Übergänge**. Jede dieser Regeln ist eine Ursache, kein Geschmack:

1. **⚠️ Der Zustand kommt VOR seiner Zeit.** Der Server plant `LEAD_MS` (1,5 s) voraus, der Poll
   liefert den Zustand samt Anker aber sofort. Wer ihn beim Empfang anwendet, handelt im Takt
   des eigenen Polls: Next startete den neuen Track 1,2–1,4 s zu früh (je Gerät anders) und
   setzte ihn zur Anker-Zeit auf 0 zurück, jeder Seek lief doppelt, Pause stoppte jedes Gerät zu
   einer anderen Zeit. Also: halten, vorbereiten, zur Anker-Zeit übernehmen — und die
   Transport-Kommandos daneben **nicht** ausführen.
2. **Vorbereiten heißt: Standby-Element laden.** Erst zur Anker-Zeit zu laden, macht jedes Gerät
   um seine eigene Ladezeit zu spät. Ein Sprung (anderer Track, Seek im laufenden Track) wird im
   Lead-Fenster auf dem zweiten `<audio>` geladen und positioniert; zum Zeitpunkt harter
   Schnitt. Nachher gemessen (2× Chromium): nach Seek, Pause/Play und Queue-Bearbeitung
   ≤ 25 ms zwischen den Geräten, am Songende 2 ms Lücke statt ~1,5 s.
3. **⚠️ Ein Seek kostet ~90 ms Stillstand** (Chromium: `currentTime` steht, bis der Renderer
   neu gepuffert hat). Das alte Snap-Window seekte ab 80 ms Abweichung alle 250 ms — jeder Seek
   erzeugte die nächste Abweichung: ~13 Seeks pro Gerät nach jedem Übergang. Jetzt: ein Seek
   zielt um die gelernte Seek-Latenz voraus, und danach wird **1 s nicht geurteilt**.
4. **⚠️ Eine Tempo-Korrektur hat Einschaltkosten** (`~/syncprobe/ratebench.js`): Chromium
   verliert beim Verlassen von Rate 1.0 einmalig 20–30 ms, bei der Rückkehr ~10 ms. 4 % bringen
   danach ~40 ms/s, **1 % brachte in vier Sekunden netto 14 ms**. Deshalb erst ab 25 ms steuern,
   dann mit mindestens 2 %; über 100 ms ist ein kompensierter Seek schneller als Sekunden Echo.
5. **Firefox' `currentTime` rauscht um ±40 ms.** Entscheidungen fallen auf dem Median der
   letzten drei Messungen, die Landung eines Eingriffs auf dem Median dreier Messungen nach
   dem Stillstand.
6. **⚠️ Ein später Timer ist keine Gerätelatenz.** Gelernt wird die Verzögerung relativ zum
   **tatsächlichen** Vorlauf (`learnLatency(estimate, lead, residual)`). Aus dem Restfehler
   allein gelernt, zählte jede Timer-Verspätung unter CPU-Last als Latenz — die Schätzung
   kletterte auf 328 ms, jeder Übergang startete entsprechend zu früh, die Korrekturen
   bekämpften sich. Ein vorbereitetes Element wird außerdem erst bei > 250 ms Verspätung neu
   positioniert: das kostet einen eigenen Re-Buffer, den der Lande-Seek billiger hat.
7. **Clock-Kalibrierung beim Join** (`calibrateClock()`, 4 Polls à ~120 ms) — ein einzelnes,
   langsames Sample ließ die Wiedergabe messbar versetzt starten.
8. **Per-Device-Trim** (`utils/deviceSync/audioOffset.ts`, UI im Devices-Panel) bleibt als
   Handregler — aber nur für Ausgabewege, die das Betriebssystem nicht kennt (Soundbar-DSP,
   manche Bluetooth-Stacks). Die Latenz, die das OS meldet, rechnet Chromium schon in
   `currentTime` ein (`AudioRendererImpl::CurrentMediaTime` = hörbarer Zeitstempel, nicht der
   dekodierte); `AudioContext.outputLatency` zusätzlich abzuziehen hieße doppelt zählen.

Unter Stress (Chrome + Firefox, 4×-CPU-gedrosseltes „Handy" auf ausgelastetem Server) liegen
die Geräte Sekunden nach einem Übergang bis ~55 ms auseinander — so gut wie der alte Stand
unter demselben Stress oder besser, aber ohne Doppelstart, Rücksprung und Stotter-Serie. Wer hier weiterdreht: vorher und nachher mit dem Probe messen,
nie nach Gefühl.

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

Und: **ein Schnappschuss pro Schritt misst Übergänge nicht.** `verify3.js` prüfte „< 0,3 s
auseinander" 5,5 s nach dem Klick — Doppelstart, doppelter Seek und Rücksprung waren da längst
vorbei, der Test grün. Zeitverläufe misst `~/syncprobe/runprobe.sh` (alle 10 ms jede
`<audio>`-Position beider Geräte gegen den Server-Anker).

Weitere Falle: Die Bottom-Bar tauscht auf Phones die Aux-Gruppe gegen die Navigation — ein Button,
der nur dort hängt, **existiert auf dem Handy nicht**. Der Devices-Button liegt deshalb zusätzlich
in `BottomBar/Left.vue` und im NowPlaying-Header.
