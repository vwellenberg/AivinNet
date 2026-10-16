# Deploy per Knopf (AivinNet#478)

Der Server liegt im LAN und ist von außen nicht erreichbar. Deshalb holt er sich das Signal
selbst: Der Workflow **Deploy** (`.github/workflows/deploy.yml`) setzt den Branch `deploy` auf
einen Commit von `master`, und ein Timer auf dem Server fragt jede Minute nach, wohin `deploy`
zeigt (`scripts/auto-deploy.sh`). Es braucht nur ausgehendes HTTPS: keinen Port, keinen Tunnel,
keinen Self-hosted Runner.

## Auslösen

- **Knopf:** GitHub → Actions → Deploy → „Run workflow" (geht auch in der GitHub-App am Handy).
  Ohne Eingabe wird der aktuelle Stand von `master` deployt, mit einer Commit-SHA von `master`
  genau dieser Commit, auch ein älterer (Rollback).
- **Label:** Ein PR nach `master`, der mit dem Label `deploy` gemergt wird, deployt seinen
  Merge-Commit. Das Label muss einmal angelegt werden (Issues → Labels → New label `deploy`).

Innerhalb einer Minute danach baut der Server den Client, wenn sich `client/` geändert hat, und
startet das Backend neu, wenn sich `src/`, `pyproject.toml` oder `uv.lock` geändert haben.
Danach prüft er, dass die ausgelieferte `index.html` das Entry-Skript dieses Builds lädt.

## Einmal einrichten (auf dem Server)

Voraussetzungen: der Checkout liegt unter `~/AivinNet` (sonst in der `.service`-Datei anpassen),
die sudoers-Regel für `systemctl restart aivinnet` gibt es schon (siehe `client/CLAUDE.md`),
und `yarn` findet sich im `PATH` der Unit (Zeile `Environment=PATH=` erweitern).

```bash
mkdir -p ~/.config/systemd/user
cp ~/AivinNet/scripts/systemd/aivinnet-deploy.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now aivinnet-deploy.timer
sudo loginctl enable-linger "$USER"   # damit der Timer auch ohne Login läuft
```

Prüfen: `systemctl --user list-timers aivinnet-deploy.timer`. Die Läufe stehen im Journal:
`journalctl --user -u aivinnet-deploy -f`.

## Wenn etwas schiefgeht

- **`FAILED <sha>`** im Journal: Der Server hat diesen Commit nicht fertig deployt und versucht
  ihn **nicht** jede Minute neu. Ursache beheben und den Knopf noch einmal drücken — auch für
  denselben Commit: Jeder Lauf des Workflows setzt einen neuen Signal-Commit (Elternteil = der
  Commit von `master`), und jedes neue Signal wird genau einmal bearbeitet.
- **`refusing`**: Der Checkout hat lokale Änderungen oder eigene Commits, oder der Commit liegt
  nicht auf `master`. Der Server überschreibt nie fremde Arbeit.
- Zustand und Lock liegen unter `~/.local/state/aivinnet-deploy/`.
- Ausschalten: `systemctl --user disable --now aivinnet-deploy.timer`.

Servereigenes (Host, Account, Pfade) gehört in `MAINTAINER.local.md`, nicht hierher.
