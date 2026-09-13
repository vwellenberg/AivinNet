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
// ⚠️ cwd des Runners ist `client/` — das Backend liegt eine Ebene höher.
// ---------------------------------------------------------------------------

const BACKEND = "../src/aivinnet/api/backup_and_restore.py";
const LABEL = "src/settings/general/backup.ts";

/** Der Verzeichnisname aus `get_backup_root()` — die einzige Quelle der Wahrheit. */
function backupRootName(): string {
  const py = readFileSync(BACKEND, "utf8");
  const body = py.split("def get_backup_root(")[1];
  expect(body, "get_backup_root() nicht gefunden — wurde sie umbenannt?").toBeTruthy();

  // return Path("~").expanduser() / "aivinnet.backup"
  const match = body.match(/expanduser\(\)\s*\/\s*"([^"]+)"/);
  expect(match, "Rückgabe von get_backup_root() nicht lesbar").toBeTruthy();
  return match![1];
}

describe("Backup-Verzeichnis im Label", () => {
  it("nennt genau den Ordner, den das Backend anlegt", () => {
    const ordner = backupRootName();
    const label = readFileSync(LABEL, "utf8");

    const desc = label.match(/desc:\s*'Backup directory: ([^']+)'/);
    expect(desc, "Zeile „Backup directory: …" + "\" nicht gefunden").toBeTruthy();
    expect(desc![1]).toBe(`~/${ordner}`);
  });

  it("trägt keinen Pfad des Ursprungsprojekts mehr", () => {
    // Die Namensnennung in About.vue ist Attribution und bleibt; ein PFAD mit
    // diesem Namen ist dagegen immer ein Überbleibsel.
    const label = readFileSync(LABEL, "utf8");
    expect(label).not.toMatch(/swingmusic[./]/i);
  });
});
