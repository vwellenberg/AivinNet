import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// EVERY PAGE STARTS AT THE SAME HEIGHT ON A PHONE.
//
// Home, Playlists and Favorites put their first sticker 24px, 32px and 48px
// below the content panel. The phone header of GenericHeader is empty (title in
// the top bar, description never painted), but its `.after` box kept a 2rem
// margin, and Favorites added 1rem on top. Home has no GenericHeader, so it was
// the only page that started where it should.
//
// jsdom applies no stylesheet, so a rendered test cannot see any of this. The
// census reads the source instead: one token, and the places that must use it.
// ---------------------------------------------------------------------------

const read = (rel: string) => readFileSync(join("src", rel), "utf-8");

/** The body of the first `@include <mixin> { … }` in `source`, braces balanced. */
function includeBlock(source: string, mixin: string): string {
  const start = source.indexOf(`@include ${mixin} {`);
  expect(start, `no @include ${mixin} block`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unbalanced @include ${mixin}`);
}

/** The body of the rule for `selector` inside `block` (first match). */
function ruleBody(block: string, selector: string): string {
  const match = block.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^{}]*)\\}`));
  expect(match, `no rule for ${selector}`).not.toBeNull();
  return match![1];
}

describe("phone page start", () => {
  it("is one token", () => {
    expect(read("assets/scss/_variables.scss")).toMatch(/^\$phone-page-start:/m);
  });

  it("is where Home's Browse block starts", () => {
    const style = read("components/HomeView/Browse.vue");
    expect(style).toMatch(/\.homebrowse\s*\{[^}]*padding:\s*\$phone-page-start\b/);
  });

  it("is the only height the phone GenericHeader adds above the page", () => {
    const phone = includeBlock(read("components/shared/GenericHeader.vue"), "allPhones");
    expect(phone).toMatch(/^\s*padding-top:\s*\$phone-page-start;/m);
    expect(phone).toMatch(/^\s*padding-bottom:\s*0;/m);
    expect(ruleBody(phone, ".after")).toMatch(/margin-top:\s*0;/);
  });

  it("is not topped up by Favorites' first row", () => {
    const style = read("views/Favorites.vue");
    const recent = style.slice(style.indexOf(".recent-favs {"));
    expect(includeBlock(recent, "allPhones")).toMatch(/padding-top:\s*0;/);
  });

  it("is not topped up by the album list's sort chips", () => {
    const style = read("components/CardListView/SortBanner.vue");
    // The override has to come AFTER the padding shorthand, or the shorthand wins.
    const afterShorthand = style.slice(style.indexOf("padding: 1rem $medium 2rem 0;"));
    expect(includeBlock(afterShorthand, "allPhones")).toMatch(/padding-top:\s*0;/);
  });

  it("is not topped up by a <br> or the grid margin on the charts", () => {
    const source = read("components/Stats/Charts.vue");
    expect(source).not.toMatch(/<\/GenericHeader>\s*<br\s*\/?>/);
    const grid = source.slice(source.indexOf(".chartitemgroupsgrid {"));
    expect(includeBlock(grid, "allPhones")).toMatch(/margin-top:\s*0;/);
  });
});
