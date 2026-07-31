---
paths:
  - "src/swingmusic/api/**"
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
