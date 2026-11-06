import { readFileSync, readdirSync, statSync } from "node:fs";

import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// A SELECTED FILL TAKES THE INK FALLBACK — in both modes.
//
// `--look-selected-text` is the text colour on a selected fill
// (`--look-selected-fill`). Looks that do not set it fall back to the value
// written after the comma. That fallback must be `$mem-ink`: the ink is the
// same in light and dark mode, and it is what the yellow, teal and blush
// selected fills show everywhere else.
//
// Real case (Advent calendar, December rehearsal): today's door used
// `#{$mem-content-text}` as its fallback. That token is paper in Memphis dark,
// so a white number sat on the yellow fill and was nearly unreadable; in light
// mode it was dark and nobody saw it. The fill came from the look and stayed
// yellow, the text came from the page ground — two tokens that answer to
// different things.
//
// So this census reads every `var(--look-selected-text, …)` in the app
// (.vue and .scss) and holds each fallback to `$mem-ink`. A new selected-fill
// element copying the wrong token goes red here, not in a screenshot.
//
// ⚠️ A source scan goes quietly green when its parser breaks
// (.claude/rules/testing.md), so it also has to find the uses that exist today.
// ---------------------------------------------------------------------------

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = `${dir}/${entry}`;
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
    else if (entry.endsWith(".vue") || entry.endsWith(".scss")) files.push(path);
  }
  return files;
}

const USE = /var\(\s*--look-selected-text\s*,\s*([^)]*)\)/g;

function fallbacks(path: string): { path: string; fallback: string }[] {
  const source = readFileSync(path, "utf8");
  return [...source.matchAll(USE)].map(match => ({ path, fallback: match[1].trim() }));
}

describe("selected text: the fallback is the ink", () => {
  const uses = sourceFiles("src").flatMap(fallbacks);

  it("finds the existing selected-fill uses (the scan is not blind)", () => {
    expect(uses.length).toBeGreaterThanOrEqual(5);
  });

  it("every var(--look-selected-text, …) falls back to $mem-ink", () => {
    const wrong = uses.filter(use => use.fallback !== "#{$mem-ink}" && use.fallback !== "$mem-ink");
    expect(wrong.map(use => `${use.path}: var(--look-selected-text, ${use.fallback})`)).toEqual([]);
  });
});
