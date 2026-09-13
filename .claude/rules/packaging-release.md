---
paths:
  - "install.sh"
  - "appimage/**"
  - ".github/workflows/**"
  - "pyproject.toml"
  - "src/aivinnet/settings.py"
  - "Dockerfile"
  - "aivinnet.spec"
---

# Auslieferung an Dritte (Release + Installer)

Freunde installieren per **AppImage**, nicht per Quell-Checkout. `install.sh` (Repo-Root) lädt
das Release-Asset, prüft die Checksumme, **entpackt** es nach `~/.local/share/aivinnet` (kein
FUSE/`libfuse2` nötig) und legt einen systemd-Dienst an (User-Dienst + `enable-linger` als
Default, `--system` für systemweit). Flags: `--system`, `--no-autostart`, `--port`, `--host`,
`--music`, `--version`, `--update`, `--uninstall`.

**Release ziehen:** Workflow `Release` (`.github/workflows/build.yml`, `workflow_dispatch`) baut
Client aus `client/`, Wheels, AppImages (x86_64 + aarch64), Einzeldatei-Binaries und
`SHA256SUMS`. Vorher `.github/changelog.md` anpassen — das ist der Release-Body. Für Testläufe
`prerelease=true` + `is_latest=false` setzen und mit `install.sh --version <tag>` installieren
(`/releases/latest` überspringt Prereleases; **Drafts** sind über die API gar nicht sichtbar).

Ein echter Release braucht `is_draft=false` **und** `is_latest=true`: `:latest` beim Docker-Image
folgt `is_latest`, und ein Draft ist für den Client-Download unsichtbar (siehe unten). Beide
stehen per Default auf der vorsichtigen Seite.

**Seit dem Monorepo ist ein Release aus seinem Tag reproduzierbar.** Vorher klonte der Workflow
das Client-Repo **ungepinnt** — ein erneuter Lauf desselben Tags hätte die inzwischen weiterge-
wanderte Oberfläche eingepackt.

**Rauchtest, der sich bewährt hat** (jedes Release seit v2026.8.1 so abgenommen): das echte
Release-AppImage herunterladen, Checksumme prüfen, mit einem **Wegwerf-`HOME`** und
`--host 127.0.0.1 --port <frei>` starten, dann vier Dinge messen — generiertes Passwort im Log,
geschützter Endpunkt ohne Login **401** und mit Login **200**, die vier Security-Header, und die
**Client-Version im ausgelieferten Bundle** (`curl / | grep -o "/assets/index[^\"]*\.js"`, dann im
Bundle nach der Version greppen). Letzteres ist der einzige Beleg, dass wirklich der neue Client
drinsteckt und nicht ein Cache-Treffer.

⚠️ **Testinstanz über den PORT beenden, nie über `kill $!`** — beim entpackten AppImage trifft das
nur den Wrapper, das Kind überlebt (und lauscht dann eventuell noch auf `0.0.0.0`).

## ⚠️ Fallen, die hier schon zugeschlagen haben

- **Die PyPI-Namenskollision ist seit der Umbenennung weg — `--no-index` bleibt trotzdem.**
  Solange die Distribution `swingmusic` hieß, konnte `pip install --find-links=wheels/ swingmusic`
  das **Upstream**-Paket von PyPI ziehen (gleicher Name, höhere Version) und still deren Backend
  mit unserem Client ausliefern: UI korrekt, aber Device-Sync und `move-track` fehlen. Seit sie
  `aivinnet` heißt, gibt es auf PyPI nichts, was gewinnen könnte. Die `--no-index`-Flags im
  Workflow bleiben als Gürtel-und-Hosenträger stehen — sie kosten nichts und halten den Build
  offline-deterministisch.
- **`appimage/requirements.txt` ist ein Handduplikat von `[project].dependencies`** (das AppImage
  installiert `aivinnet` mit `--no-deps`). Ein fehlender Eintrag ergibt einen ImportError erst
  beim Start, bei grüner CI. Abgesichert durch `tests/test_packaging_manifests.py` — bei jeder
  neuen Dependency mitpflegen.
