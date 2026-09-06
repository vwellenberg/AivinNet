import { existsSync, readFileSync } from "node:fs";

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import TabsWrapper from "@/components/RightSideBar/Search/TabsWrapper.vue";

import { block, blocks, ownDeclarations, styleBlock } from "./scssBlocks";

// ---------------------------------------------------------------------------
// The search filter chips: footprint, the box they are painted in, and the
// semantics of "which one is selected".
//
// All three failed at once, and each failure looked deliberate on its own:
//
//   - the chips stated `$h: 2rem`, so the search page's ONLY category
//     navigation was a 32px touch target — on the phone the one control you
//     cannot route around;
//   - the row they live in was pinned to `grid-template-rows: 2rem`, exactly
//     that chip height, inside a `position: absolute; overflow: hidden` box
//     borrowed from the sidebar's tab CONTENT. The offset shadow was declared,
//     was in the computed style, and was never painted below the chip;
//   - the selected chip was carried by colour alone: six `<button>`s with no
//     role and no `aria-selected`, indistinguishable to a screen reader.
//
// ⚠️ This test parses source, so it goes quietly GREEN when its parser breaks
// (see `.claude/rules/testing.md`). Every check therefore guards its own
// input first.
// ---------------------------------------------------------------------------
const ROLES_FILE = "src/assets/scss/Global/_buttons.scss";
const CHIPS_FILE = "src/assets/scss/Global/search-tabheaders.scss";
const VIEW_FILE = "src/views/SearchView/main.vue";
const RECENTS_FILE = "src/views/SearchView/RecentSearches.vue";
const WRAPPER_FILE = "src/components/RightSideBar/Search/TabsWrapper.vue";

const read = (file: string) => readFileSync(file, "utf8");

/** `@include btn-pill(…)` with its argument list, or "" if the call is absent. */
function pillCall(css: string): string {
  return /@include btn-pill\s*(\([^)]*\))?/.exec(css)?.[0] ?? "";
}

/**
 * The body of `@mixin <name>(…) { … }`.
 *
 * `block()` cannot be used here: it anchors on `selector {`, and a mixin
 * carries an argument list in between. It would return "" — silently, which is
 * exactly the quiet-green failure this file has to avoid.
 */
function mixinBody(css: string, name: string): string {
  const start = css.indexOf(`@mixin ${name}(`);
  if (start === -1) return "";

  const open = css.indexOf("{", start);
  let depth = 1;
  let i = open + 1;
  while (i < css.length && depth > 0) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") depth--;
    i++;
  }
  return css.slice(open + 1, i - 1);
}

const TABS = ["top", "tracks", "albums", "artists", "playlists", "folders"];

