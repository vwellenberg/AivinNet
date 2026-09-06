import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { dirname, join, posix } from "path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Die Kontext-Dateien (CLAUDE.md, .claude/rules/*.md, docs/*.md) verweisen auf
// Dateien, Globs und Nachbardokumente. Nichts davon bricht, wenn das Ziel
// verschwindet: ein toter Markdown-Link rendert als Link, und ein `paths:`-Glob,
// der auf nichts zeigt, sorgt einfach dafür, dass die Regel NIE lädt — lautlos.
//
// Gefunden wurde genau das: `testing.md` gatete auf `vitest.config.*`, das es in
// diesem Repo nie gab (die Testkonfiguration steckt im `test:`-Block von
// `vite.config.ts`). Die Regel lud damit ausgerechnet dann nicht, wenn jemand an
// der Konfiguration schraubte — und niemandem wäre es je aufgefallen. Dazu nannte
// die Tabelle in CLAUDE.md für `device-sync.md` drei von fünf Globs.
//
// Pfade sind relativ: die cwd des Runners ist das Projekt-Root (.claude/rules/testing.md).
// ---------------------------------------------------------------------------

const RULES_DIR = ".claude/rules";
/** Was beim Inventar übersprungen wird — alles andere zählt, auch Punkt-Ordner. */
const SKIP = new Set(["node_modules", ".git", "dist", "coverage", ".yarn"]);

/** Jede Datei im Repo, POSIX-Schreibweise, relativ zum Root. */
function projectFiles(): string[] {
  const out: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (SKIP.has(entry)) continue;
      const full = dir === "." ? entry : `${dir}/${entry}`;
      if (statSync(full).isDirectory()) walk(full);
      else out.push(full.split("\\").join("/"));
    }
  };

  walk(".");
  return out;
}

/**
 * Ein Glob der Frontmatter-Sorte als Regex.
 *
 * ⚠️ `a/**\/b` matcht auch `a/b` — der Doppelstern steht für „beliebig viele
 * Segmente, auch keins". Die Schrägstriche mit zu ersetzen ist deshalb kein
 * Detail: Eine erste Fassung ließ sie stehen, und damit hätte `src/**\/*.vue`
 * ausgerechnet `src/App.vue` nicht getroffen — der Test hätte einen völlig
 * gesunden Glob als tot gemeldet.
 */
