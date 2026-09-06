import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Every card type a `.cardscroller` row can render has to be listed in the
// shared anatomy block of src/assets/scss/Global/cards.scss.
//
// This is a test rather than a comment because the list is invisible from the
// component: a card that is missing from it still renders, just at its own
// height, radius and elevation — and only in a row that happens to mix it with
// another type does anyone notice. The folder tile sat outside the list and
// measured 176x245 next to a 176x248 playlist tile in "Recently played", with a
// 16px radius instead of 14px and no offset shadow.
// ---------------------------------------------------------------------------
// Components come through Vite, so the test sees exactly the files the build
// sees. The stylesheet cannot: `import.meta.glob(..., { as: "raw" })` on a
// `.scss` runs it through the CSS pipeline first, which is stubbed out under
// test — it hands back an empty string, and every check below would pass
// vacuously. Read it off disk instead (guarded by `it("reads the anatomy")`).
const SOURCES = import.meta.glob("/src/**/*.vue", { as: "raw", eager: true }) as Record<string, string>;
// Relative to the runner's cwd, which is the project root. The two anchors that
// look more principled do not work here: `import.meta.url` is left in a shape
// `fileURLToPath()` rejects (ERR_INVALID_ARG_TYPE), and `process.cwd()` trips
// `no-undef` because the lint config gives test files no node env.
const ANATOMY_FILE = "src/assets/scss/Global/cards.scss";

const SCROLLER = "/src/components/shared/CardScroller.vue";

// The skeleton shown while a row has no data. Deliberately out of the shared
// anatomy: a placeholder row is never mixed with real tiles (it exists only
// when the row is empty), and its four stacked bars do not fit the
// image + one text zone skeleton.
const EXEMPT = new Set(["CardContent"]);

/** Resolve an import specifier from CardScroller.vue to a key in SOURCES. */
function resolve(specifier: string): string {
  if (specifier.startsWith("@/")) return specifier.replace("@/", "/src/");

  const parts = "/src/components/shared".split("/").filter(Boolean);
  for (const segment of specifier.split("/")) {
    if (segment === ".") continue;
    else if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return "/" + parts.join("/");
}

/**
 * The components `getComponent()` can return, mapped to their source files.
 * Read out of the switch rather than listed here, so a new `case` shows up
 * without anyone remembering to add it.
 */
function cardComponents(): Map<string, string> {
  const source = SOURCES[SCROLLER];
  const imports = new Map<string, string>();

  for (const [, name, specifier] of source.matchAll(/import\s+(\w+)\s+from\s+["']([^"']+\.vue)["']/g)) {
    imports.set(name, resolve(specifier));
  }

  const body = source.slice(source.indexOf("function getComponent"));
  const returned = new Set(
    [...body.slice(0, body.indexOf("\n}")).matchAll(/return\s+(\w+)/g)].map(match => match[1])
  );

  const cards = new Map<string, string>();
  for (const name of returned) {
    if (EXEMPT.has(name)) continue;
    const file = imports.get(name);
    expect(file, `${name} is returned by getComponent but not imported as a .vue file`).toBeTruthy();
    cards.set(name, file as string);
  }
  return cards;
}

/** The class list of a single-file component's root element. */
function rootClasses(source: string): string[] {
  const template = source.slice(source.indexOf("<template>"));
  let i = 0;

  while (i < template.length) {
    const lt = template.indexOf("<", i);
    if (lt === -1) break;

    if (template.startsWith("<!--", lt)) {
      const end = template.indexOf("-->", lt);
      i = end === -1 ? template.length : end + 3;
      continue;
    }

    // Walk to the tag's own ">", skipping quoted attribute values so a ">"
    // inside a binding cannot end the tag early.
    let j = lt + 1;
    let quote = "";
    while (j < template.length) {
      const c = template[j];
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === ">") {
        break;
      }
      j++;
    }

    const raw = template.slice(lt + 1, j);
    const name = (raw.match(/^[\w.-]+/) || [""])[0];
    // <template> itself is the wrapper, not the root element.
    if (name && name !== "template") {
      const match = raw.match(/\bclass="([^"]*)"/);
      return match ? match[1].trim().split(/\s+/) : [];
    }
    i = j + 1;
  }

  return [];
}

/** The selectors of the shared anatomy list, e.g. ["p-card", "trackcard", …]. */
function anatomyClasses(): Set<string> {
  // Comments go FIRST. The file explains itself in prose that names the very
  // class names being looked for (".cardscroller", ".foldercard"), so parsing
  // the raw text would let a card pass this test by being mentioned in a
  // comment rather than by being in the selector list.
  const scss = readFileSync(ANATOMY_FILE, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  // The list lives in ONE Sass variable, because it is read three times (the
  // anatomy, the row geometry, this test) and a second copy is how the folder
  // tile drifted in the first place.
  const list = scss.match(/\$card-types:\s*"([^"]+)"/);
  expect(list, `${ANATOMY_FILE} has no $card-types list to read`).toBeTruthy();
  return new Set([...(list as RegExpMatchArray)[1].matchAll(/\.([\w-]+)/g)].map(match => match[1]));
}

