---
paths:
  - "install.sh"
  - "appimage/**"
  - ".github/workflows/**"
  - "pyproject.toml"
  - "src/swingmusic/settings.py"
  - "Dockerfile"
  - "swingmusic.spec"
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

- **`pip install --find-links=wheels/ swingmusic` zieht womöglich das UPSTREAM-Paket von PyPI.**
  Die Distribution heißt weiterhin `swingmusic`, Upstream veröffentlicht sie dort, und pip nimmt
  die höhere Version. Ein Tag unterhalb von Upstreams Version hätte still deren Backend mit
  unserem Client ausgeliefert — UI korrekt, aber Endpoints wie Device-Sync und `move-track`
  fehlen. Deshalb `--no-index` bzw. das lokale Wheel zuerst pinnen.
- **`appimage/requirements.txt` ist ein Handduplikat von `[project].dependencies`** (das AppImage
  installiert `swingmusic` mit `--no-deps`). Ein fehlender Eintrag ergibt einen ImportError erst
  beim Start, bei grüner CI. Abgesichert durch `tests/test_packaging_manifests.py` — bei jeder
  neuen Dependency mitpflegen.
- **`settings.py::AssetHandler.RELEASES_URL` muss auf den Fork zeigen**, sonst lädt ein Wheel-
  oder Docker-Install den Upstream-Client. Ein Upstream-Merge stellt den alten Wert
  stillschweigend wieder her → derselbe Test wacht darüber.
- **`libev.so.4` wird in den AppDir kopiert** (bjoern linkt dynamisch, python-appimage bündelt
  keine System-Libs); `appimage/entrypoint.sh` setzt dafür `LD_LIBRARY_PATH`.
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
