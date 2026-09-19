import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// TWO THINGS A USER READS, AND BOTH WERE LEFTOVERS.
//
//   1. About offered "Frontend (GitHub)" — a link to the client repo, which was
//      archived when the client moved into this one (2026-09-06). It pointed at
//      a read-only copy of code that no longer changes.
//   2. The password fields' placeholder was eight U+23FA "black circle for
//      record" characters, meant to look like password dots. Nothing renders
//      them that way: the UI font has no glyph, so they fall back to the emoji
//      font and arrive as blue squares — and an emoji ignores `color`, so no
//      styling could have fixed it either.
//
// Both are the kind of thing that only shows up on screen, so both get a
// census: a link to the archived repo anywhere, and a placeholder that is not
// words.
// ---------------------------------------------------------------------------

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "__tests__") out.push(...sources(path));
    } else if (/\.(vue|ts)$/.test(name)) out.push(path);
  }
  return out;
}

const FILES = sources("src");

/** Every placeholder literal in the templates, as `file:line: value`. */
function placeholders(): { where: string; value: string }[] {
  const out: { where: string; value: string }[] = [];
  for (const file of FILES) {
    readFileSync(file, "utf-8")
      .split("\n")
      .forEach((line, i) => {
        for (const [, value] of line.matchAll(/(?:^|\s):?placeholder="([^"]*)"/g)) {
          // `:placeholder="expr"` — take the quoted strings out of the expression.
          const literals = value.includes("'") ? [...value.matchAll(/'([^']*)'/g)].map((m) => m[1]) : [value];
          for (const literal of literals) out.push({ where: `${file}:${i + 1}`, value: literal });
        }
      });
  }
  return out;
}

describe("About links", () => {
  it("offers one source link, not one per repo", () => {
    const about = readFileSync("src/components/SettingsView/About.vue", "utf-8");
    expect(about).toContain("https://github.com/vwellenberg/AivinNet");
    expect(about).not.toMatch(/Frontend \(GitHub\)/);
  });

  it("links nowhere to the archived client repo", () => {
    const offenders = FILES.filter((f) => readFileSync(f, "utf-8").includes("AivinNet-Client"));
    expect(offenders).toEqual([]);
  });
});

describe("input placeholders", () => {
  it("are words, never a row of symbols standing in for the masked text", () => {
    // Anything outside letters, digits, spaces and plain punctuation: a glyph
    // the UI font may not have, and the emoji fallback is not stylable.
    const offenders = placeholders()
      .filter(({ value }) => value && /[^\p{L}\p{N}\s.,:;!?'"()/@+-]/u.test(value))
      .map(({ where, value }) => `${where}: ${value}`);
    expect(offenders).toEqual([]);
  });

  it("tell the password fields apart", () => {
    const profile = readFileSync("src/components/modals/settings/Profile.vue", "utf-8");
    expect(profile).toMatch(/adding_user \? 'Password' : 'New password'/);
    expect(profile).toContain('placeholder="Repeat the password"');
  });
});

describe("Home", () => {
  it("names itself in the page head, like every other page", () => {
    const home = readFileSync("src/views/HomeView/main.vue", "utf-8");
    expect(home).toMatch(/<GenericHeader>\s*<template #name>Home<\/template>\s*<\/GenericHeader>/);
  });
});
