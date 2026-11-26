import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

import { block, styleBlock } from "./scssBlocks";

// ---------------------------------------------------------------------------
// The "this one" zigzag on the active nav entry stays on the leading edge.
//
// The marker is a BACKGROUND LAYER (mem-row-marker), and the plate's hover
// (mem-row-plate-hover) stirs the texture with a transition on
// `background-position` — one position for the whole layer list. So the marker
// rode along: right after a click (pointer still on the entry) the teeth were
// replaced by the hover sprite, and when the pointer left they slid 9px back
// to the edge (measured 9px -> 0 over $motion-move on the live build;
// reported 2026-11-25). The active row's own hover keeps the marker layer at
// `left top`, so there is nothing for the transition to move.
// ---------------------------------------------------------------------------

// Read from disk: a raw glob returns `.scss` as an EMPTY string under Vitest.
const candy = readFileSync("src/assets/scss/_candy.scss", "utf8");
const buttonClasses = readFileSync("src/assets/scss/Global/_button-classes.scss", "utf8");
const nav = styleBlock(readFileSync("src/components/LeftSidebar/NavButtons.vue", "utf8"));

const marker = block(candy, "@mixin mem-row-marker($w: 9px)").body;
const hover = block(marker, "&:hover").body;

/** The layers of a background list: split on top-level commas. */
function layers(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    if (char === "(") depth++;
    else if (char === ")") depth--;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function declaration(body: string, prop: string): string {
  // Comments in the mixin say "transition" in prose; never read them as CSS.
  const code = body.replace(/\/\/[^\n]*/g, "");
  const m = new RegExp(`(?:^|[;{\\s])${prop}:\\s*([^;]+);`).exec(code);
  return m ? m[1].trim() : "";
}

describe("the active entry's zigzag", () => {
  it("found the marker mixin and the nav that uses it", () => {
    expect(marker, "mem-row-marker not found").not.toBe("");
    expect(block(nav, "&.active").body).toMatch(/@include\s+mem-row-marker\b/);
  });

  it("has its own hover, so the plate's stir cannot reach the marker layer", () => {
    expect(hover, "mem-row-marker has no &:hover block").not.toBe("");
  });

  it("keeps the marker as the first layer under the pointer, at the edge", () => {
    const images = layers(declaration(hover, "background-image"));
    expect(images[0]).toBe("$mem-row-marker-sprite");
    expect(images[1]).toBe("var(--mem-hatch-hover)");

    const positions = layers(declaration(hover, "background-position"));
    expect(positions, "one position per layer").toHaveLength(2);
    expect(positions[0]).toBe("left top");
    // The hatch's spot travels as a property so the slide-in keyframe can name it.
    expect(positions[1]).toBe("var(--marker-hatch-at)");
    expect(declaration(hover, "--marker-hatch-at")).toBe("#{$mem-hatch-stir}");
    expect(declaration(marker, "--marker-hatch-at")).toBe("left top");
  });

  // User, 2026-11-26: the teeth should come in from the left. The slide is an
  // ANIMATION on becoming active, never a transition (see the test below).
  it("slides the teeth in from under the left frame when the entry becomes active", () => {
    const anim = layers(declaration(marker, "animation")).map((part) => part.split(/\s+/)[0]);
    expect(anim).toContain("mem-marker-in");

    const keyframes = block(buttonClasses, "@keyframes mem-marker-in").body;
    expect(keyframes, "@keyframes mem-marker-in not in Global/_button-classes.scss").not.toBe("");
    const from = layers(declaration(block(keyframes, "from").body, "background-position"));
    expect(from, "one position per layer").toHaveLength(2);
    // A whole sprite (9px) left of the padding edge: hidden under the frame.
    expect(from[0]).toBe("-9px 0");
    // The hatch stays where it is, at rest and under the pointer.
    expect(from[1]).toMatch(/^var\(--marker-hatch-at\b/);
    // No end frame: the layer lands on its declared value.
    expect(block(keyframes, "to").body).toBe("");
    expect(keyframes).not.toMatch(/100%\s*\{/);
  });

  it("keeps the slide where the desktop reach-out replaces the animation shorthand", () => {
    const desktop = block(nav, ".nav-item.active:not(.separator)").body;
    expect(desktop, "desktop active block not found").not.toBe("");
    const anim = layers(declaration(desktop, "animation")).map((part) => part.split(/\s+/)[0]);
    expect(anim).toEqual(expect.arrayContaining(["nav-reach", "mem-marker-in"]));
  });

  it("does not glide in when the entry becomes active under the pointer", () => {
    // Hovered as a plain row the entry has ONE layer at `$mem-hatch-stir`; the
    // click adds the marker layer, and a `background-position` transition
    // slid the teeth 9px -> 0 (measured from the click on the live build).
    const transition = declaration(marker, "transition");
    expect(transition, "mem-row-marker sets no transition of its own").not.toBe("");
    const props = layers(transition).map((part) => part.split(/\s+/)[0]);
    expect(props).not.toContain("background-position");
    expect(props).not.toContain("all");
    expect(props).toEqual(expect.arrayContaining(["transform", "box-shadow"]));
  });

  it("rests at the same spot it hovers at", () => {
    const rest = layers(declaration(marker, "background-position"));
    expect(rest[0]).toBe("left top");
    expect(layers(declaration(hover, "background-size"))).toEqual(
      layers(declaration(marker, "background-size")),
    );
  });
});
