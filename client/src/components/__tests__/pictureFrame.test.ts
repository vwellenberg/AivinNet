import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { namedRules, sourceFiles } from "./scssBlocks";

// ---------------------------------------------------------------------------
// EVERY PICTURE WEARS THE PICTURE FRAME — `$mem-picture-frame`, one name.
//
// Covers, portraits and thumbnails (and the tiles that stand in for one) used
// to pick their own weight. Most took the 3px plate border, but four drifted to
// the 2px ring one by one — the sidebar thumbnails, the chart covers, the
// folder list's icon tiles, the artist avatar on "all tracks", the "not
// interested" covers — and each read as a thin frame between thick ones (user,
// 2026-11-17: "striche wirken zu dünn"). No file looked wrong on its own; the
// drift only showed with two screens side by side.
//
// So the census collects every rule whose selector names a picture and sets a
// visible border, and holds it to the token. Collected, not listed: a new
// cover anywhere in the app is in the census the moment it gets a frame.
// ---------------------------------------------------------------------------

/** Comments out — `[^:]` keeps `https://` inside a `url()` intact. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function styleOf(path: string): string {
  const raw = readFileSync(path, "utf8");
  if (path.endsWith(".scss")) return stripComments(raw);
  const styles = raw.match(/<style[^>]*>[\s\S]*?<\/style>/gi) ?? [];
  return stripComments(styles.join("\n").replace(/<\/?style[^>]*>/gi, "\n"));
}

/**
 * A selector that names a picture: the cover/art/thumbnail/avatar classes, the
 * sidebar's thumbnail and folder tile, the folder list's icon tile, and a bare
 * `img` (every picture element in the app is one).
 */
const PICTURE =
  /(^|[\s>.&-])(img|[\w-]*cover|[\w-]*-art|album-art|card-art|[\w-]*thumb[\w-]*|[\w-]*avatar|chartimage|sidebar-pl-img|folder-icon-slot|f-glyph|[\w-]*artist-img)(?=$|[\s:.,[>)])/;

/**
 * Pictures that are framed on purpose with something else, each with its reason.
 * Keyed `file :: selector`.
 */
const ALLOWED: Record<string, string> = {
  // The radio is a glass display: everything on it, the cover included, is drawn
  // in the glass ink ($glass-dim) at the ring weight, like its buttons and lamp.
  "src/components/HomeView/RadioDial.vue :: .radio-now-cover":
    "part of the glass display, which has its own ink and weight",
};

interface Frame {
  key: string;
  border: string;
}

function framesIn(path: string): Frame[] {
  const out: Frame[] = [];
  for (const rule of namedRules(styleOf(path))) {
    const selectors = rule.selector.split(",").map(s => s.trim());
    // A range input's knob is called a thumb too; it is a control, not a picture.
    if (selectors.every(s => /range-thumb|slider-thumb/.test(s))) continue;
    if (!selectors.some(s => PICTURE.test(s))) continue;
    for (const m of rule.own.matchAll(/(?:^|[;{\s])border\s*:\s*([^;]+);/g)) {
      const value = m[1].trim();
      if (/^(none|0|unset|initial|inherit)\b/.test(value) || /transparent/.test(value)) continue;
      out.push({ key: `${path} :: ${rule.selector}`, border: value });
    }
  }
  return out;
}

const FRAMES = sourceFiles("src").flatMap(framesIn);

describe("every picture wears the picture frame", () => {
  it("finds the pictures it claims to sweep", () => {
    // Guards against a parser that broke quietly (.claude/rules/testing.md):
    // known pictures in four different places must be in the census.
    const keys = FRAMES.map(f => f.key).join("\n");
    expect(keys).toContain("src/components/LeftSidebar/index.vue :: .sidebar-pl-img");
    expect(keys).toContain("src/components/Stats/ChartItem.vue :: .chartimage");
    expect(keys).toContain("src/components/shared/SongItem/TrackTitle.vue :: .album-art");
    expect(keys).toContain("src/components/FolderView/FolderList.vue :: .f-glyph");
    expect(FRAMES.length).toBeGreaterThan(10);
  });

  it("frames each one with $mem-picture-frame", () => {
    const offenders = FRAMES.filter(f => !(f.key in ALLOWED) && f.border !== "$mem-picture-frame").map(
      f => `${f.key}  →  border: ${f.border}`
    );
    expect(offenders).toEqual([]);
  });

  it("keeps the allow-list live", () => {
    const keys = new Set(FRAMES.map(f => f.key));
    for (const key of Object.keys(ALLOWED)) expect(keys.has(key), key).toBe(true);
  });

  it("defines the token at the plate weight", () => {
    const candy = readFileSync("src/assets/scss/_candy.scss", "utf8");
    expect(candy).toMatch(/^\$mem-picture-frame: \$candy-border;/m);
  });
});
