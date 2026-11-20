import { readFileSync, readdirSync, statSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { pinLabel } from "@/utils/pinLabel";

// ---------------------------------------------------------------------------
// Every "pin" entry says the same thing (user, 2026-11-20): the album, folder
// and playlist-folder menus and the header's pin button said "Pin to library" /
// "Unpin from library", the playlist menu alone said "Pin" / "Unpin". One
// wording, one source: `utils/pinLabel.ts`.
//
// Collected from the source, not from a list of known menus — the playlist-
// folder menu lives in `LeftSidebar/index.vue`, not in `src/context_menus/`,
// and a list would have missed the next one the same way. Guarded against
// finding nothing (.claude/rules/testing.md).
// ---------------------------------------------------------------------------

const ROOT = "src";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = `${dir}/${entry}`;
    if (statSync(path).isDirectory()) return walk(path);
    return /\.(ts|vue)$/.test(path) && !path.includes("__tests__") ? [path] : [];
  });
}

/**
 * Comments quote labels ("offer \"Pin\" for a pinned folder") and are not
 * what a user reads, so they go before any check.
 */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const FILES = walk(ROOT).map((file) => ({ file, src: code(readFileSync(file, "utf-8")) }));

/**
 * A pin entry in a menu carries the pin glyph. Import and re-export lines go
 * first: `icons.ts` only hands the glyph on, and a bare import is no entry.
 */
const PIN_HOSTS = FILES.filter(({ src }) =>
  /\bPushPinIcon\b/.test(src.replace(/^(?:import|export) .*$/gm, "")),
);

describe("pinLabel", () => {
  it("names the library in both directions", () => {
    expect(pinLabel(false)).toBe("Pin to library");
    expect(pinLabel(true)).toBe("Unpin from library");
  });
});

describe("every pin entry takes its words from pinLabel", () => {
  it("finds the menus it is meant to check", () => {
    const names = PIN_HOSTS.map(({ file }) => file);
    expect(names).toEqual(
      expect.arrayContaining([
        "src/context_menus/album.ts",
        "src/context_menus/folder.ts",
        "src/context_menus/playlist.ts",
        "src/components/LeftSidebar/index.vue",
      ]),
    );
  });

  it.each(PIN_HOSTS.map(({ file }) => [file]))("%s calls pinLabel(", (file) => {
    const { src } = FILES.find((f) => f.file === file)!;
    expect(src).toMatch(/\bpinLabel\s*\(/);
  });

  it("the pin button's tooltip calls pinLabel(", () => {
    const src = readFileSync("src/components/shared/PinButton.vue", "utf-8");
    expect(src).toMatch(/\bpinLabel\s*\(/);
  });

  it("no file spells a pin label out by hand", () => {
    const literal = /(['"`])(?:Pin|Unpin|Pin to library|Unpin from library)\1/;
    const offenders = FILES.filter(
      ({ file, src }) => file !== "src/utils/pinLabel.ts" && literal.test(src),
    ).map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
