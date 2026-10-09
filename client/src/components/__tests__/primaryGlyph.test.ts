import { describe, expect, it } from "vitest";

import { blocks, styleBlock } from "./scssBlocks";

// ---------------------------------------------------------------------------
// A primary button's glyph has the role's size — never a call site's.
//
// `btn-primary` sizes its glyph through `$glyph` (Global/_buttons.scss). The
// Continue button on Home shrank its ▶ to 1.1rem with a local `svg { … }`
// rule, so it was the one play control that read small next to the player
// bar's play button and the header "Play" ("play icon too small?", user
// 2026-10-09). The same patch is what `btn-action`'s `$glyph` argument was
// introduced to collect (styling.md).
//
// The census: every class that sits next to `btn-primary` in a template, and
// every block of that class in the same component — none of them may size an
// `svg`. A caller that really needs another size passes `$glyph` to the mixin.
// ---------------------------------------------------------------------------

const SOURCES = import.meta.glob("/src/**/*.vue", { as: "raw", eager: true }) as Record<string, string>;

function primaryHosts(): { path: string; cls: string; style: string }[] {
  const out: { path: string; cls: string; style: string }[] = [];
  for (const [path, src] of Object.entries(SOURCES)) {
    const at = src.indexOf("<style");
    const template = at === -1 ? src : src.slice(0, at);
    for (const m of template.matchAll(/class="([^"]*\bbtn-primary\b[^"]*)"/g)) {
      for (const cls of m[1].split(/\s+/)) {
        if (cls && cls !== "btn-primary") out.push({ path, cls, style: styleBlock(src) });
      }
    }
  }
  return out;
}

describe("primary button glyphs", () => {
  const hosts = primaryHosts();

  it("found the sources and the Continue button among the hosts", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(100);
    expect(hosts.map(h => `${h.path} .${h.cls}`)).toContain("/src/components/HomeView/ContinueCard.vue .resume");
  });

  it("no call site sizes the glyph of a btn-primary", () => {
    const offenders = hosts
      .filter(h => blocks(h.style, `.${h.cls}`).some(body => /(^|[\s{;])svg\s*\{[^}]*\b(width|height)\s*:/.test(body)))
      .map(h => `${h.path} .${h.cls}`);
    expect(offenders, "size the glyph with the role's $glyph, not with an svg rule").toEqual([]);
  });
});
