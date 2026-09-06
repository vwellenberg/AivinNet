import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// NOTHING INTERACTIVE GOES IN A SLOT THAT IS NEVER PAINTED.
//
// `GenericHeader` hides `.desc` on every viewport — the rule sits just outside
// the phone block, and the descriptions have not been shown for months. Fine
// for prose. Not fine for anything a user is supposed to reach, and twice now
// something was:
//
//   - the playlists page put its "Search playlists" field there, so the input
//     was in the DOM at zero size and the filter behind it could never receive
//     a keystroke (#538)
//   - ArtistDiscography puts its back-link to the artist there, so that page
//     announces "Albums" without saying whose (#541)
//
// Neither looked wrong in its own file. Both are invisible to every test that
// renders a component in isolation, because jsdom applies no stylesheet — the
// field mounts, the ref updates, the filter computes, and nothing is on screen.
//
// ⚠️ This census exists because the FIRST fix did not hold: #538 removed the
// field, and #539 — a branch cut before it and squash-merged after — brought
// the whole file back. A test is what survives that; a comment did not.
// ---------------------------------------------------------------------------

/** Every `.vue` under the given roots, relative to `src/`. */
function vueFiles(root: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join("src", root, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...vueFiles(root, rel));
    else if (entry.name.endsWith(".vue")) out.push(`${root}/${rel}`);
  }
  return out;
}

/**
 * Slots that render into a box the app never paints, and where that is
 * established rather than accidental.
 */
const UNPAINTED_SLOTS = ["description"];

/** Anything a user can click, type into, or tab to. */
const INTERACTIVE = /<(input|textarea|select|button|form|RouterLink|router-link|a)\b/i;

/**
 * The body of `<template #name>` … `</template>`, one entry per occurrence.
 *
 * Vue allows `#name`, `v-slot:name` and `#name="props"`; all three are matched
 * so a rename of the syntax does not quietly empty this census.
 */
function slotBodies(source: string, slot: string): string[] {
  const opener = new RegExp(`<template\\s+(?:#${slot}|v-slot:${slot})(?:="[^"]*")?\\s*>`, "g");
  const out: string[] = [];

  for (const match of source.matchAll(opener)) {
    // Walk to the matching </template>, counting nested ones.
    let depth = 1;
    let i = match.index! + match[0].length;
    const start = i;
    while (i < source.length && depth > 0) {
      const next = source.slice(i).search(/<\/?template\b/);
      if (next === -1) break;
      i += next;
      if (source.slice(i).startsWith("</template")) depth--;
      else depth++;
      i += 9;
    }
    out.push(source.slice(start, i - 9));
  }
  return out;
}

const HOSTS = [...vueFiles("views"), ...vueFiles("components")].map(path => ({
  path,
  source: readFileSync(join("src", path), "utf-8"),
}));

describe("an unpainted slot holds no controls", () => {
  // A source scan that stops matching goes quietly green, so the parser is
  // asserted against a slot that definitely exists.
  it("finds the description slots", () => {
    const withSlot = HOSTS.filter(host => slotBodies(host.source, "description").length > 0);
    expect(withSlot.length, "no #description slot found at all — the parser broke").toBeGreaterThan(2);
  });

  it.each(HOSTS)("$path", ({ path, source }) => {
    for (const slot of UNPAINTED_SLOTS) {
      for (const body of slotBodies(source, slot)) {
        const found = INTERACTIVE.exec(body);
        expect(
          found?.[0] ?? null,
          `${path} puts \`${found?.[0]}\` in the #${slot} slot, which GenericHeader never paints — ` +
            "it will sit in the DOM at zero size and nobody will be able to reach it. " +
            "Move it to a slot that is rendered (#after, #right), or drop it."
        ).toBeNull();
      }
    }
  });
});
