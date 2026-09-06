import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { blocks, styleBlock } from "./scssBlocks";

// ---------------------------------------------------------------------------
// The favourited state is a COLOUR, and every role has to let it through.
//
// `HeartSvg.vue` states the state once — `.heart-button.is-fav { color: teal }`
// — and then hands each footprint its anatomy through a role. Every one of
// those role blocks includes a `btn-*` mixin, and every one of those mixins
// sets `color`. They match at the SAME specificity as the state rule (0,2,0)
// and sit LATER in the file, so each new role silently takes the colour away
// again unless it re-asserts it.
//
// That is not hypothetical. `role-action` has carried the re-assert since #90.
// `role-bar` arrived with #387 without it, and the marker in the player bar
// measured `fill: rgb(23,23,26)` on the deployed app where the same marker in a
// track row measures `rgb(47,191,163)`. Nobody saw it for a release, because
// the glyph of the day was a disc with a fixed ink edge and an ink tick: ink on
// ink reads as a dark blob, not as a wrong colour.
//
// So this counts the roles instead of naming them — a fourth role added
// tomorrow fails here until it decides about the state colour.
// ---------------------------------------------------------------------------
const HEART = "src/components/shared/HeartSvg.vue";

const source = styleBlock(readFileSync(HEART, "utf8"));

/** `.heart-button.role-bar`, `.heart-button.role-action`, … in source order. */
const ROLE_SELECTORS = [...source.matchAll(/\.heart-button\.(role-[\w-]+)/g)].map(m => m[1]);

describe("favourite state colour", () => {
  it("finds the component and its role blocks (guard against a broken parser)", () => {
    expect(source.length).toBeGreaterThan(200);
    expect(new Set(ROLE_SELECTORS).size).toBeGreaterThanOrEqual(2);
  });

  it("states the favourited colour once, on the base class", () => {
    const base = blocks(source, ".heart-button");
    expect(base.length).toBeGreaterThan(0);
    expect(base.some(b => /&\.is-fav[\s\S]*?\$mem-teal/.test(b))).toBe(true);
  });

  it.each([...new Set(ROLE_SELECTORS)])(
    "%s re-asserts the favourited colour after its role mixin",
    role => {
      const body = blocks(source, `.heart-button.${role}`).join("\n");
      expect(body, `no \`.heart-button.${role}\` block found`).not.toBe("");

      // A role that brings no `btn-*` mixin cannot overwrite `color`, so it
      // needs nothing. One that does must SAY what the state looks like.
      if (!/@include\s+btn-/.test(body)) return;

      // Deliberately not "must be teal", even though every role states teal
      // today. `role-bar` argued the other way for a release — the fill of the
      // glyph carries the state there, teal belongs to the play button — and
      // that is a decision, so it belongs in the file rather than in this test.
      // (It lost: an ink heart on the bar's paper plate reads as a dark blob.
      // See #542.) What must not happen is a role that says
      // nothing and lets the cascade decide: intent and accident look the same
      // on screen, which is how the bar lost its teal for a release (#396).
      expect(
        /&\.is-fav[\s\S]{0,240}?color\s*:/.test(body),
        `\`.heart-button.${role}\` includes a btn-* mixin (which sets \`color\` at the same ` +
          "specificity as `.heart-button.is-fav`, later in the file) but never states a colour " +
          "for `&.is-fav`. Say what the favourited state looks like in this role — teal, the " +
          "role's own tone, whatever it is — so the next reader can tell intent from accident."
      ).toBe(true);
    }
  );
});
