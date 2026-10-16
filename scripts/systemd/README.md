# Deploy bei jedem Merge (AivinNet#478)

Der Server liegt im LAN und ist von außen nicht erreichbar. Deshalb holt er sich das Signal
selbst: Der Workflow **Deploy** (`.github/workflows/deploy.yml`) setzt den Branch `deploy` auf
einen neuen Signal-Commit, dessen Elternteil der Commit von `master` ist, und ein Timer auf dem
Server fragt jede Minute nach, ob sich `deploy` bewegt hat (`scripts/auto-deploy.sh`). Es braucht nur ausgehendes HTTPS: keinen Port, keinen Tunnel,
keinen Self-hosted Runner.

## Auslösen

- **Jeder Merge** (jeder Push auf `master`) wird deployt. Merges innerhalb einer Minute oder
  während eines laufenden Deploys landen in einem Deploy: Der Server sieht nur das neueste Signal.
- **Knopf:** GitHub → Actions → Deploy → „Run workflow" (geht auch in der GitHub-App am Handy).
  Ohne Eingabe deployt er den aktuellen Stand von `master` noch einmal (nach einem `FAILED`), mit
  einer Commit-SHA von `master` genau diesen Commit, auch einen älteren (Rollback). Ein Rollback
  hält bis zum nächsten Merge.

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

`cp` kopiert den heutigen Stand: Ändern sich die Units im Repo, die zwei Dateien erneut kopieren
und `systemctl --user daemon-reload`.

Wer weiter **von Hand** deployt, nimmt dasselbe Lock, sonst arbeiten Knopf und Hand gleichzeitig
im selben Checkout: `flock ~/.local/state/aivinnet-deploy/lock <befehl>`.

## Wenn etwas schiefgeht

- **`FAILED <sha>`** im Journal: Der Server hat diesen Commit nicht fertig deployt und versucht
  ihn **nicht** jede Minute neu. Ursache beheben und den Knopf noch einmal drücken — auch für
  denselben Commit: Jeder Lauf des Workflows setzt einen neuen Signal-Commit (Elternteil = der
  Commit von `master`), und jedes neue Signal wird genau einmal bearbeitet.
- **`refusing`**: Der Checkout hat lokale Änderungen oder eigene Commits, oder der Commit liegt
  nicht auf `master`. Der Server überschreibt nie fremde Arbeit. Ebenso verweigert: ein Commit
  von **vor** dem Deploy-Knopf (ohne `scripts/auto-deploy.sh` würde der Timer sich selbst
  löschen; weiter zurück geht es nur von Hand) und ein `deploy`-Ref, das nicht vom Workflow kommt.
- Schlägt ein Schritt fehl, **bevor** etwas live ist (`uv sync`, `yarn install`, der Neustart),
  setzt der Server den Checkout auf den laufenden Stand zurück (`undoing` im Journal); nach einem
  gescheiterten Neustart startet er den alten Stand noch einmal. Danach nicht mehr: Ein
  Client-Build, der an seinen Gates scheitert, kann schon ausgeliefert sein.
- **`adopted, not deployed`**: Das allererste Signal einer Box zeigt auf einen Commit, der älter
  ist als der Checkout (Knopf gedrückt, bevor der Timer lief, und danach von Hand deployt). Der
  Server rollt dann nicht ungefragt zurück. Ein zweiter Druck auf denselben Commit deployt ihn.
- Zustand und Lock liegen unter `~/.local/state/aivinnet-deploy/`.
- Ausschalten: `systemctl --user disable --now aivinnet-deploy.timer`.

Servereigenes (Host, Account, Pfade) gehört in `MAINTAINER.local.md`, nicht hierher.