- **`settings.py::AssetHandler.RELEASES_URL` muss auf den Fork zeigen**, sonst lädt ein Wheel-
  oder Docker-Install den Upstream-Client. Ein Upstream-Merge stellt den alten Wert
  stillschweigend wieder her → derselbe Test wacht darüber.
- **`libev.so.4` wird in den AppDir kopiert** (bjoern linkt dynamisch, python-appimage bündelt
  keine System-Libs); `appimage/entrypoint.sh` setzt dafür `LD_LIBRARY_PATH`.
- **⚠️ Der AppDir-Name kommt aus `Name=` im Desktop-File, NICHT aus `-n`.**
  `python-appimage build app -n aivinnet-x86_64 --no-packaging` legt das Verzeichnis als
  **`AivinNet-x86_64`** an (`Name=AivinNet` in `appimage/aivinnet.desktop`); `-n` ist der
  *Anwendungsname* fürs Paketieren. Der Workflow schrieb den kleingeschriebenen Namen danach in
  jeden Folgeschritt — und **`pip install --target` legt ein fehlendes Verzeichnis einfach an**,
  also entstand ein zweites, leeres AppDir. appimagetool bekam dieses und brach mit
  `Desktop file not found, aborting` ab, während das echte daneben lag: ohne aivinnet, ohne
  libev. Beide AppImage-Jobs von v2026.8.0-rc1 starben daran.
  **Deshalb wird der Pfad gesucht, nicht geschrieben:** das Verzeichnis, das ein `AppRun`
  enthält (`find -maxdepth 1 -type d -exec test -e '{}/AppRun' \;`), Ergebnis als `$APPDIR` in
  `$GITHUB_ENV`, und bei ≠ 1 Treffer hart abbrechen. Ein eigener Schritt prüft vor dem
  Paketieren, dass `.desktop`, `aivinnet`, `libev.so.4` und `client` wirklich drin sind — im
  Attrappen-Verzeichnis fehlt jedes davon. Zensus in `tests/test_packaging_manifests.py`
  (`TestAppimageWorkflow`), weil die Kopplung unsichtbar ist: Wer die App im Desktop-File
  umbenennt, bricht einen Workflow drei Dateien weiter.
- **⚠️ Die Build-Toolchain ist ungepinnt** (`pip install python-appimage`, `appimagetool`
  *continuous*). Ein Release-Lauf baut also nicht zwangsläufig mit derselben Toolchain wie der
  letzte. Wenn ein Schritt „ohne Zutun" bricht, zuerst die Version im Log ablesen
  (`Successfully installed …`) und gegen das PyPI-Datum halten, statt im eigenen Diff zu suchen.
- **Ein übersprungener `needs`-Job überspringt den abhängigen Job.** Mit `binary_build=false`
  entstand früher gar kein Release, bei grüner Übersicht. `upload-builds` prüft die Job-Results
  jetzt explizit.
- **Musikordner auf externem Mount ⇒ `RequiresMountsFor=` in der Unit.** Startet der Dienst vor
  dem Mount, entfernt der Scan alle „fehlenden" Tracks aus der DB
  (`lib/tagger.py::remove_tracks_by_filepaths`) → Playlists voller Waisen. `install.sh --music`
  setzt das.
- **Erst-Admin-Passwort** kommt aus `AIVINNET_ADMIN_PASSWORD` (`utils/bootstrap.py`, greift nur
  beim Erzeugen des Default-Users). Bewusst **Env statt CLI-Flag**: Prozess-Argumente sind über
  `/proc/<pid>/cmdline` für alle lesbar.
- **Shellcheck läuft in CI** über `install.sh` und `appimage/entrypoint.sh` (Job `Lint & Format`)
  — beides ausgelieferte Skripte, die kein Python-Test abdeckt.

## Der entpackte Client überlebt das Update — seit v2026.8.3 wird er erneuert

