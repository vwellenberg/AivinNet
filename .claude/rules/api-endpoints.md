---
paths:
  - "src/aivinnet/api/**"
---

# API-Endpoints

Ein Blueprint je Modul, registriert in `app_builder.load_endpoints()`. **Ein neuer Blueprint,
der dort nicht registriert wird, existiert nicht** — es gibt keine Auto-Discovery.
Die vollständige Präfix-Tabelle steht in [docs/architecture.md](../../docs/architecture.md);
Vorsicht, die Präfixe folgen nicht dem Modulnamen (`/nothome`, `/notsettings`, `/logger`, `/file`).

## ⚠️ Der Server verarbeitet einen Request gleichzeitig

bjoern ist evented und single-threaded. Im Handler deshalb **nichts Blockierendes**:

- Ausgehendes HTTP nur mit IPv4-Präferenz **und** harter Deadline. Das IPv6 des Servers ist
  kaputt (DS-Lite): `requests` hängt minutenlang, weil urllib3 alle aufgelösten Adressen
  (AAAA zuerst) sequenziell mit vollem Connect-Timeout probiert — `timeout=` deckt das **nicht**
  ab. `utils/net.py::prefer_ipv4()` läuft global; zusätzlich Futures mit Deadline absichern
  (Vorbild `lib/coverart.py::search_covers`, `FETCH_DEADLINE_SECONDS`) und Pools mit
  `shutdown(wait=False)` schließen.
- Häufig gepollte Endpoints RAM-only halten (Vorbild `/devicesync/poll`, 1 s pro Gerät).
- Keine langlebigen Verbindungen (WebSocket, SSE).
- Langlaufendes in `utils/threading.py::background` oder einen Prozess-Pool.

## ⚠️ Positionsfelder tolerant typisieren

Der Client liefert `audio.currentTime * 1000` — einen **Float**. Ein `position_ms: int` ließ
jedes `queue-set` während laufender Wiedergabe mit **422 `int_from_float`** auflaufen; die
Session behielt eine leere Queue, jedes `track_change` wurde mit 400 abgelehnt. Symptom beim
Nutzer: „gleicher Song wird angezeigt, aber nichts startet" — und scheinbar sporadisch, weil ein
Join bei Position exakt 0 (gültiger int) funktionierte. Also `float` + `round()` serverseitig.

## ⚠️ Ein 500 im Journal hat keinen Traceback — Handler direkt aufrufen

`journalctl -u aivinnet` zeigt bei einem Handler-Crash nur die eine Zeile
`[ERROR] Exception on /pfad [POST]`, den Traceback schluckt die Log-Konfiguration. Nicht im
Journal weitersuchen, sondern den Handler **direkt** reproduzieren — auf dem Server in
`~/AivinNet` per `~/.local/bin/uv run python`, Request-Body als Pydantic-Modell bauen,
Handler-Funktion aufrufen, `traceback.print_exc()`. Store-Lookups dabei stubben (der
Nebenprozess hat leere RAM-Stores) und angelegte DB-Zeilen im `finally` wieder entfernen.
So gefunden: der `Paths`-Property-Crash in `save_item_as_playlist` (#82) — Album/Artist →
„New playlist" 500te seit dem Upstream-Refactor e7706065, und weil der Crash **nach**
`insert_playlist` lag, blieb pro Versuch eine leere Playlist zurück (Retry → 409
„already exists"). Beim Aufräumen solcher Trümmer: leere `trackhashes` **plus**
`image = <hash>.webp` ist die Signatur; von Hand angelegte Playlists haben kein Bild.

## ⚠️ Erst prüfen, dann mutieren — der Fehlerpfad darf nichts zerstören

Zweimal derselbe Bug: ein Handler macht seinen Seiteneffekt und validiert danach. Der Aufrufer
bekommt einen sauberen Fehlercode und merkt nicht, dass schon etwas kaputt ist.

- `save_item_as_playlist` (#82) crashte **nach** `insert_playlist` → pro Versuch eine leere
  Playlist als Trümmer, der Retry lief in 409 „already exists".
- `move_playlist` (Client#436) entfernte die Playlist aus **allen** Ordnern und prüfte erst
  danach, ob der Zielordner existiert → 404, und die Ordner-Zuordnung war weg.

Regel: Alle 404/400-Prüfungen an den **Anfang** des Handlers, vor die erste Schreiboperation.
Ein Test dazu heißt nicht „gibt 404" sondern „gibt 404 **und** der Zustand ist unverändert" —
nur die zweite Hälfte hätte beide Bugs gefunden.

## ⚠️ `basis / name_vom_client` ist keine Eingrenzung

`Path`-Join prüft nichts. Zwei Auswege stecken drin, und beide standen live in
`DELETE /backup/delete` direkt vor einem `shutil.rmtree` (Client#437):

- `"../.config/swingmusic"` läuft aus dem Basisverzeichnis heraus,
- ein **absoluter** Name wirft die Basis komplett weg — `Path("/a") / "/etc"` ist `/etc`.

Muster (`api/backup_and_restore.py::resolve_backup_dir`): Kandidat und Basis beide `resolve()`n,
dann `candidate.is_relative_to(root)`; zusätzlich die Basis **selbst** und leere Namen ablehnen,
weil beide auf etwas zeigen, das der Aufrufer nicht benannt hat. Bei Verstoß 400, nicht 404 —
der Unterschied zwischen „gibt's nicht" und „darfst du nicht fragen" ist die Diagnose wert.

## Auth

`app_builder.check_auth_need()` ist die Allowlist — alles, was nicht dort steht, braucht ein
gültiges JWT. Ein neuer öffentlicher Endpoint muss dort eingetragen werden, sonst antwortet er
mit 401, bevor der Handler läuft.

Beim Selbst-Prägen eines Tokens fürs Testen muss `sub` ein **Dict** sein (`{"sub": {"id": 1}}`),
kein JSON-String — der `user_lookup_loader` macht `jwt_data["sub"]["id"]`. Sonst: HTTP 500 auf
jedem Endpoint, während die App-Shell weiter rendert.

## Tests sind Pflicht

Neue oder geänderte Endpoints und Request-Modelle brauchen **`tests_api/`-Abdeckung** des echten
Request-Zyklus. Multipart-Optionalität und das File-Mapping von `flask_openapi3` brechen nur dort
sichtbar — zweimal live passiert (#36→#167/#39).
