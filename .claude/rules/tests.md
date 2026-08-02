---
paths:
  - "tests/**"
  - "tests_api/**"
---

# Tests

Zwei Lanes, bewusst getrennt:

| Lane | Verzeichnis | Wie sie läuft |
|---|---|---|
| **Unit (schnell)** | `tests/` | `uvx` mit minimalen Deps — schwere Abhängigkeiten (Flask, SQLAlchemy, Pillow) werden gemockt |
| **API (voller Stack)** | `tests_api/` | eigener CI-Job, `uv sync` + libev, echter `flask_openapi3`-Request-Zyklus |

`bjoern` braucht `libev-dev` + `python3-dev` zum Bauen und fehlt in vielen Umgebungen — deshalb
läuft die schnelle Lane über `uvx` statt über eine volle Installation. Die API-Lane ist auf
Windows **nicht** lauffähig; stattdessen auf dem Server gegen dessen venv:

```bash
scp -r tests_api vwellenberg@192.168.0.4:/tmp/ && \
ssh vwellenberg@192.168.0.4 'cd ~/AivinNet && ~/.local/bin/uv run --with pytest pytest /tmp/tests_api -v'
```

## ⚠️ `sys.modules`-Mocks nur in der geguardeten Form

```python
if name not in sys.modules:          # richtig
    sys.modules[name] = MagicMock()

sys.modules[name] = MagicMock()      # FALSCH — überschreibt echte Libs
```

`conftest.py` importiert die echten `mutagen` und `tinytag` vorab (wenn installiert). Die
geguardete Form no-op't dann, und der Real-Bytes-Test `test_tag_writer_roundtrip.py` sieht die
echten Bibliotheken. Ein unbedingtes Mock überschreibt sie und bricht diesen Test.

Umgekehrt gilt: Wer selbst `sys.modules` mockt, muss die eigenen Mocks danach wieder `pop`en —
pytest importiert **alle** Testmodule beim Collecten, sonst sieht ein später kollektiertes Modul
den Mock statt des echten Moduls.

## ⚠️ Die Mocks vergiften die ganze pytest-Session (Client-Issue #418)

pytest importiert bei der Collection **alle** Testmodule in einem Prozess, und die Mehrheit der
Modul-Level-Mocks wird nie gepoppt — am Ende eines Laufs sind ~20 `sys.modules`-Einträge
MagicMocks (Fremdlibs wie `flask`/`PIL`/`sqlalchemy.orm`, aber auch `swingmusic.db.libdata`).
Konsequenzen für neue Tests in `tests/`:

- **`swingmusic.db` und die Store-/DB-Kette (`store/*`, `lib/tagger`, …) nie echt importieren.**
  In der schnellen Bahn bricht das die gesamte Collection mit einem kryptischen
  `TypeError: metaclass conflict`, dessen Traceback nicht auf die Ursache zeigt. Tests, die
  echtes DB-/Store-Verhalten brauchen, gehören nach `tests_api/` — ein Import kann dort auch
  **gelingen** und trotzdem still Mock-Attribute liefern (z.B. `store.tracks.TrackTable`).
- `conftest.py` importiert deshalb `sqlalchemy.orm` vorab (nicht nur `sqlalchemy`):
  SQLAlchemy 2.0 registriert das Submodul bei `import sqlalchemy` **nicht**, der Mock-Guard
  eines Testmoduls griffe sonst trotz installierter Lib.
- **`pytest tests/ tests_api/` in einem Aufruf geht nicht** — die Trennung (eigene CI-Jobs,
  `testpaths` in `pyproject.toml`) ist Absicht, genau wegen dieser Mocks.

## ⚠️ Mocks verstecken echte DB-Bugs

`tests_api/test_devicesync_api.py` mockt `DeviceTable` weg — deshalb blieb ein HTTP-500 bei
jeder Wiederholungs-Registrierung grün. Für **Tabellen-Logik** gehört ein Test gegen die echten
SQLite-Tabellen dazu (`tests_api/test_device_table.py`), inklusive FK-Usern im Fixture.

## Was in welchen PR gehört (Pflicht)

- **Bugfix ⇒ Regressionstest**, der den Bug reproduziert: vor dem Fix rot, danach grün.
- **Neue/geänderte Endpoints oder Request-Modelle ⇒ `tests_api/`-Abdeckung.** Multipart-
  Optionalität und das File-Mapping von `flask_openapi3` brechen **nur dort** sichtbar —
  zweimal live passiert (#36→#167/#39).
- **Neue Lib-Logik ⇒ Unit-Test** in `tests/`.
- **Realistische Fixtures.** `Album.image` trägt den `?pathhash=`-Suffix; ein Test mit
  geschöntem `hash.webp` hat #34 übersehen.

Der Real-Bytes-Tag-Test liegt bewusst in `tests/` und nicht in einem eigenen Job: `mutagen` und
`tinytag` sind pure Python und laufen in der schnellen Lane mit (Versionen gepinnt auf
`mutagen<2`, `tinytag<3`, passend zum Prod-Major).
