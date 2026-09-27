import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { block, blocks, ownDeclarations, styleBlock } from "./scssBlocks";

// ---------------------------------------------------------------------------
// Every LIST row a thumb taps on a phone follows Google's list/menu anatomy.
//
// The numbers are Material 3's, read from the tokens Google's own web
// components ship (`@material/web` 2.5: `list-item` and `menu-item` alike):
// 56px one-line row, 24px leading icon, 16px leading space, 16px from icon to
// label, 16px body-large label. The user compared the settings list against
// Google Play's account menu (measured off the screenshot: 57dp rows, 24dp
// icons) and asked for the same everywhere.
//
// Measured before this: settings list 52px, context menu 32.8px, its
// submenus 30px, profile menu 36px — the last three under even the 44px the
// app gives its chrome.
//
// A host joins this list when it renders a vertical list of tappable one-line
// entries. Rows that are already taller (track rows 72px = Google's two-line
// height, folder rows 64px, the settings panes' described rows) and rows that
// are containers rather than buttons (the device list) are not hosts.
// ---------------------------------------------------------------------------

const read = (path: string) => readFileSync(path, "utf-8");

const BUTTONS = read("src/assets/scss/Global/_buttons.scss");

describe("the phone list tier", () => {
  it("carries Google's numbers, once", () => {
    expect(BUTTONS).toMatch(/\$phone-list-row:\s*3\.5rem\s*;/);
    expect(BUTTONS).toMatch(/\$phone-list-glyph:\s*1\.5rem\s*;/);
    expect(BUTTONS).toMatch(/\$phone-list-gap:\s*1rem\s*;/);
    expect(BUTTONS).toMatch(/\$phone-list-inset:\s*1rem\s*;/);
    expect(BUTTONS).toMatch(/\$phone-list-font:\s*1rem\s*;/);
  });
});

// Each host: the file, and how to find its phone row rule.
const HOSTS: { name: string; file: string; fontFile?: string; row: (css: string) => string }[] = [
  {
    name: "settings list",
    file: "src/components/modals/Settings.vue",
    row: (css: string) =>
      blocks(block(block(css, ".settingsmodal.isSmallPhone").body, ".settingssidebar").body, ".gitem").find(
        (b) => b.includes("min-height"),
      ) ?? "",
  },
  {
    name: "context menu (and its submenus)",
    file: "src/components/Contextmenu/ContextItem.vue",
    // The rows inherit their type from the menu around them.
    fontFile: "src/components/ContextMenu.vue",
    row: (css: string) => block(block(css, "@include largePhones").body, ".context-item:not(.separator)").body,
  },
  {
    name: "profile menu",
    file: "src/components/nav/ProfileDropdown.vue",
    row: (css: string) => block(block(css, "@include largePhones").body, ".item:not(.info)").body,
  },
];

describe.each(HOSTS)("$name on a phone", ({ file, row, fontFile }) => {
  const css = styleBlock(read(file));
  const fontCss = styleBlock(read(fontFile ?? file));
  const body = row(css);

  it("finds its phone row rule", () => {
    expect(body, `no phone row rule in ${file}`).not.toBe("");
  });

  it("is a 56px row from the token", () => {
    expect(ownDeclarations(body).match(/min-height:[^;]*;/g)).toEqual(["min-height: $phone-list-row;"]);
  });

  it("sizes its glyph and label from the tier", () => {
    expect(css).toMatch(/\$phone-list-glyph;/);
    expect(fontCss).toMatch(/font-size:\s*\$phone-list-font;/);
  });
});

describe("the context menu's separators on a phone", () => {
  // They carry `.context-item` too; a row rule on the bare class made every
  // separator an empty 56px row.
  const ITEM = styleBlock(read("src/components/Contextmenu/ContextItem.vue"));
  const phone = block(ITEM, "@include largePhones").body;

  it("sizes rows only, never separators", () => {
    expect(phone, "phone rule not found").not.toBe("");
    const rowSelectors = phone.match(/[^{};]*\.context-item[^{};]*\{/g) ?? [];
    expect(rowSelectors.length).toBeGreaterThan(0);
    for (const selector of rowSelectors) expect(selector).toContain(":not(.separator)");
  });
});

describe("the context menu on a short phone", () => {
  // Eleven 56px rows (the track menu) are 632px of list — more than a 560px
  // phone viewport. The menu scrolls inside the screen, and that only works
  // together with the two pieces below: a scroller clips what it positions.
  const MENU = styleBlock(read("src/components/ContextMenu.vue"));
  const phone = block(MENU, "@include largePhones").body;
  const STORE = read("src/stores/context.ts");
  const ITEM = read("src/components/Contextmenu/ContextItem.vue");

  it("scrolls within the viewport and stays inside its width", () => {
    expect(phone, "phone menu rule not found").not.toBe("");
    expect(phone).toMatch(/max-height:\s*calc\(100dvh/);
    expect(phone).toMatch(/overflow-y:\s*auto;/);
    // `overflow-y: auto` alone turns x to auto as well: the menu panned.
    expect(phone).toMatch(/overflow-x:\s*hidden;/);
    expect(phone).toMatch(/width:\s*min\(17\.5rem,\s*calc\(100vw/);
  });

  it("opens submenus that the scrolling menu cannot clip", () => {
    // `fixed` escapes the scroller's clip only while the menu has no
    // transform, which popper would otherwise set to position it.
    expect(ITEM).toMatch(/strategy:\s*'fixed'/);
    expect(STORE).toMatch(/gpuAcceleration:\s*false/);
  });

  it("is pushed back inside the screen sideways", () => {
    // 280px does not fit either side of a tap on a 360px screen; without
    // `altAxis` the menu ran up to 40px off the right edge.
    expect(STORE).toMatch(/name:\s*"preventOverflow",\s*options:\s*\{\s*altAxis:\s*true/);
  });
});
