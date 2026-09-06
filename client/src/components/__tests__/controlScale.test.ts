import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { blocks, ownDeclarations, styleBlock } from "./scssBlocks";

// ---------------------------------------------------------------------------
// A control's FOOTPRINT comes from a token, and a shared component states its
// own — nobody corrects it from the outside.
//
// Measured on the running app (12 routes × desktop and phone): 1164 square icon
// buttons in six sizes — 22, 26, 28, 32, 44, 52 px. The favourite toggle
// accounted for three of them at once. `HeartSvg.vue` declared a 54×36 box
// through `btn-quiet`, and it rendered in exactly ZERO of its call sites:
//
//   TrackDuration.vue  `> .heart-button { all: unset !important }` + a 28px
//                      wrapper scaled by 0.8            -> 22,4 px
//   BottomBar/Left.vue four `!important` squaring it    -> 26 px
//   BottomBar/Right.vue excluded it from the row's own sizing rule BY NAME
//   TrackItem.vue      a hand-written copy of btn-quiet -> 32 px
//
// That is the shape the drift always takes here: the correction is right next
// to the thing it corrects, so each one reads as deliberate, and only counting
// them across files shows the component's own role was dead letter.
// ---------------------------------------------------------------------------
const SOURCES = import.meta.glob("/src/**/*.vue", { as: "raw", eager: true }) as Record<string, string>;

// `import.meta.glob(..., { as: "raw" })` hands back an EMPTY STRING for .scss —
// Vite runs stylesheets through the CSS pipeline, which is stubbed under test.
const TOKEN_FILE = "src/assets/scss/Global/_buttons.scss";

const HEART = "/src/components/shared/HeartSvg.vue";
const TRACK_DURATION = "/src/components/shared/SongItem/TrackDuration.vue";
// TrackItem.vue is gone (#416) — the queue panel it belonged to became the Now
// Playing panel, and the search Top tab it also fed now renders SongItem like
// the Tracks tab beside it. Its two entries below went with it.