function globToRegExp(glob: string): RegExp {
  let out = "";

  for (let i = 0; i < glob.length; i++) {
    const rest = glob.slice(i);

    if (rest.startsWith("/**/")) {
      out += "/(?:.*/)?";
      i += 3;
    } else if (rest.startsWith("**/") && i === 0) {
      out += "(?:.*/)?";
      i += 2;
    } else if (rest.startsWith("/**")) {
      out += "(?:/.*)?";
      i += 2;
    } else if (rest.startsWith("**")) {
      out += ".*";
      i += 1;
    } else if (glob[i] === "*") {
      out += "[^/]*";
    } else if (glob[i] === "?") {
      out += "[^/]";
    } else if (glob[i] === "{") {
      const close = glob.indexOf("}", i);
      if (close === -1) {
        out += "\\{";
      } else {
        out += `(?:${glob
          .slice(i + 1, close)
          .split(",")
          .map(part => part.replace(/[.+^${}()|[\]\\]/g, "\\$&"))
          .join("|")})`;
        i = close;
      }
    } else {
      out += glob[i].replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }

  return new RegExp(`^${out}$`);
}

function ruleFiles(): string[] {
  return readdirSync(RULES_DIR)
    .filter(name => name.endsWith(".md"))
    .map(name => posix.join(RULES_DIR, name));
}

/** Die `paths:`-Einträge einer Rule (Kommentare — ganze Zeilen wie angehängte — raus). */
function pathsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (!front) return [];

  const globs: string[] = [];
  let inPaths = false;

  for (const raw of front[1].split(/\r?\n/)) {
    // Ein angehängter Kommentar hat die erste Fassung dieses Parsers auf den
    // `break` unten laufen lassen — ab da fielen ALLE weiteren Globs still weg,
    // also genau die Sorte Fehler, vor der der Kopf dieser Datei warnt.
    const line = raw.replace(/\s+#.*$/, "").trimEnd();

    if (/^paths:/.test(line)) {
      inPaths = true;
      continue;
    }
    if (!inPaths) continue;
    if (!line.trim() || /^\s*#/.test(line)) continue;

    const item = /^\s*-\s*(?:"([^"]*)"|'([^']*)'|(\S+))\s*$/.exec(line);
    if (item) globs.push(item[1] ?? item[2] ?? item[3]);
    else break; // ein neuer Frontmatter-Schlüssel beendet die Liste
  }

  return globs;
}

/** Die Globs, die die Rules-Tabelle in CLAUDE.md je Rule behauptet. */
function tableGlobs(): Map<string, string[]> {
  const rows = new Map<string, string[]>();
  const claude = readFileSync("CLAUDE.md", "utf8");

  for (const match of claude.matchAll(/^\|\s*`([a-z-]+\.md)`\s*\|([^|]*)\|/gm)) {
    rows.set(
      posix.join(RULES_DIR, match[1]),
      [...match[2].matchAll(/`([^`]+)`/g)].map(cell => cell[1])
    );
  }

  return rows;
}

describe("context documents", () => {
  const FILES = projectFiles();

  it("finds its own inputs", () => {
    // Wächter über die eigene Eingabe: ein Test, der Quelltext einliest, wird
    // beim Brechen seines Parsers still grün (siehe .claude/rules/testing.md).
    expect(ruleFiles().length, "no rules found in .claude/rules").toBeGreaterThan(0);
    expect(FILES.length, "no project files walked").toBeGreaterThan(100);
    expect(FILES, "the walker misses files at the root of src/").toContain("src/App.vue");
    expect(FILES, "the walker skips dot directories").toContain("src/components/__tests__/contextDocs.test.ts");
    expect(globToRegExp("src/**/*.vue").test("src/App.vue"), "** must match zero segments too").toBe(true);
  });

  it("every rule is scoped — an unscoped rule is CLAUDE.md under another name", () => {
    for (const file of ruleFiles()) {
      expect(pathsOf(file).length, `${file} has no paths: frontmatter`).toBeGreaterThan(0);
    }
  });

  it("every paths: glob matches something that exists", () => {
    const dead: string[] = [];

    for (const file of ruleFiles()) {
      for (const glob of pathsOf(file)) {
        const re = globToRegExp(glob);
        if (!FILES.some(candidate => re.test(candidate))) dead.push(`${file}: ${glob}`);
      }
    }

    expect(dead, "a glob that matches nothing means the rule never loads").toEqual([]);
  });

  it("the rules table in CLAUDE.md quotes the frontmatter verbatim", () => {
    const table = tableGlobs();

    expect(table.size, "no rules table found in CLAUDE.md").toBe(ruleFiles().length);

    for (const file of ruleFiles()) {
      expect(table.get(file), `${file} missing from the rules table`).toEqual(pathsOf(file));
    }
  });

  it("every markdown link in the context documents resolves", () => {
    const docs = [
      "CLAUDE.md",
      ...ruleFiles(),
      ...readdirSync("docs")
        .filter(name => name.endsWith(".md"))
        .map(name => posix.join("docs", name)),
    ];

    const broken: string[] = [];

    for (const doc of docs) {
      const source = readFileSync(doc, "utf8");
      for (const match of source.matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = match[1].split("#")[0];
        if (!target || /^(https?:|mailto:)/.test(target)) continue;
        if (!existsSync(join(dirname(doc), target))) broken.push(`${doc} -> ${match[1]}`);
      }
    }

    expect(broken, "a dead link in a context document").toEqual([]);
  });
});
