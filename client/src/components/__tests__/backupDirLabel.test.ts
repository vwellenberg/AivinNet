import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Die Einstellung „Backup now" nennt dem Nutzer das Verzeichnis, in das
// gesichert wird. Diese Angabe stand jahrelang auf `~/swingmusic.backups` —
// dem Pfad des Projekts, von dem AivinNet abstammt. Das Backend schreibt seit
// der Umbenennung nach `~/aivinnet.backup`.
//
// Das ist der unangenehmste Typ Fehler, den ein Zensus fangen kann: nichts
// stürzt ab, nichts wird rot, die Sicherung läuft sauber durch — nur sucht der
// Nutzer die Dateien an einer Stelle, an der nie welche lagen. Aufgefallen ist
// es beim Funktions-Audit fürs README, nicht im Betrieb.
//
// Deshalb wird hier nicht der neue String festgenagelt (das wäre dieselbe
// Abschrift, nur aktueller), sondern die BEZIEHUNG: Das Label muss den Ordner
// nennen, den `get_backup_root()` im Backend tatsächlich anlegt. Zieht der
// Ordner erneut um, wird dieser Test rot, statt dass das Label still veraltet.
//
// Im Container liegt der Ordner seit #296 im Volume `/config` (unter `~` =
// /root ging er beim Neuerstellen des Containers verloren) — das Label nennt
// darum beide Orte.
//
// ⚠️ cwd des Runners ist `client/` — das Backend liegt eine Ebene höher.
// ---------------------------------------------------------------------------

const BACKEND = "../src/aivinnet/lib/backups.py";
const LABEL = "src/settings/general/backup.ts";

/** Der Verzeichnisname aus `lib/backups.py` — die einzige Quelle der Wahrheit. */
function backupRootName(): string {
  const py = readFileSync(BACKEND, "utf8");
  expect(py, "get_backup_root() nicht gefunden — wurde sie umbenannt?").toContain("def get_backup_root(");

  // FOLDER = "aivinnet.backup"
  const match = py.match(/^FOLDER\s*=\s*"([^"]+)"/m);
  expect(match, "FOLDER in lib/backups.py nicht lesbar").toBeTruthy();
  return match![1];
}

describe("Backup-Verzeichnis im Label", () => {
  it("nennt genau den Ordner, den das Backend anlegt", () => {
    const ordner = backupRootName();
    const label = readFileSync(LABEL, "utf8");

    const desc = label.match(/desc:\s*'Backup directory: ([^']+)'/);
    expect(desc, "Zeile „Backup directory: …" + "\" nicht gefunden").toBeTruthy();
    expect(desc![1]).toBe(`~/${ordner} (Docker: /config/${ordner})`);
  });

  it("trägt keinen Pfad des Ursprungsprojekts mehr", () => {
    // Die Namensnennung in About.vue ist Attribution und bleibt; ein PFAD mit
    // diesem Namen ist dagegen immer ein Überbleibsel.
    const label = readFileSync(LABEL, "utf8");
    expect(label).not.toMatch(/swingmusic[./]/i);
  });
});
