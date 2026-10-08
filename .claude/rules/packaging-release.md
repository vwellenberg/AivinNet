---
paths:
  - "install.sh"
  - "appimage/**"
  - ".github/workflows/**"
  - "pyproject.toml"
  - "src/aivinnet/settings.py"
  - "Dockerfile"
  - ".dockerignore"
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
folgt `is_latest`, und der Docker-Job verweigert einen Draft (das Image wäre öffentlich, bevor
das Release sichtbar ist). Beide stehen per Default auf der vorsichtigen Seite.

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

- **Die Update-Tests laufen absichtlich in einer Umgebung mit kaputter Zeitzone.** Seit
  2026-10-07 schreibt `apt-get install python3` in einem frischen `ubuntu:24.04`-Container
  `/UTC` nach `/etc/timezone` (tzdata ohne vorherige Zeitzone). pendulum warf darauf, und
  Alben-/Artist-Listen antworteten 500 — schon in 2026.10.1, gefunden erst vom rc-Test, weil
  derselbe Test am Vortag (vor dem tzdata-Update) grün war. Abgefangen in
  `utils/timezone.ensure_local_timezone()` (Fallback UTC). Den Testcontainer NICHT
  „reparieren“: Er ist genau die Umgebung, die den Fehler zeigt.

- **Das Docker-Image (`python:3.11-slim`) hat kein `/etc/mime.types`.** Pythons `mimetypes`
  fällt dann auf seine eingebaute Tabelle zurück, und die kennt weder `.m4a` noch `.flac` — lokal
  (volle Distro) nicht nachstellbar. Audio-Typen stehen deshalb fest in
  `utils/files.py::AUDIO_MIME_TYPES`, Web-Typen registriert `start_aivinnet.config_mimetypes()`
  von Hand; ein neues Format in `utils/filesystem.FILES` braucht dort einen Eintrag
  (`tests/test_audio_mime_types.py`). ⚠️ Der falsche Typ (`audio/m4a`) wurde in #327 für ein
  Firefox-Abspielproblem verantwortlich gemacht — **gemessen stimmt das nicht**, Firefox spielt
  die Datei trotzdem (siehe `api-endpoints.md`, „Welche Formate wo abspielen").
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
- **`settings.py::AssetHandler.RELEASES_URL` muss auf den Fork zeigen**, sonst lädt ein Install
  ohne gebündeltes `client.zip` (Quell-Checkout) den Upstream-Client. Ein Upstream-Merge stellt den alten Wert
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
- **⚠️ `GITHUB_TOKEN` ist nur lesend, Schreibrechte gibt es pro Job (#300).** Beide Workflows
  setzen oben `permissions: contents: read`. Schreiben dürfen nur `upload-builds` (`contents`,
  legt das Release an) und `docker` (`packages`, ghcr). Ohne den Schlüssel bekommt jeder Job die
  Repo-Voreinstellung, und die kann Schreibzugriff auf Code und Releases sein, auch in Jobs mit
  Fremd-Actions oder `appimagetool` *continuous*. Wer einem Job ein Recht gibt, trägt es in
  `ALLOWED_WRITES` (`tests/test_packaging_manifests.py`) ein. Sonst wird `Unit Tests` rot.
- **Ein Release lässt sich für denselben Tag erneut starten** (`git tag -f` in `build-wheels`,
  #300). Vorher scheiterte das, weil `fetch-depth: 0` den schon veröffentlichten Tag mitbrachte.
  ⚠️ Gebaut wird aber, wovon der Lauf gestartet wurde. Eine Wiederholung startet man deshalb
  **vom Tag aus** („Use workflow from" → Tag `v…`), nicht von `master`. Sonst landet neuerer Code
  unter der alten Versionsnummer: `ncipollo/release-action` verschiebt einen bestehenden Tag
  nicht und hängt die neuen Dateien an das alte Release.
- **Musikordner auf externem Mount ⇒ `RequiresMountsFor=` in der Unit.** Startet der Dienst vor
  dem Mount, entfernt der Scan alle „fehlenden" Tracks aus der DB
  (`lib/tagger.py::remove_tracks_by_filepaths`) → Playlists voller Waisen. `install.sh --music`
  setzt das.
- **Erst-Admin-Passwort** kommt aus `AIVINNET_ADMIN_PASSWORD` (`utils/bootstrap.py`, greift nur
  beim Erzeugen des Default-Users). Bewusst **Env statt CLI-Flag**: Prozess-Argumente sind über
  `/proc/<pid>/cmdline` für alle lesbar.
- **⚠️ Datendateien im Paket (`assets/` …) MÜSSEN in `[tool.setuptools.package-data]` stehen.**
  Sonst nimmt sie nur setuptools-scm mit — und das sieht Git-Dateien nur, wenn `.git` da ist.
  Das Wheel (gebaut aus dem Checkout) war komplett, das **Docker-Image** (`COPY src/`, ohne
  `.git`) hatte bis v2026.8.5 **keine** Platzhalterbilder: jedes Album ohne Cover ein kaputtes
  Bild, im Log `Assets dir could not be found`. Kein Test sah es, weil alle gegen `src/` laufen.
  Seitdem: `TestPackageData` (schnell) + Job `Docker Smoke Test` in `ci.yml`, der das Image
  **baut und startet** — vorher baute nur der Release-Workflow es, und startete es nie.
- **⚠️ Die Version hat genau EINE Quelle: die pip-Metadaten** (`Metadata.version`, #192). Wheel,
  AppImage und Binary bekommen sie von setuptools-scm aus dem Git-Tag. Das **Docker-Image** wird
  ohne `.git` gebaut — dort trägt `--build-arg app_version` sie über
  `SETUPTOOLS_SCM_PRETEND_VERSION_FOR_AIVINNET` in die Metadaten (führendes `v` wird
  abgeschnitten). **Ein Build-Arg ohne passendes `ARG` im Dockerfile verwirft Docker
  kommentarlos** — genau so war `app_version` wirkungslos, und das Image las stattdessen eine
  `version.txt` **relativ zum Arbeitsverzeichnis** (`docker run -w /tmp … --version` →
  `FileNotFoundError`). Veröffentlichte Images stimmten nur, weil der Release-Job die Datei
  direkt vor dem Build überschrieb; jeder andere Build (lokal, CI) meldete die eingecheckte
  Kopie, seit v2026.8.2 nicht mehr gebumpt. Die Datei ist weg; ein nacktes `docker build .`
  meldet ehrlich **`0.0.0`** — für den Client egal, der ist gebündelt (siehe unten).
  Wächter: `TestImageVersion` (Arg ↔ `ARG`) und der Versions-Check im `Docker Smoke Test`.
  Zwei Folgen: (a) setuptools-scm **normalisiert** — Tag `v2026.8.1-rc1` wird zu `2026.8.1rc1`;
  deshalb vergleicht der Client-Download über `release_matches_version`, nie als String.
  (b) `metadata.version("aivinnet")` **mit Literal** stehen lassen — PyInstaller sammelt die
  Metadaten nur, wenn es den Aufruf mit konstantem Argument im Bytecode findet.
- **Im Container zeigt `XDG_CONFIG_HOME` auf `/config`** (Dockerfile), damit ein nacktes
  `aivinnet --password-reset` dieselbe DB trifft wie der Server. Ohne das legte es unter
  `/root/.config` eine leere zweite Instanz an und meldete „successfully" für ein Passwort, das
  der Server nie sah.
- **Shellcheck läuft in CI** über `install.sh` und `appimage/entrypoint.sh` (Job `Lint & Format`)
  — beides ausgelieferte Skripte, die kein Python-Test abdeckt.
- **⚠️ Unter `curl | bash` IST stdin das restliche Skript.** Jeder Kindprozess, der stdin liest
  (Paketmanager, `sudo`, ein `read`), frisst den Rest der Installation, und bash führt danach
  einfach nichts mehr aus, ohne Fehler. Antworten also von `/dev/tty` lesen und Kindprozesse mit
  `</dev/tty` starten; vorher per `(: </dev/tty)` prüfen, ob es überhaupt ein Terminal gibt
  (cron/CI: nur Hinweis ausgeben). Nachgewiesen an der ffmpeg-Rückfrage (#197): ohne
  `</dev/tty` las der Stub genau die nächste Skriptzeile.
- **ffmpeg ist NICHT im AppImage** (Größe + GPL-Quellpflicht). Gebraucht wird es nur für die
  Stille-Erkennung (pydub). `install.sh` bietet das Distro-Paket an (Default Ja), der Server
  meldet beim Start, wenn es fehlt (`start_info_logger.has_ffmpeg`). Fedora: `ffmpeg-free`,
  nicht `ffmpeg` (das bräuchte RPM Fusion).

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

## ⚠️ Das Docker-Image bündelt seinen Client — Server und Oberfläche aus EINEM Commit

**Bis 2026-10 brachte das Image keinen Client mit** (`COPY src/` + `pip install`, kein
`client.zip`), `extract_default_client` lieferte `False`, und der Server lud beim ersten Start
den Client des Releases seiner Version — für jedes Image, das kein veröffentlichtes Release ist
(master, PR, nacktes `docker build .` = `0.0.0`), also den **neuesten stabilen**. Beobachtet:
master-Server mit v2026.9.0-Client. Jede API-Änderung auf master brach solche Images lautlos.

Seitdem baut das `Dockerfile` den Client in einer **Node-Stage** aus `client/` und legt
`src/aivinnet/client.zip` **vor** `pip install .` ab. Drei Kopplungen, die man nicht sieht:

- **Zip-Layout: GENAU ein Top-Level-Ordner `client/`** (wie `zip -r client.zip client` im
  Release-Workflow). `extract_default_client` entpackt ins Config-Verzeichnis, serviert wird
  `<config>/client` — ein Zip des Ordner-*Inhalts* streut `index.html` in den Config-Ordner.
  Die Stage nimmt `python -m zipfile -c … client` (benennt Top-Level-Einträge nach dem Basename).
- **`client.zip` steht in `[tool.setuptools.package-data]`.** Die Datei ist untracked
  (`.gitignore`), setuptools-scm sieht sie also **nie** — ohne den Eintrag fehlt sie im Image
  *und* im Wheel, und der Server fällt still auf den Download zurück.
- **Veraltet wird ein gebündelter Client über den Digest des Zips, nicht über die Version**
  (`bundled_client_fingerprint`, Feld `bundle` im Stempel). Zwei master-Images sind beide
  `0.0.0` — nach Version wäre das zweite „aktuell" und behielte den Client des ersten im Volume;
  ebenso ein Volume aus der Download-Zeit (Stempel `requested: 0.0.0`, ohne `bundle`), das sonst
  den heruntergeladenen Release-Client für immer behielte. „Kein Stempel" heißt weiterhin
  „in Ruhe lassen", ein fremder Client-Ordner (`--client`, AppImage) bleibt unberührt.
  Gehasht wird der **Inhalt** (Namen + entpackte Bytes), nicht das Zip — das trägt mtimes, ein
  No-Cache-Rebuild desselben Commits sähe sonst wie ein neuer Client aus.
- **Ersetzen, nicht überlagern.** `extract_default_client` entpackt in einen Geschwister-Ordner
  und tauscht per Rename. Drüber-Entpacken ließ alte Dateien liegen — und `serve_client_files`
  bevorzugt `<datei>.gz`: ein übrig gebliebenes `foo.js.gz` neben neuem `foo.js` (kleine Dateien
  bekommen kein `.gz`) lieferte jedem gzip-Browser den **alten** Code.
- **Ein gescheitertes Entpacken ist kein Absturz.** Für Docker ist das der Refresh-Pfad; eine
  Exception dort wäre unter `restart: unless-stopped` eine Absturzschleife. Liegt ein Client da,
  wird er weiter serviert (ohne Stempel, der nächste Start versucht es erneut); nur ganz ohne
  Client endet der Start wie bisher.

Die Node-Stage läuft mit `--platform=$BUILDPLATFORM` (statische Dateien, einmal nativ statt unter
QEMU pro Architektur) auf dem **vollen** `node:20`-Image: `sharp` (Dev-Dep über
`@vite-pwa/assets-generator`) fällt ohne Prebuilt auf node-gyp zurück und braucht dann
python/make/g++. `.dockerignore` hält `node_modules`, `.git` und `.claude` (Worktrees!) aus dem
Kontext, `client/` muss drin bleiben (`TestDockerfile` prüft beides). Der `Docker Smoke Test`
schreibt deshalb **keinen Stub-Client** mehr, sondern prüft, dass `/` ein gebauter Client mit
gehashtem `assets/index.*.js` ist, kein `Downloading from GitHub` im Log steht und der Stempel
einen `bundle`-Digest trägt.

## Der Client-Download aus dem Release (nur noch ohne gebündeltes Zip)

Greift nur noch, wenn kein `client.zip` im Paket liegt (Quell-Checkout, `pip install` aus Git).

⚠️ **Die Release-Liste von GitHub ist nicht immer eine Liste.** Jenseits des Limits kommt **403
mit einem JSON-Objekt**; darüber zu iterieren liefert Strings, und `release["tag_name"]` warf
einen `TypeError` am Startpfad — im Container mit `restart: unless-stopped` eine Absturzschleife.
Typ und Timeouts sind seit v2026.8.1 geprüft, ein Fehlschlag lässt einen vorhandenen Client
stehen, statt zu sterben.