/** Box geometry. A shared component owns these; a call site never restates them. */
const BOX = /(?:^|[\s;{])(?:width|height|min-width|min-height|padding|border|background|aspect-ratio|transform)\s*:/;

/** In-row controls that have to read the compact token rather than a literal. */
const COMPACT_CONTROLS: [file: string, selector: string, what: string][] = [
  [TRACK_DURATION, ".options-icon", "the track row's overflow button"],
];

const SIDEBAR = "/src/components/LeftSidebar/index.vue";

/**
 * The sidebar is the app's DENSE tier — 28px, deliberately below the 32px of a
 * content row (#388 sized it so the row survives the hatch ring). Until it had
 * a name it was 756 anonymous instances, the single biggest group in the app.
 */
const DENSE_CONTROLS: [file: string, selector: string, what: string][] = [
  [SIDEBAR, ".sidebar-newfolder", "the library's new-folder button"],
  [SIDEBAR, ".sidebar-pl-img", "the sidebar row thumbnail"],
  [SIDEBAR, ".pl-play-overlay", "the play overlay on that thumbnail"],
];

/** A literal length where a tier token belongs. `%` is fine — it is relative. */
const LITERAL_SIZE = /(?:^|[\s;{])(?:width|height)\s*:\s*[\d.]+(?:px|rem|em)\b/;

describe("control scale", () => {
  it("reads the two footprint tokens", () => {
    // The guard on this file's own inputs: renamed or unreadable, and every
    // check below would pass against nothing.
    const scss = readFileSync(TOKEN_FILE, "utf8");
    expect(scss).toMatch(/\$bar-control:\s*2\.75rem\s*;/);
    expect(scss).toMatch(/\$control-compact:\s*2rem\s*;/);
    expect(scss).toMatch(/\$control-compact-glyph:\s*1rem\s*;/);
    expect(scss).toMatch(/\$control-dense:\s*1\.75rem\s*;/);
    expect(scss).toMatch(/\$control-dense-glyph:\s*1rem\s*;/);

    // The knob that stops small plates from overriding `svg` at their call
    // site. Without it `btn-action` puts a 24px glyph in a 22px opening.
    expect(scss, "btn-action lost its $glyph parameter").toMatch(/@mixin btn-action\([^)]*\$glyph:/);
  });

  it("gives the favourite toggle one role per footprint, in the component", () => {
    const css = styleBlock(SOURCES[HEART]);

    // The second guard — an unreadable component must fail loudly.
    expect(blocks(css, ".heart-button").length).toBeGreaterThan(0);

    expect(css, "the bare variant no longer states the compact token").toMatch(
      /@include btn-quiet\(\$size: \$control-compact/
    );
    // The FOOTPRINT is what this file guards, not which role supplies it: the
    // bar variant moved from `btn-quiet` to `btn-action` when the bar's buttons
    // got their plate, and it kept the same 44px box throughout. Pinning the
    // mixin name here made a look change fail a size test.
    expect(css, "the bar variant no longer states $bar-control").toMatch(
      /\.heart-button\.role-bar[\s\S]{0,200}@include btn-(?:quiet|action)\(\$size: \$bar-control/
    );
    expect(css, "the header variant no longer takes btn-action").toMatch(
      /\.heart-button\.role-action[\s\S]{0,200}@include btn-action/
    );
  });

  // The census. Not "the four files we know about" — every component, so a
  // fifth call site cannot quietly open the same hole.
  it.each(Object.keys(SOURCES).filter(file => file !== HEART))(
    "%s does not size the favourite toggle from outside",
    file => {
      for (const body of blocks(styleBlock(SOURCES[file]), ".heart-button")) {
        const own = ownDeclarations(body);
        expect(
          BOX.test(own),
          `${file} states box geometry on .heart-button. The component owns its footprint ` +
            `(btn_role="compact" | "bar" | "action"); a call site that corrects it from outside is ` +
            `how the same toggle came to render at 22, 26 and 32px in one app.`
        ).toBe(false);
        expect(own, `${file} uses !important on .heart-button`).not.toMatch(/!important/);
        expect(own, `${file} unsets the role wholesale`).not.toMatch(/all\s*:\s*unset/);
      }
    }
  );

  it.each(COMPACT_CONTROLS)("%s › %s (%s) reads $control-compact", (file, selector, what) => {
    const found = blocks(styleBlock(SOURCES[file]), selector);
    expect(found.length, `${what}: no ${selector} block to read`).toBeGreaterThan(0);
    expect(ownDeclarations(found[0]), `${what} sizes itself instead of reading the token`).toMatch(
      /\$control-compact/
    );
  });

  it.each(DENSE_CONTROLS)("%s › %s (%s) reads $control-dense", (file, selector, what) => {
    const found = blocks(styleBlock(SOURCES[file]), selector);
    expect(found.length, `${what}: no ${selector} block to read`).toBeGreaterThan(0);

    expect(found[0], `${what} does not mention the dense tier`).toMatch(/\$control-dense/);
    expect(
      LITERAL_SIZE.test(ownDeclarations(found[0])),
      `${what} states a literal width/height. The sidebar is a named tier now ($control-dense); ` +
        `a literal here is how 756 controls came to share a size that no token knew about.`
    ).toBe(false);
  });

  // ⚠️ The list above is the weak spot, and it proved it within the hour: #407
  // added a `.folder-icon-slot` at `width: 1.75rem` — a NEW selector, so no
  // entry in DENSE_CONTROLS covered it, and its comment even pointed at another
  // literal's history ("1.75rem since #388") instead of at the token.
  //
  // A tier value written as a literal is always a missed token, whatever the
  // selector is called. So this rule is keyed on the VALUE, not on a list: in
  // the sidebar, 1.75rem / 2rem / 2.75rem as a width or height is a finding.
  // Other numbers are untouched — 3rem covers, 12px spacers and every `%` stay
  // exactly as free as they were.
  it("the sidebar writes no tier value as a literal", () => {
    const css = styleBlock(SOURCES[SIDEBAR]);
    expect(css.length, "the sidebar stylesheet is unreadable").toBeGreaterThan(1000);

    const offenders = [...css.matchAll(/(?:^|[\s;{])(width|height)\s*:\s*(1\.75rem|2rem|2\.75rem)\s*;/g)].map(
      m => `${m[1]}: ${m[2]}`
    );

    expect(
      offenders,
      `LeftSidebar/index.vue writes ${offenders.join(", ")} as a literal. Those are tier values: ` +
        `1.75rem = $control-dense, 2rem = $control-compact, 2.75rem = $bar-control. Naming them is ` +
        `the whole point — a literal here is a token that will drift again.`
    ).toEqual([]);
  });

  // Both used to be `<div>` with `@click`: not reachable by keyboard, no name,
  // no focus ring (the app's ring is on the `button` selector).
  it.each([
    [TRACK_DURATION, "options-icon", "the track row's overflow control"],
  ])("%s › .%s (%s) is a real button", (file, cls, what) => {
    const template = SOURCES[file].slice(0, SOURCES[file].indexOf("</template>"));
    const tag = new RegExp(`<(\\w+)[^>]*class="[^"]*\\b${cls}\\b`).exec(template);

    expect(tag, `${what}: no element carries .${cls}`).toBeTruthy();
    expect(tag?.[1], `${what} is a <${tag?.[1]}>, not a <button>`).toBe("button");
    expect(
      /<button[\s\S]*?aria-label/.exec(template.slice(tag?.index ?? 0)),
      `${what} has no aria-label`
    ).toBeTruthy();
  });
});