describe("card row anatomy", () => {
  const cards = cardComponents();
  const listed = anatomyClasses();

  it("finds the card components CardScroller can render", () => {
    // A guard on the parsing above: if the switch is rewritten in a shape this
    // test cannot read, the checks below would pass vacuously.
    //
    // Five since the favourites tile went (#402): it was in this switch but no
    // caller ever produced a `favorite` item, so it rendered nowhere — counted
    // here, unseen on screen. The floor is a parser guard, not a target; it
    // moves with a deliberate removal and stays put for an accidental one.
    expect(cards.size).toBeGreaterThanOrEqual(5);
  });

  it("reads the anatomy selector list", () => {
    // The other guard. An unreadable or renamed stylesheet must fail loudly
    // rather than let every card through against an empty set.
    expect(listed.size).toBeGreaterThanOrEqual(5);
    expect(listed).toContain("album-card");
  });

  it.each([...cards])("%s is covered by the shared anatomy", (_name, file) => {
    const classes = rootClasses(SOURCES[file]);
    expect(classes.length, `${file} root element has no class to key the anatomy off`).toBeGreaterThan(0);
    expect(
      classes.some(cls => listed.has(cls)),
      `${file} root is class="${classes.join(" ")}" — none of these is listed in Global/cards.scss, ` +
        `so this tile computes its own height/radius/elevation and drifts from the rest of the row`
    ).toBe(true);
  });

  // `.rounded` is border-radius: 1rem and overrides the 14px `$candy-radius`
  // the anatomy's tiles share. Three cards carried it and were visibly a
  // different shape in the same row.
  it.each([...cards])("%s does not override the shared radius with .rounded", (_name, file) => {
    expect(rootClasses(SOURCES[file])).not.toContain("rounded");
  });

  // `.no-scroll` is `overflow: hidden`, and on a TILE root it eats the offset
  // shadows of the three plates inside it — silently: the declaration stays,
  // the computed style still reads `3px 3px`, nothing is painted (see the rule
  // in .claude/rules/styling.md). Since #382 the tile carries no surface of its
  // own, so it has nothing left to clip.
  //
  // It belongs on the ARTWORK, which really does need to cut a collage to its
  // rounded corners — four of the five cards put it exactly there. The playlist
  // tile had it in both places, and was the one card whose plate shadow was
  // visibly cut off on the right and bottom.
  it.each([...cards])("%s does not clip its own parts with .no-scroll", (_name, file) => {
    expect(
      rootClasses(SOURCES[file]),
      `${file} has .no-scroll on the tile root. overflow:hidden there clips the offset shadows of ` +
        `.card-art and .card-plate — put it on the artwork instead, which is what needs the clip.`
    ).not.toContain("no-scroll");
  });

  // ---------------------------------------------------------------------
  // The three parts of a tile. A card that keeps its picture or its text
  // outside `.card-art` / `.card-plate` still renders — it just renders
  // unframed and unraised against the memphis ground, which is exactly the
  // "looks different from its neighbours" bug the shared list exists for.
  // Type label, artwork and plate are checked separately so the failure says
  // which one is missing.
  // ---------------------------------------------------------------------
  it.each([...cards])("%s labels its type with the shared component", (_name, file) => {
    expect(SOURCES[file]).toMatch(/<CardTypeLabel\b/);
  });

  it.each([...cards])("%s frames its artwork with .card-art", (_name, file) => {
    expect(SOURCES[file].slice(0, SOURCES[file].indexOf("</template>"))).toMatch(/\bcard-art\b/);
  });

  it.each([...cards])("%s puts its text on a .card-plate", (_name, file) => {
    expect(SOURCES[file].slice(0, SOURCES[file].indexOf("</template>"))).toMatch(/\bcard-plate\b/);
  });

  // A tile that draws its own panel is back to the old anatomy — a white box
  // with the picture inside it, which is exactly the contrast the plates were
  // built to create. Surface, frame and offset shadow belong to `.card-art`
  // and `.card-plate` in the shared stylesheet, so a card component has no
  // business calling these mixins at all.
  it.each([...cards])("%s leaves surface and elevation to the shared parts", (_name, file) => {
    const style = SOURCES[file].slice(SOURCES[file].indexOf("<style"));
    expect(style).not.toMatch(/@include\s+candy-(box|raised)/);
  });
});
