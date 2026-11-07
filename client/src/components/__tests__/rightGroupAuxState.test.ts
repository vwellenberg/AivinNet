import { describe, expect, it } from "vitest";

import { block, styleBlock } from "./scssBlocks";

// ---------------------------------------------------------------------------
// On a phone, shuffle and repeat live in the Now Playing view's button row,
// which renders BottomBar/Right.vue with `hide-heart` and `hide-volume`. There
// the ON and OFF states looked identical: both were the plain white plate.
//
// Cause (specificity): Right.vue's plate rule
//   `.right-group > button:not(.heart-button):not(.devices-btn):not(.sleep-timer-btn)`
// is 0,4,1. The state rules were top-level `button.aux:not(.aux-off)` and
// `button.aux.aux-off`, both 0,3,1, so the plate won every time. The desktop
// transport never showed it: its own rules sit on a different selector.
//
// Two halves, both pinned here:
//
// 1. The state rules are NESTED inside the plate's block (so they carry its
//    specificity plus their own classes), and the pointer-only hover of the
//    dimmed glyph stays gated.
//
// 2. Header.vue's `$np-aux-controls` (the width of the centred cluster) equals
//    the number of controls Right.vue renders when both `hide-heart` and
//    `hide-volume` are set on a phone. The count below is taken from Right.vue's
//    template with a small tag scanner: a control is an element that sits
//    directly under the `.right-group` root, where `<template>` is transparent
//    (the mobile-only repeat and shuffle sit inside one), and an element whose
//    `v-if` names hideHeart or hideVolume is dropped. That leaves repeat,
//    shuffle, lyrics, sleep timer and devices: five.
//
// Read through Vite's raw glob, like the other source censuses.
// ---------------------------------------------------------------------------

const SOURCES = import.meta.glob("/src/**/*.vue", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

const RIGHT = "/src/components/BottomBar/Right.vue";
const HEADER = "/src/components/NowPlaying/Header.vue";

const PLATE = "> button:not(.heart-button):not(.devices-btn):not(.sleep-timer-btn)";

/** Element names of the template's direct controls, with `hideHeart`/`hideVolume` gated ones dropped. */
function renderedControls(source: string): string[] {
  const template = source.slice(source.indexOf("<template>"), source.indexOf("<script")).replace(/<!--[\s\S]*?-->/g, "");
  // Attribute values may contain `>` (`@click="() => …"`), so quoted runs are matched whole.
  const tag = /<(\/?)([A-Za-z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  const stack: { counts: boolean }[] = [];
  const controls: string[] = [];

  for (const [, closing, name, attrs] of template.matchAll(tag)) {
    if (closing) {
      stack.pop();
      continue;
    }
    const gated = /\bhide(?:Heart|Volume)\b/.test(attrs);
    // `<template>` only groups; everything else is an element a reader sees.
    const counts = name !== "template" || gated;
    const depth = stack.filter(entry => entry.counts).length;
    // The SFC's own <template> is depth 0 and the root <div> is depth 0 too; the root's
    // children sit at depth 1.
    if (counts && depth === 1 && !gated) controls.push(name);
    if (!attrs.trimEnd().endsWith("/")) stack.push({ counts });
  }
  return controls;
}

describe("the phone's aux row: shuffle and repeat show their state", () => {
  const style = styleBlock(SOURCES[RIGHT]);
  const plate = block(style, PLATE);

  it("finds the plate rule it guards", () => {
    expect(plate.end, "plate rule not found in Right.vue").not.toBe(-1);
  });

  it("states the ON and OFF rules inside the plate, so they out-rank it", () => {
    expect(plate.body).toMatch(/&\.aux:not\(\.aux-off\)\s*\{\s*@include btn-toggle-on/);
    expect(plate.body).toMatch(/&\.aux\.aux-off\s*\{\s*color:/);
  });

  it("keeps the dimmed glyph's hover pointer-only, nested in the same plate", () => {
    expect(plate.body).toMatch(/@media \(hover: hover\)\s*\{\s*&\.aux\.aux-off:hover\s*\{/);
  });

  it("leaves no top-level state rule behind at the plate's old, lower specificity", () => {
    expect(style).not.toMatch(/(?:^|[\s}])button\.aux[.:\s{]/);
  });
});

describe("the centred cluster is as wide as the row it sizes", () => {
  it("counts the controls Right.vue renders with hide-heart and hide-volume", () => {
    const controls = renderedControls(SOURCES[RIGHT]);
    // Pinned names too: the scanner must see the real controls, not an empty list.
    expect(controls).toEqual(["button", "button", "LyricsButton", "SleepTimerButton", "DevicesButton"]);
  });

  it("Header.vue passes both flags to that row", () => {
    expect(SOURCES[HEADER]).toMatch(/<Buttons\s+:hide-heart="true"\s+:hide-volume="true"/);
  });

  it("Header.vue's $np-aux-controls equals that count", () => {
    const declared = SOURCES[HEADER].match(/\$np-aux-controls:\s*(\d+);/);
    expect(declared, "$np-aux-controls not found in Header.vue").not.toBeNull();
    expect(Number(declared![1])).toBe(renderedControls(SOURCES[RIGHT]).length);
  });
});
