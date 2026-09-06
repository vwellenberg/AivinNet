import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { block as blockOf, ownDeclarations, styleBlock } from "./scssBlocks";

// ---------------------------------------------------------------------------
// Every control in the top bar has ONE footprint, and it comes from
// `$bar-control` in Global/_buttons.scss.
//
// This is a test rather than a comment because the drift is invisible from any
// single file: each control looked deliberate on its own, and only measuring
// the row showed 48 / 48 / 48 / 36 / 36 px standing next to each other, with
// two shadow depths (4px on the home button, 3px on the toggle), three press
// answers (push-into-the-shadow, scale(0.94), none at all) and a glyph that was
// 20.8px in a bar of 24px ones. Three of those numbers were written as
// compensation FOR each other — the toggle was "sized to the avatar", the
// search pill was "sized to the home button", the phone pill was "sized to the
// avatar again" — so correcting one of them silently stranded the rest.
//
// The census is keyed on the shared trait (a control that sits in the top bar),
// not on the broken spelling, because the instance that slips through is always
// the half-conforming one.
// ---------------------------------------------------------------------------
const SOURCES = import.meta.glob("/src/**/*.vue", { as: "raw", eager: true }) as Record<string, string>;

// `import.meta.glob(..., { as: "raw" })` hands back an EMPTY STRING for .scss —
// Vite runs stylesheets through the CSS pipeline, which is stubbed under test.
// Read it off disk instead, relative to the runner's cwd (the project root).
const GEOMETRY_FILE = "src/assets/scss/Global/_buttons.scss";

const NAVBAR = "/src/components/nav/NavBar.vue";
const AVATAR = "/src/components/nav/AvatarWithDropdown.vue";

/**
 * The controls that stand in the top bar, with the block that sizes each one.
 * The logo is in here for its BOX only — its look (no plate, no shadow, the
 * hover orbit) is deliberately outside the role system.
 */
const CONTROLS: [file: string, selector: string, what: string][] = [
  [NAVBAR, ".nav-logo", "the logo slot"],
  [NAVBAR, ".nav-home", "the home button"],
  [NAVBAR, ".mobile-header-action", "the per-route action on phones"],
  ["/src/components/Logo.vue", ".logo-orbit-wrapper", "the logo artwork"],
  ["/src/components/nav/ThemeToggle.vue", ".theme-toggle", "the theme toggle"],
  [AVATAR, ".img", "the avatar / account menu trigger"],
  ["/src/components/RightSideBar/SearchInput.vue", "#ginner", "the search pill"],
];

/** A component's <style> content, with a guard that the file was found. */
function styles(file: string): string {
  const source = SOURCES[file];
  expect(source, `${file} is not in the component glob`).toBeTruthy();
  return styleBlock(source);
}

/** The body of `selector { … }` — the parser itself lives in ./scssBlocks. */
function block(css: string, selector: string): string {
  return blockOf(css, selector).body;
}

const LITERAL_SIZE = /(?:^|[\s;{])(?:width|height)\s*:\s*[\d.]+(?:px|rem|em)\b/;

describe("top bar anatomy", () => {
  it("reads the one geometry token every control has to use", () => {
    // The guard on this file's own inputs: a renamed or unreadable stylesheet
    // must fail loudly rather than let every control through against nothing.
    // 2.75rem is the 44px touch target — the number is asserted here so it has
    // a single owner, and so lowering it anywhere shows up as this test.
    expect(readFileSync(GEOMETRY_FILE, "utf8")).toMatch(/\$bar-control:\s*2\.75rem\s*;/);
  });

  it.each(CONTROLS)("%s › %s (%s) is one block that a test can read", (file, selector, _what) => {
    // The second guard. A source-scanning test does not fail when its parser
    // breaks — it goes quietly green.
    expect(block(styles(file), selector).length).toBeGreaterThan(40);
  });

  it.each(CONTROLS)("%s › %s (%s) takes its footprint from $bar-control", (file, selector, what) => {
    const own = ownDeclarations(block(styles(file), selector));

    expect(own, `${what} does not mention $bar-control — it sizes itself`).toMatch(/\$bar-control/);
    expect(
      LITERAL_SIZE.test(own),
      `${what} states a literal width/height. That is how the row came to hold three sizes at once; ` +
        `use $bar-control (or a role's $size) so there is one number for the whole chrome.`
    ).toBe(false);
  });

  it.each(CONTROLS)("%s › %s (%s) leaves hover and press to its role", (file, selector, what) => {
    // Not `ownDeclarations` — a restated press hides in `&:active`, which is
    // exactly one of the child blocks that helper strips.
    expect(
      block(styles(file), selector),
      `${what} declares a transform. Hover (1.06) and press (0.98) belong to the button role in ` +
        `Global/_buttons.scss; a local one is how this row ended up with three different presses.`
    ).not.toMatch(/transform\s*:/);
  });

  it("opens the account menu from a real button", () => {
    // It was a <div> with @click: unreachable by keyboard, announcing nothing,
    // and with no way to carry the expanded state.
    const template = SOURCES[AVATAR].slice(0, SOURCES[AVATAR].indexOf("</template>"));
    const trigger = /<button[^>]*class="img circular"[\s\S]*?>/.exec(template);

    expect(trigger, "the avatar trigger is not a <button>").toBeTruthy();
    expect(trigger?.[0]).toMatch(/aria-expanded/);
  });
});