describe("search filter chips", () => {
  describe("the chip row lives in the page, not the chrome", () => {
    // The desktop layout used to render a SECOND copy of this switcher in the
    // top bar (nav/Titles/SearchTitle.vue): four hardcoded tabs, so the
    // playlists and folders tabs simply did not exist on wide screens, and
    // the chips sat in the chrome even in the empty state, where there is
    // nothing to filter.
    it("renders no search tabs in the top bar", () => {
      // The per-route title block the switcher used to live in is gone too: it
      // only ever rendered in the layout the "Use no sidebar layout" setting
      // turned off, and that setting no longer exists.
      const nav = read("src/components/nav/NavBar.vue");
      expect(nav, "NavBar.vue could not be read").toContain("<template>");
      expect(nav, "the top bar imports the search-tab switcher again").not.toContain(
        "SearchTitle"
      );
      for (const gone of [
        "src/components/nav/Titles/SearchTitle.vue",
        "src/components/nav/NavTitles.vue",
      ]) {
        expect(existsSync(gone), `${gone}: the top-bar title block is back`).toBe(false);
      }
    });

    it("gates the in-page chip row on a non-empty query", () => {
      const view = read(VIEW_FILE);
      const buttonsArea = /<div v-if="([^"]*)" class="buttons-area">/.exec(view);
      expect(buttonsArea, "no gated .buttons-area in the search view").not.toBeNull();
      expect(
        buttonsArea![1],
        `the chip row must hang on the query, not on the layout — with no query the ` +
          `page shows recent searches and the chips have nothing to filter.`
      ).toBe("has_query");
    });

    it("offers every tab, including playlists and folders", () => {
      const view = read(VIEW_FILE);
      expect(view, "the search view could not be read").toContain("buttons-area");
      for (const tab of TABS) {
        expect(view, `tab "${tab}" is missing from the search view`).toContain(`"${tab}"`);
      }
    });
  });

  describe("footprint comes from the role", () => {
    // Both rows of chips are on screen together in the empty state, so a
    // height stated at one of them is a difference you can see side by side.
    it.each([
      [CHIPS_FILE, ".tab", "the filter chips"],
      [RECENTS_FILE, ".recent-chip", "the recent-search chips"],
    ])("%s › %s (%s) takes btn-pill without shrinking it", (file, selector, what) => {
      const source = read(file);
      const css = file.endsWith(".vue") ? styleBlock(source) : source;

      const found = blocks(css, selector);
      expect(found.length, `${what}: no ${selector} block to read`).toBeGreaterThan(0);

      const call = pillCall(ownDeclarations(found[0]));
      expect(call, `${what} does not take the pill role at all`).toContain("btn-pill");
      expect(
        call,
        `${what} passes $h to btn-pill. The role is 2.75rem = the 44px touch target; ` +
          `a call site that shrinks it is how the app's only search navigation ended up at 32px.`
      ).not.toMatch(/\$h\s*:/);
    });

    it("keeps the pill role itself at the 44px target", () => {
      const css = read(ROLES_FILE);
      expect(css, "the role file no longer declares btn-pill").toMatch(/@mixin btn-pill\(/);
      expect(css).toMatch(/@mixin btn-pill\(\$h:\s*2\.75rem/);
    });
  });

  describe("the raised surface", () => {
    // #355: 2px hit three elements against 1186 at 3px/4px, two of them this
    // role. A pill is not a different kind of raised thing.
    it("gives the pill role the app's shadow offset", () => {
      const body = mixinBody(read(ROLES_FILE), "btn-pill");
      expect(body, "the btn-pill body could not be read").toContain("border-radius");
      expect(body, "btn-pill still writes the 2px outlier offset").not.toMatch(
        /candy-raised\(\s*2px/
      );
      expect(body).toMatch(/candy-raised\(\s*3px,\s*3px/);
    });

    it("reserves room for that shadow in the scrolling row", () => {
      const css = styleBlock(read(VIEW_FILE));

      const row = block(css, ".tabheaders").body;
      // The row's scroll box is `mem-seg-scroll` now, shared with the charts
      // header and the discography tabs — it was the third hand-rolled copy of
      // that anatomy. What this census is about did not change: the box clips
      // ink overflow, so it has to book room for the chips' offset shadow. The
      // chips ALSO grow 1.04 under the pointer, which is why this caller is
      // the one that passes a reserve instead of taking the 4px default.
      expect(row, "no .tabheaders block in the search view").toContain("@include mem-seg-scroll");
      expect(
        /mem-seg-scroll\(\s*\$reserve:\s*\$small\s*\)/.test(ownDeclarations(row)),
        `.tabheaders clips ink overflow and has to reserve the offset shadow on the ` +
          `bottom and right, or the hard shadow is cut off flush — $small, because ` +
          `the chips overhang by their hover scale on top of the 4px offset.`
      ).toBe(true);

      const withQuery = block(css, "&.has_query").body;
      expect(withQuery, "no .has_query block in the search view").toContain("grid-template-rows");
      expect(
        withQuery,
        `the chip row is pinned to a literal height again. It has to follow its content — ` +
          `a fixed row equal to the chip height is what cropped the shadow.`
      ).toMatch(/grid-template-rows:\s*max-content/);
    });

    it("keeps the absolute clip box on the tab-CONTENT case only", () => {
      const css = styleBlock(read(WRAPPER_FILE));

      const base = ownDeclarations(block(css, "#right-tabs").body);
      expect(base, "no #right-tabs block to read").toContain("display");
      expect(
        base,
        `#right-tabs is absolutely positioned for every caller again. The search view ` +
          `renders the chip row with no tab content, and there the box is a crop frame.`
      ).not.toMatch(/position\s*:\s*absolute/);
      expect(base).not.toMatch(/overflow\s*:\s*hidden/);

      const withContent = block(css, "#right-tabs.tabContent").body;
      expect(withContent, "the sidebar case lost its filling box").toMatch(
        /position\s*:\s*absolute/
      );
      expect(withContent).toMatch(/overflow\s*:\s*hidden/);
      expect(withContent).toMatch(/height\s*:\s*100%/);
    });
  });

  describe("selection is announced, not just coloured", () => {
    const mountTabs = (currentTab = "top") =>
      mount(TabsWrapper, {
        props: { tabs: TABS, currentTab },
        global: { directives: { "auto-animate": {} } },
      });

    it("marks up the row as a tablist", () => {
      const w = mountTabs();
      expect(w.find(".tabheaders").attributes("role")).toBe("tablist");
      expect(w.find(".tabheaders").attributes("aria-label")).toBeTruthy();

      const chips = w.findAll(".tab");
      expect(chips.length).toBe(TABS.length);
      for (const chip of chips) expect(chip.attributes("role")).toBe("tab");
    });

    it("says which chip is selected", () => {
      const chips = mountTabs("albums").findAll(".tab");
      const selected = chips.map(c => c.attributes("aria-selected"));
      expect(selected).toEqual(["false", "false", "true", "false", "false", "false"]);
    });

    it("puts only the selected chip in the tab order (roving tabindex)", () => {
      const chips = mountTabs("albums").findAll(".tab");
      expect(chips.map(c => c.attributes("tabindex"))).toEqual(["-1", "-1", "0", "-1", "-1", "-1"]);
    });

    it.each([
      ["ArrowRight", "top", "tracks"],
      ["ArrowLeft", "top", "folders"],
      ["ArrowRight", "folders", "top"],
      ["Home", "playlists", "top"],
      ["End", "top", "folders"],
    ])("%s on %s selects %s", async (key, from, expected) => {
      const w = mountTabs(from);
      await w.findAll(".tab")[TABS.indexOf(from)].trigger("keydown", { key });
      expect(w.emitted("switchTab")?.[0]).toEqual([expected]);
    });

    it("leaves other keys to the browser", async () => {
      const w = mountTabs();
      await w.findAll(".tab")[0].trigger("keydown", { key: "a" });
      expect(w.emitted("switchTab")).toBeUndefined();
    });
  });
});
