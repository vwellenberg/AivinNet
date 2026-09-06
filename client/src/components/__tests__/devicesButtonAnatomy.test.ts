import { describe, expect, it } from "vitest";

import { block, styleBlock } from "./scssBlocks";

// ---------------------------------------------------------------------------
// The devices button is ONE button, on every screen it appears on.
//
// It has three hosts, and before this test they had drifted into three
// different controls:
//
//   BottomBar/Right.vue     desktop bar   plated via the host's `btn-action`
//   BottomBar/Left.vue      phone bar     `border: none; background: transparent`
//   NowPlaying/Header.vue   phone NP      a bare 44px box, no role at all
//
// So on a phone — the one device where group playback is the point — it was the
// only control in a row of plated ones with no surface at all, sitting next to a
// prev/play/next that all carry plate, frame and offset shadow. Reported by the
// user as "sieht nicht wie ein Button aus (kein Schatten etc.)".
//
// The shape of the bug is what makes it worth a census rather than a fix: none
// of the three hosts looked wrong on its own. Each was internally consistent,
// and the drift was only visible by putting two screens side by side. So the
// rule under test is not "the phone bar is plated" — it is "no host styles this
// button at all".
//
// ⚠️ A source-scanning test goes quietly green when its parser breaks (see
// .claude/rules/testing.md), so every expectation below is paired with a guard
// over its own input.
// ---------------------------------------------------------------------------
const SOURCES = import.meta.glob("/src/**/*.vue", { as: "raw", eager: true }) as Record<string, string>;

const COMPONENT = "/src/components/DeviceSync/DevicesButton.vue";

/**
 * The hosts are SWEPT, not listed: a hardcoded list passes silently the moment
 * a fourth screen starts patching the button from outside, which is exactly the
 * failure mode this file exists for. The three below are only the guard that
 * the sweep is looking at something real.
 */
const KNOWN_HOSTS = [
  "/src/components/BottomBar/Left.vue",
  "/src/components/BottomBar/Right.vue",
  "/src/components/NowPlaying/Header.vue",
];

/**
 * Class names that mean "this rule is about the devices button". `np-devices`
 * is in here because a descendant selector is how the Now Playing header sized
 * it without ever naming the button — the drift does not have to spell out the
 * class.
 *
 * ⚠️ Matched against the SELECTOR TEXT, not via `block()`. That helper's opener
 * requires the name to follow line-start, whitespace, `,` or `>`, so a compound
 * selector slips past it — and `> button.ds-joined { … }` is precisely the form
 * `Right.vue` used before this PR. A census blind to the shape of the bug it
 * was written for is worse than none.
 */
const OWNED_CLASSES = ["devices-btn", "bar-devices", "ds-joined", "np-devices"];

describe("devices button anatomy", () => {
  it("takes its own role, at the chrome footprint", () => {
    const source = SOURCES[COMPONENT];
    expect(source, `${COMPONENT} not found — did it move?`).toBeTruthy();

    const css = styleBlock(source);
    // Guard over the input: the class has to be in there, or the two
    // expectations below are asserting against an empty string.
    expect(css, "no `.devices-btn` block — the parser or the file changed").toContain(".devices-btn");

    const body = block(css, ".devices-btn").body;
    expect(body).toMatch(/@include\s+btn-action\(\s*\$size:\s*\$bar-control\s*\)/);

    // The joined state is the app's other persistent on/off and wears the same
    // toggle box shuffle and repeat do — which is also what finally gives it
    // the offset shadow it never had (`candy-box` alone paints fill + frame).
    const joined = block(body, "&.ds-joined").body;
    expect(joined, "no `&.ds-joined` block inside `.devices-btn`").not.toBe("");
    expect(joined).toMatch(/@include\s+btn-toggle-on\(/);
    expect(joined, "the joined fill is the brand green, not a fresh literal").toContain("$brand-green");
    // ⚠️ The argument NAMES, not just the include. This test matches raw text,
    // so it stayed green on `$glyph:` — which Dart Sass rejects outright
    // ("No argument named $glyph"), i.e. the census passed a build-breaking
    // call site. `$glyph` is a glyph SIZE everywhere else in _buttons.scss, so
    // it is the mistake a reader of that file makes first.
    expect(joined, "the glyph colour argument is `$glyph-color` — `$glyph` is a SIZE elsewhere").toContain(
      "$glyph-color:"
    );
    expect(joined).not.toMatch(/\$glyph\s*:/);
  });

  it("is hosted by the three screens this census knows about", () => {
    const hosts = Object.keys(SOURCES).filter(path => path !== COMPONENT && SOURCES[path].includes("DevicesButton"));
    // Not an exact-match assertion — a fourth host is allowed, it just has to
    // pass the sweep below like the others. What this rules out is the sweep
    // running over an empty or mis-globbed set.
    expect(hosts).toEqual(expect.arrayContaining(KNOWN_HOSTS));
  });

  it("is styled by no host at all", () => {
    const offenders = Object.entries(SOURCES)
      .filter(([path]) => path !== COMPONENT)
      // ⚠️ `styleBlock` slices from `<style>`, so a component WITHOUT one hands
      // back the file's last character and every check below would pass on an
      // empty string. That is the silent green this file's header warns about,
      // so a styleless component is skipped explicitly rather than "passing".
      .filter(([, source]) => source.includes("<style"))
      .flatMap(([path, source]) => selectorsIn(styleBlock(source)).map(sel => ({ path, sel })))
      .filter(({ sel }) => {
        // `:not(.devices-btn)` is an EXCLUSION, not a rule about the button —
        // it is how the desktop bar plates its other controls while leaving
        // this one to its own role. Strip those before looking.
        const bare = sel.replace(/:not\([^)]*\)/g, "");
        return OWNED_CLASSES.some(cls => new RegExp(`\\.${cls}\\b`).test(bare));
      })
      .map(({ path, sel }) => `${path}: ${sel}`);

    expect(
      offenders,
      "the devices button owns its whole anatomy in DevicesButton.vue. A host patching it " +
        "from outside is how the same component became three different buttons — plated on " +
        "desktop, bare on the phone bar, and a role-less 44px box in the Now Playing header."
    ).toEqual([]);
  });
});

/**
 * Every selector that opens a rule in a stylesheet, whatever its shape.
 *
 * Deliberately not `block()`: this has to see `> button.ds-joined` and
 * `.np-devices button` as readily as a bare class, because a host patch is
 * written in whichever form is convenient at the time — and the two the repo
 * actually used were both compound.
 */
function selectorsIn(css: string): string[] {
  return [...css.matchAll(/(^|[;{}])([^;{}]+?)\{/g)]
    .map(m => m[2].replace(/\s+/g, " ").trim())
    .filter(sel => sel && !sel.startsWith("@"));
}
