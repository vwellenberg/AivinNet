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
| **API (voller Stack)** | `tests_api/` | eigener CI-Job, `uv sync` (+ libev auf Linux), echter `flask_openapi3`-Request-Zyklus |

Beide laufen in der CI auf Linux **und** Windows (Matrix in `ci.yml`, seit #508), mit demselben
Befehl.

`bjoern` braucht `libev-dev` + `python3-dev` zum Bauen und fehlt in vielen Umgebungen — deshalb
läuft die schnelle Lane über `uvx` statt über eine volle Installation.

**Beide Lanes laufen auf Windows grün** — die API-Lane mit waitress statt bjoern (`pyproject.toml`),
also ohne libev: `uv run --frozen pytest -p no:cacheprovider tests_api/` (2026-10-17: 808 grün,
11 übersprungen); die schnelle Lane mit dem Befehl aus `CLAUDE.md` (1186 grün, 31 übersprungen).
**Ein roter Test auf Windows ist deshalb ein Befund**, keine Plattformfolge: Plattformgrenzen
sind als `skipif(os.name == "nt", reason=…)` markiert und stehen im `-rs`-Bericht —

- **Symlinks** (`symlink_to`): brauchen unter Windows Admin oder Entwicklermodus (WinError 1314).
- **POSIX-Rechte** (`TestFilePermissions`, `…tightens_a_config_file…` in `test_hardening_basics.py`):
  `os.chmod` setzt unter Windows nur Read-only; `restrict_to_owner` ist dort bewusst best-effort.
- `time.tzset`, bjoern und POSIX-Signale.

Bis #508 lief die CI nur auf Linux und sah Windows-Bugs nicht. Der erste vollständige Windows-Lauf
fand einen: „Play“ auf einer Ordnerkarte (`/folder/tracks/all`) spielte dort **nichts**, weil der
Endpoint `str(resolved)` (`C:\Music\Album`) mit den gespeicherten `C:/Music/Album/…` verglich. Die
Tests dazu waren grün — ihre Fixture machte denselben Fehler. Seitdem laufen beide Lanes auch auf
`windows-latest` (`Unit Tests (Windows)`, `API Tests (Windows)`).

⚠️ **Gespeicherte Pfade sind POSIX, auf jeder Plattform** (`taglib`: `filepath.as_posix()`,
Scanner: `entry.as_posix()`). Daraus:

- Fixture-Pfade und Vergleiche mit `.as_posix()`, nie `str(path)` — `str()` trägt auf Windows
  Backslashes. Im App-Code Präfixe über `utils/filesystem.dir_prefix`, nie über `str(resolved)`.
- Ausgedachte Pfade wie `/music/Rock` sind auf Windows nicht absolut: Was sie `resolve()`t, landet
  bei `C:/music/Rock`. Wo der getestete Code resolved, die Basis aus
  `Path("/music").resolve().as_posix()` bauen.
- `expanduser` liest unter Windows `USERPROFILE`, nicht `HOME` — im Test beide setzen.

Wer bjoern oder die übersprungenen POSIX-Fälle selbst prüfen will, nimmt den Server und dessen venv:

```bash
# Host, Account und Key stehen in der globalen ~/.claude/CLAUDE.md (nicht im Repo).
scp -r tests_api <account>@<homeserver>:/tmp/ && \
ssh <account>@<homeserver> 'cd ~/AivinNet && ~/.local/bin/uv run --with pytest pytest /tmp/tests_api -v'
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
MagicMocks (Fremdlibs wie `flask`/`PIL`/`sqlalchemy.orm`, aber auch `aivinnet.db.libdata`).
Konsequenzen für neue Tests in `tests/`:

- **`aivinnet.db` und die Store-/DB-Kette (`store/*`, `lib/tagger`, …) nie echt importieren.**
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

## ⚠️ Eine Testinstanz mit kopierter Datenbank kennt die ECHTE Bibliothek

Wer für einen End-to-End-Test eine zweite App-Instanz mit einer Kopie von `aivinnet.db` startet
und `rootDirs` auf einen Testordner umbiegt, hat **nichts isoliert**: die `track`-Zeilen der
Kopie tragen die echten Pfade, und weil diese Dateien existieren, behält die Instanz sie beim
Start und arbeitet mit ihnen (erst ein Scan wirft Zeilen außerhalb der `rootDirs` raus, #391 —
gestartet wird ohne Scan). So hat
der erste E2E-Lauf von #144 die 94 **echten** Dateien eines Albums umbenannt statt der Kopie
(sofort zurückbenannt, 2026-09-23). Die Suche fand das Album unter beiden Pfaden — der Test
sah grün aus.

Deshalb, alle drei:

- In der Kopie **`DELETE FROM track`** vor dem Start — Nutzer, Server-ID (JWT) und Einstellungen
  bleiben, die Bibliothek nicht. Danach einmal `/notsettings/trigger-scan`: ohne periodische
  Scans indexiert der Start nichts von selbst.
- **Harter Abbruch** im Testskript, sobald ein Pfad außerhalb des Testordners auftaucht — vor
  jedem schreibenden Aufruf, nicht erst in der Auswertung.
- **Prüfsumme** der Namensliste des echten Ordners vor und nach dem Lauf vergleichen.

## ⚠️ Die CI läuft in UTC — Zeitzonen-Bugs sieht sie nicht

GitHub-Runner laufen in UTC (`ci.yml` setzt kein `TZ`). Ein Grenzfall, der nur **westlich von UTC** bricht, bleibt dort
grün: In New York ist die erste Sekunde von Jahr 10000 noch der 31.12.9999, `fromtimestamp`
nimmt sie an, und `timestamp_to_time_passed` lief erst eine Zeile später, außerhalb des Guards,
in einen `OverflowError`. Aufgefallen ist das nur, weil die schnelle Bahn einmal unter
`TZ=America/New_York` lief. Code, der lokale Zeit rechnet, lokal einmal mit
`TZ=America/New_York` und `TZ=Asia/Tokyo` laufen lassen; ein Regressionstest setzt die
Zone selbst (`monkeypatch.setenv("TZ", …)` + `time.tzset()` + `pendulum.set_local_timezone(
pendulum.timezone(…))`, danach alles zurück). ⚠️ `set_local_timezone` nimmt **kein** `str` —
ein String wirft `TypeError`, und der Test ist „rot ohne Fix“ aus dem falschen Grund.

⚠️ **Ein Grenzfall, der mit Float-Zeit rechnet, ist ein Würfel.** `timestamp_to_time_passed`
rechnete „jetzt minus Differenz". Bei 2,5e11 s ist ein Float-Schritt etwa 30 µs groß, und ob
Jahr 10000 überlief oder „in 7973 years" ergab, entschied die Rundung: zwei von drei Aufrufen
lieferten das Zweite. Der Test aus #411 war deshalb auf `master` zufällig grün und auf dem
nächsten PR rot. Grenzfälle direkt aus dem Zeitstempel rechnen (`pendulum.from_timestamp`). Der
Test ruft die Funktion mehrfach auf, denn ein einzelner Aufruf beweist hier nichts.

## Was in welchen PR gehört (Pflicht)

- **Bugfix ⇒ Regressionstest**, der den Bug reproduziert: vor dem Fix rot, danach grün.
- **Neue/geänderte Endpoints oder Request-Modelle ⇒ `tests_api/`-Abdeckung.** Multipart-
  Optionalität und das File-Mapping von `flask_openapi3` brechen **nur dort** sichtbar —
  zweimal live passiert (#36→#167/#39).
- **Neue Lib-Logik ⇒ Unit-Test** in `tests/`.
- **Realistische Fixtures.** `Album.image` trägt den `?pathhash=`-Suffix; ein Test mit
  geschöntem `hash.webp` hat #34 übersehen. Ebenso: `AlbumStore.albummap` und
  `ArtistStore.artistmap` halten **Wrapper** (`AlbumMapEntry.album`, `ArtistMapEntry.artist`),
  keine Alben — ein `SimpleNamespace(created_date=…)` als Map-Wert ließ #400 grün, bis der
  Smoke-Test am gebauten Server `AttributeError` warf. Map-Werte mit den echten Entry-Klassen bauen.

Der Real-Bytes-Tag-Test liegt bewusst in `tests/` und nicht in einem eigenen Job: `mutagen` und
`tinytag` sind pure Python und laufen in der schnellen Lane mit (Versionen gepinnt auf
`mutagen<2`, `tinytag<3`, passend zum Prod-Major).

## End-to-end: `e2e/` (gebauter Server, echter Scan)

`e2e/make_library.py` erzeugt eine kleine Bibliothek mit den Formen einer echten (Ordner mit zwei
Alben, Doppel-CD, Sampler, „feat.“, Umlaute/Japanisch, Duplikat, Datei ohne Tags, tiefe Ordner) —
stille MP3s, nichts Binäres im Git. `e2e/check_pages.py <url> <passwort> <musik-root>` scannt sie
und fragt jede Hauptseite ab wie der Client (≈180 Requests). Läuft im CI-Job `Docker Smoke Test`
und gehört in jeden Release-Test. ⚠️ Es **schreibt** (Playlist, Favoriten, Play) — nur gegen
Wegwerf-Instanzen, nie gegen den Live-Server.

Warum es das gibt: Handgemachte Testdaten hatten in jedem Ordner genau ein Album. Der Pfad
„Ordner mit zwei Alben“ brach Home und die Ordnersuche im veröffentlichten 2026.10.2 (#388),
während alle Unit-, API- und Update-Tests grün waren. Neue Seiten/Endpoints des Clients gehören
hier mit hinein; neue Bibliotheksformen, die etwas kaputt gemacht haben, in den Generator.

