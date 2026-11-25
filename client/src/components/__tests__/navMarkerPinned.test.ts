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

const RAW = import.meta.glob(["/src/assets/scss/_candy.scss", "/src/components/LeftSidebar/NavButtons.vue"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const candy = RAW["/src/assets/scss/_candy.scss"] ?? "";
const nav = styleBlock(RAW["/src/components/LeftSidebar/NavButtons.vue"] ?? "");

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
  const m = new RegExp(`(?:^|[;{\\s])${prop}:\\s*([^;]+);`).exec(body);
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
    expect(positions[1]).toBe("$mem-hatch-stir");
  });

  it("rests at the same spot it hovers at", () => {
    const rest = layers(declaration(marker, "background-position"));
    expect(rest[0]).toBe("left top");
    expect(layers(declaration(hover, "background-size"))).toEqual(
      layers(declaration(marker, "background-size")),
    );
  });
});
