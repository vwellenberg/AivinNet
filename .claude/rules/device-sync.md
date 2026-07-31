---
paths:
  - "src/swingmusic/lib/groupsession.py"
  - "src/swingmusic/api/devicesync.py"
  - "tests/test_groupsession*.py"
  - "tests_api/test_device*.py"
---

# Device Sync / Multiroom (Group Sessions)

Geräte desselben Users treten einer **Group Session** bei (Client v1.3.0+): alle spielen hörbar
synchron, jedes kann steuern, Volume und Mute bleiben pro Gerät.

**Der Server ist die Quelle der Wahrheit, komplett im RAM** — `lib/groupsession.py` ist pure
Logik ohne Flask und ohne DB und deshalb mit injizierter Uhr unit-testbar. Der HTTP-Adapter
liegt in `api/devicesync.py` (alle POST unter `/devicesync`: register, poll, command, queue-set,
resolve, join, leave). Persistent ist nur die Geräte-Registry (`DeviceTable` in `db/userdata.py`).

## Kernmechanik

Transport-Mutationen (play, pause, seek, track_change) werden **geplant**, nicht sofort
ausgeführt: `execute_at = now + LEAD_MS (1500)`. Sie wirken auf alle Member gleichzeitig,
**inklusive Initiator** — die Clients rechnen Server-Zeit per Cristian-Offset in lokale Zeit um.

- Versionierter Snapshot, Delta nur bei einem Sprung von `known_version`.
- Targeted Commands (`set_volume`, `set_mute`, `join_invite`, `play_here`) gehen nur ans
  Zielgerät, TTL 15 s wegen der 5-s-Kadenz im Solo-Modus.
- Reaper-Cron alle 2 s räumt stale Member und leere Sessions.
- Serverneustart ⇒ Sessions weg ⇒ Clients fallen nahtlos auf Solo zurück.
- Pair-Redeem (`GET /auth/pair`) hat eine `setcookie`-Option für den QR-Deep-Link-Login.

## ⚠️ Warum Polling und nicht Push

Der Server ist single-threaded. `/devicesync/poll` läuft 1 s pro beigetretenem Gerät und ist
deshalb **strikt RAM-only** — kein DB-Write, kein blockierendes I/O; die DB wird nur bei register
und leave angefasst. Ein Gerät, das den Poll-Pfad ausbremst, bremst die gesamte App.
Langlebige Verbindungen (WebSocket, SSE) bleiben tabu; ein Push-Kanal müsste als eigener Prozess
neben der App laufen.

## Feld-Bugs aus v1.3.0 (behoben — nicht zurückbauen)

- **Positionsfelder tolerant typisieren.** Der Client liefert `audio.currentTime * 1000`, einen
  Float. `position_ms: int` ließ jedes `queue-set` während laufender Wiedergabe mit
  **422 `int_from_float`** auflaufen; die Session behielt eine leere Queue, jedes `track_change`
  wurde mit 400 abgelehnt. Jetzt `float` + `round()` serverseitig, auch für Transport-Payloads.
- **Reap-Fenster ≠ Offline-Anzeige.** Beide bei 5 s zu koppeln warf Handys aus der Gruppe, sobald
  der Bildschirm ausging (gedrosselte Timer). `OFFLINE_MS` (5 s) steuert nur den Anzeigepunkt,
  `REAP_MS` (30 s) den Rauswurf.
- **`Base.execute` liefert aus einem bereits geschlossenen Session-Scope.** `DeviceTable.upsert`
  materialisierte dort eine gemappte Entity → **jede Wiederholungs-Registrierung eines bekannten
  Geräts war ein HTTP 500** („identity map is no longer valid"). Für Lookups Spalten selektieren
  (`select(cls.id)`), Vorbild `count()`.
- **Mocks verstecken echte DB-Bugs.** `tests_api/test_devicesync_api.py` mockt `DeviceTable` weg,
  deshalb blieb der 500er grün. Für Tabellen-Logik gehört ein Test gegen die **echten**
  SQLite-Tabellen dazu (`tests_api/test_device_table.py`), inklusive FK-Usern im Fixture.
