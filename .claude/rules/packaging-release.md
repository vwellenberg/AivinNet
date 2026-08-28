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
Client aus `AivinNet-Client`, Wheels, AppImages (x86_64 + aarch64), Einzeldatei-Binaries und
`SHA256SUMS`. Vorher `.github/changelog.md` anpassen — das ist der Release-Body. Für Testläufe
`prerelease=true` + `is_latest=false` setzen und mit `install.sh --version <tag>` installieren
(`/releases/latest` überspringt Prereleases; **Drafts** sind über die API gar nicht sichtbar).

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

## ⚠️ Der entpackte Client überlebt das Update — und wird NICHT erneuert

`setup_default_client` fragt nur, ob eine `index.html` daliegt. Der Client wird aber in den
**Config-Ordner** entpackt, und der überlebt jedes Update (bei Docker ist er ein gemountetes
Volume). Nach einem `docker compose pull` läuft also das neue Backend mit der **alten**
Oberfläche — still, und dauerhaft, weil jeder weitere Start dieselbe Abkürzung nimmt. Am
Homeserver mit zwei Images (v2026.8.0 → v2026.8.1) auf einem Volume reproduziert.

**Offen als AivinNet-Client#551**, und der Versuch, es „mal eben" zu beheben, ist in vier
Review-Runden an sechs Kanten gescheitert — wer es angeht, liest das Issue zuerst. Die drei, die
am meisten überraschen:

- **Ein Versions-Stempel im Client-Ordner darf dort nicht liegen.** `get_client_files_extensions()`
  (`utils/paths.py`) leitet die JWT-freien Endungen aus den Dateinamen **in** diesem Ordner ab —
  eine `.client-version` wäre damit unauthentifiziert abrufbar.
- **Das AppImage hat den Client auf read-only squashfs** (`--client "${APPDIR}/client"` in
  `appimage/entrypoint.sh`). „Kein Stempel ⇒ veraltet" macht daraus bei **jedem** Start einen
  Auffrisch-Versuch, und der `copytree` in ein read-only Verzeichnis wirft ein `OSError`, das die
  bestehende `except`-Liste nicht fängt: Traceback im Startpfad.
- **Ein Draft-Release ist über die anonyme API unsichtbar**, der Download fällt also auf das
  vorherige zurück. Wer dessen Tag stempelt, lädt bei jedem Neustart erneut — und läuft in das
  Limit von 60 Anfragen pro Stunde.

⚠️ **Die Release-Liste von GitHub ist nicht immer eine Liste.** Jenseits des Limits kommt **403
mit einem JSON-Objekt**; darüber zu iterieren liefert Strings, und `release["tag_name"]` warf
einen `TypeError` am Startpfad — im Container mit `restart: unless-stopped` eine Absturzschleife.
Typ und Timeouts sind seit v2026.8.1 geprüft, ein Fehlschlag lässt einen vorhandenen Client
stehen, statt zu sterben.