Der Client wird in den **Config-Ordner** entpackt, und der überlebt jedes Update (bei Docker ist
er ein gemountetes Volume). Bis v2026.8.2 fragte `setup_default_client` nur, ob eine `index.html`
daliegt — nach einem `docker compose pull` lief also das neue Backend mit der **alten**
Oberfläche, still und dauerhaft, weil jeder weitere Start dieselbe Abkürzung nahm. Am Homeserver
mit zwei Images auf einem Volume reproduziert (Client#551).

**Behoben in v2026.8.3** (Backend#127). Wie es gelöst ist, und warum es so aussieht — die drei
Hindernisse aus vier Review-Runden sind der Grund für jede einzelne Entscheidung:

- **Der Stempel liegt NICHT im Client-Ordner**, sondern als `client.version` im Config-Ordner
  daneben (`AssetHandler.CLIENT_STAMP_NAME`). `get_client_files_extensions()` (`utils/paths.py`)
  leitet die JWT-freien Endungen aus den Dateinamen **in** dem Ordner ab — eine Datei darin wäre
  unauthentifiziert abrufbar gewesen.
- **„Kein Stempel" heißt bewusst „in Ruhe lassen"**, nicht „veraltet". Die Umkehrung machte aus
  jedem AppImage-Start einen Auffrisch-Versuch: dort liegt der Client auf read-only squashfs
  (`--client "${APPDIR}/client"`), und der `copytree` warf ein `OSError`, das die bestehende
  `except`-Liste nicht fing — Traceback im Startpfad. `client_stamp_path()` gibt deshalb `None`
  zurück, sobald der Client-Pfad nicht `config_dir/client` ist: ein Install, dem sein Client
  nicht gehört, fasst ihn nicht an.
- **Gestempelt wird die ANGEFRAGTE Version, nicht die installierte.** Ein Release, dessen Client
  nicht geladen werden kann (Draft, Rate-Limit, kein Netz), wird damit **einmal pro Version**
  versucht statt einmal pro Neustart. Ein Draft-Release ist über die anonyme API unsichtbar, der
  Download fällt also auf das vorherige zurück — wer dessen Tag stempelt, lädt bei jedem Start
  erneut und läuft in das Limit von 60 Anfragen pro Stunde.

⚠️ **Eine Generation muss trotzdem von Hand geräumt werden.** Wer mit **v2026.8.2 oder älter**
installiert hat, besitzt einen Client **ohne** Stempel — und „kein Stempel" heißt oben bewusst
„in Ruhe lassen". Diese Installationen erneuern sich also auch durch spätere Upgrades nicht von
selbst: einmal den `client`-Ordner löschen, danach läuft es automatisch. Ab v2026.8.3 installiert
= nichts zu tun. Das gehört in die Release-Notes, solange es Installationen von vor 8.3 geben
kann.

## ⚠️ Der Datenordner hängt vom Installationsweg ab

Es ist **nicht** ein Pfad, und das stand jahrelang falsch als einer in den Release-Notes — gefunden
erst beim Rauchtest zu v2026.8.3, als das AppImage in einem Wegwerf-`HOME` etwas anderes anlegte
als dokumentiert:

| Weg | Ordner |
|---|---|
| nacktes AppImage/Binary ohne `--config` | **`~/.aivinnet/`** (dotted, direkt in `$HOME` — `config_folder_name` in `settings.py`) |
| Einzeiler-Installer | **`~/.config/aivinnet/`** (`install.sh` setzt `DATA_DIR`) |
| Docker | **`config/aivinnet/`** neben der Compose-Datei |

Das ist doppelt wichtig, sobald eine Anweisung den Ordner nennt (siehe den Hand-Schritt oben):
ein Pfad, den die eigene Installation nicht benutzt, liest sich als „betrifft mich nicht".

## ⚠️ Der Client-Download aus dem Release

Das Docker-Image bringt keinen Client mit und lädt ihn beim ersten Start aus dem Release seiner
eigenen Version — dieser Pfad ist also ein Startpfad, kein Nebenschauplatz.

⚠️ **Die Release-Liste von GitHub ist nicht immer eine Liste.** Jenseits des Limits kommt **403
mit einem JSON-Objekt**; darüber zu iterieren liefert Strings, und `release["tag_name"]` warf
einen `TypeError` am Startpfad — im Container mit `restart: unless-stopped` eine Absturzschleife.
Typ und Timeouts sind seit v2026.8.1 geprüft, ein Fehlschlag lässt einen vorhandenen Client
stehen, statt zu sterben.
