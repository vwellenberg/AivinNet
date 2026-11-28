---
name: release
description: Neuen AivinNet-Release ziehen und abnehmen ("neuer Release", "release bitte", "Release bauen"). Changelog, README-Check, Workflow starten, mit scripts/release.sh verify prüfen, fehlendes macOS-Binary nachholen.
---

# Release ziehen und abnehmen

Ablauf für einen Release, der auf GitHub erscheinen soll. Die Fallen stehen in
[.claude/rules/packaging-release.md](../../rules/packaging-release.md). Dort lesen, bevor du anfängst.

## Checkliste

1. **Delta prüfen.** `git fetch origin master`, dann
   `git log --oneline v<letzter Tag>..origin/master`. Den letzten Tag liefert
   `curl -s https://api.github.com/repos/vwellenberg/AivinNet/releases/latest` (Feld `tag_name`).
   Reverts gegeneinander aufrechnen. Berührt das Delta Sicherheitsflächen (Login, Pfade, Uploads,
   Outbound), zuerst das Review aus packaging-release.md, Abschnitt „Vor `rc`: Review des Deltas“.
2. **Version festlegen.** Format `YYYY.M.N`, ohne führendes `v`. N zählt im Monat fort: nach
   2026.11.11 kommt 2026.11.12, im Dezember 2026.12.1.
3. **Changelog** `.github/changelog.md` (das ist der Release-Body):
   - Neuer Block unter „## What's new in this release“, erste Zeile:
     `<Kurzfassung>, on top of <vorige Version>.`
   - Darunter Stichpunkte mit fettem Einstieg, aus Nutzersicht, ohne PR-Nummern.
   - Der bisherige Block wandert direkt darunter in
     `<details><summary>What v<vorige> brought</summary> … </details>`. Ältere `<details>` bleiben.
4. **README** („What it does“, Hero-Alt-Text) auf den Stand bringen. `appimage/aivinnet.appdata.xml`
   nur, wenn seine Beschreibung betroffen ist. Screenshots nur bei größeren sichtbaren Änderungen,
   Rezept: `scripts/demo/README.md`, Abschnitt „Screenshots and the demo clip“.
5. **PR** öffnen, nicht als Draft. Dann Squash-Auto-Merge einschalten
   (`gh pr merge --repo vwellenberg/AivinNet --squash --delete-branch --auto`; ohne gh
   `mcp__github__enable_pr_auto_merge`) und den Merge abwarten.
6. **Workflow starten** (`build.yml`, ref `master`) mit den Inputs
   `tag=<Version>`, `binary_build=true`, `is_draft=false`, `prerelease=false`, `is_latest=true`,
   `build_docker=true`.
   - Cloud-Session ohne gh: GitHub-MCP `actions_run_trigger`, method `run_workflow`,
     workflow_id `build.yml`, ref `master`.
   - Lokal mit gh: `gh workflow run build.yml --repo vwellenberg/AivinNet --ref master -f tag=<Version> -f binary_build=true -f is_draft=false -f prerelease=false -f is_latest=true -f build_docker=true`
   - Der rc/test/final-Weg mit Testhost bleibt lokalen Sessions vorbehalten (`scripts/release.sh`,
     siehe packaging-release.md, „Release in einem Rutsch“).
   - Dauer etwa 30 bis 40 Minuten. Im Hintergrund warten, nicht im Vordergrund pollen.
7. **Abnahme:** `bash scripts/release.sh verify <Version>`
   - Exit 0: fertig.
   - Exit 2: nur das macOS-Binary fehlt. Fehlgeschlagene Jobs des Laufs neu starten:
     MCP `actions_run_trigger`, method `rerun_failed_jobs`, bzw. `gh run rerun <id> --failed`.
     Das baut auch Docker aus demselben Commit neu. Danach erneut verify. Klappt es tagsüber nicht,
     einen Versuch kurz nach Mitternacht (Europe/Berlin) planen; dann sind die macOS-Runner meist frei.
   - Exit 1: echter Fehler. Ursache in den Job-Logs suchen, nichts schönreden.
   - Endet der Lauf als `startup_failure` (ohne Jobs, ein GitHub-Problem), hilft kein Rerun:
     den Workflow einfach noch einmal starten (so bei v2026.11.8).
8. **Aufräumen.** Ältere Releases entfernt der Workflow selbst, die Tags bleiben. Worktree und
   Branch entfernen.
9. **Melden.** Dem User kurz Version, Inhalt und das verify-Ergebnis nennen.

`verify` braucht nur curl, python3 und sha256sum, kein gh, und läuft auch ohne Claude.
