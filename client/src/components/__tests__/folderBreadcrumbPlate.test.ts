import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { blocks, ownDeclarations, styleBlock } from "./scssBlocks";

// ---------------------------------------------------------------------------
// The breadcrumb is ONE plate, and its crumbs are text on it.
//
// Reported on the folder view: the path pill sat next to the two sort
// dropdowns in the same row, and read as a different kind of object — a bare
// pink tint with no frame and no shadow, 35px against their 44px, and the
// current folder painted pink again inside it. Two pinks side by side, no edge.
//
// So the pill takes the plate (`candy-box` + `candy-shadow`, the dropdowns'
// height), the current folder is marked by weight, and the crumbs take the
// shared hover token. The crumbs themselves stay flat: they are text
// navigation on that plate, not plates of their own.
//
// Read off disk, relative to the runner's cwd, like the other anatomy tests. A
// parser that breaks goes silently green, so every expectation sits next to a
// guard over its own input (.claude/rules/testing.md).
// ---------------------------------------------------------------------------
const FOLDER = styleBlock(readFileSync("src/components/nav/Titles/Folder.vue", "utf-8"));
const CRUMBS = styleBlock(readFileSync("src/components/FolderView/BreadCrumbNav.vue", "utf-8"));

describe("folder breadcrumb plate", () => {
  // `.fname` occurs three times in Folder.vue (the allPhones grid override, the
  // plate itself, the global scrollbar hiding). Only the plate has a justify.
  const plate = blocks(FOLDER, ".fname").map(ownDeclarations).find(own => /justify-self/.test(own));

  it("finds the plate and the active crumb it claims to check", () => {
    expect(plate, ".fname plate block not found in Folder.vue").toBeTruthy();
    expect(CRUMBS, "BreadCrumbNav.vue has no styles").toMatch(/\.inthisfolder\s*>\s*\.text/);
  });

  it("is a framed, shadowed plate — the same role as the sort dropdowns", () => {
    expect(plate).toMatch(/@include\s+candy-box\(/);
    expect(plate).toMatch(/@include\s+candy-shadow\(/);
    expect(plate).toMatch(/height:\s*2\.75rem/);
  });

  it("paints no bare tint of its own", () => {
    // The pink tint was the whole plate. Reintroducing a `$gray5` fill here is
    // exactly the frameless box this test exists for.
    expect(plate).not.toMatch(/\$gray5/);
  });

  it("marks the current crumb by weight, not by a fill", () => {
    const active = CRUMBS.match(/\.inthisfolder\s*>\s*\.text\s*\{([^}]*)\}/);
    expect(active, "the active crumb block was not found").toBeTruthy();
    expect(active?.[1]).toMatch(/font-weight:\s*700/);
    expect(active?.[1]).not.toMatch(/background/);
  });

  it("gives the crumb hover the shared token, not the retired tint", () => {
    expect(CRUMBS).toMatch(/background-color:\s*var\(--mem-hover\)/);
    expect(CRUMBS).toMatch(/color:\s*var\(--mem-hover-text\)/);
    expect(CRUMBS).not.toMatch(/\$gray\b/);
  });
});
