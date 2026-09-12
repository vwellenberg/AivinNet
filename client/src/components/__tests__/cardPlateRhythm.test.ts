import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The name plate of a card tile has to be able to HOLD its caption lines, and
// the spacing between them has to come from one place.
//
// Both halves were broken at once and neither was visible in the DOM. The row
// geometry pinned the plate to a fixed `4.5rem`, with a comment claiming that
// fit its three possible lines (help text, name, meta) — it fit two. Measured
// in the running app at 1440px: the three-line stack is 65px against 51.6px of
// inner plate, so `overflow: hidden` cut the meta line of every tile in a row
// that HAS a help text ("Recently added", "Recently played") horizontally
// through the glyphs. Nothing reported it: a clipped line's rectangle still
// measures its full height, the clip happens at paint (see the rule about
// element rectangles in client/docs/verification.md).
//
// The spacing, meanwhile, was margins on the lines themselves, set per card
// type — `.rtcount`/`.p-count` carried `margin-top: $smaller`, the album name
// `margin-bottom: $smallest`, and `.rhelp` brings `margin: $smaller 0` from
// basic.scss. Five card types, three rhythms, and the `.rhelp` top margin added
// itself to the plate's own padding (11.2px above the first line against 7.2px
// below the last).
//
// This is a test rather than a comment because neither half fails loudly. A
// card that sets its own margin still renders; a plate that is one pixel too
// short still renders — it just renders without the bottom of its last line.
// ---------------------------------------------------------------------------
const ANATOMY_FILE = "src/assets/scss/Global/cards.scss";

// Components come through Vite, so the test sees the files the build sees. The
// stylesheet cannot (`{ as: "raw" }` on a `.scss` runs it through the CSS
// pipeline, which is stubbed out under test and hands back an empty string) —
// it is read off disk, guarded by `it("reads the anatomy")` below.
const SOURCES = import.meta.glob("/src/**/*.vue", { as: "raw", eager: true }) as Record<string, string>;

/** The stylesheet with its comments stripped, so prose cannot satisfy a check. */
function anatomy(): string {
  return readFileSync(ANATOMY_FILE, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

/**
 * The body of the first rule whose selector matches `pattern`, without the
 * bodies of its nested rules — so a declaration is attributed to the selector
 * that actually carries it.
 */
function ruleBody(source: string, pattern: RegExp): string | null {
  const match = pattern.exec(source);
  if (!match) return null;

  let depth = 0;
  let own = "";
  for (let i = source.indexOf("{", match.index); i < source.length; i++) {
    const c = source[i];
    if (c === "{") {
      depth++;
      if (depth === 1) continue;
    } else if (c === "}") {
      depth--;
      if (depth === 0) return own;
      continue;
    }
    if (depth === 1) own += c;
  }
  return null;
}

/** The classes of the caption lines a card component puts inside its plate. */
function captionClasses(source: string): string[] {
  const template = source.slice(source.indexOf("<template>"), source.indexOf("</template>"));
  // The plate opens with `class="card-plate"` or `class="overlay card-plate"`.
  // ⚠️ `search` lands on the ATTRIBUTE — the walk has to start at the tag's own
  // "<", or the plate's opening tag is never counted and every depth below it
  // is off by one. That bug made this check pass against the unfixed tree.
  const attr = template.search(/class="[^"]*\bcard-plate\b[^"]*"/);
  if (attr === -1) return [];

  const after = template.slice(template.lastIndexOf("<", attr));
  const classes = new Set<string>();
  let depth = 0;

  // Walk the plate's subtree and collect the classes one level below it. The
  // depth counter is why this is a walk and not a regex: a caption line that
  // wraps its text in a `<span>` (the help row) must not contribute the span.
  for (const tag of after.matchAll(/<(\/?)([\w.-]+)([^>]*)>/g)) {
    const [, slash, name, attrs] = tag;
    if (name === "template" && slash) break;
    if (slash) {
      depth--;
      if (depth <= 0) break;
      continue;
    }
    if (depth === 1) {
      const cls = attrs.match(/\bclass="([^"]*)"/);
      if (cls) cls[1].trim().split(/\s+/).forEach(c => classes.add(c));
    }
    if (!attrs.trimEnd().endsWith("/")) depth++;
  }

  return [...classes];
}

/** Every component that renders a `.card-plate`, mapped to its source. */
function plateComponents(): Map<string, string> {
  const found = new Map<string, string>();
  for (const [path, source] of Object.entries(SOURCES)) {
    if (/class="[^"]*\bcard-plate\b/.test(source)) found.set(path, source);
  }
  return found;
}

describe("card plate rhythm", () => {
  const scss = anatomy();
  const components = plateComponents();

  it("reads the anatomy", () => {
    // The guard. An unreadable or renamed stylesheet must fail here rather
    // than let every check below pass against an empty string.
    expect(scss).toContain(".card-plate");
    expect(scss).toContain(".cardscroller");
  });

  it("finds the components that render a plate", () => {
    // Five today (playlist, track, artist, album, folder). A parser that stops
    // matching would otherwise turn the per-component checks into no-ops.
    expect(components.size).toBeGreaterThanOrEqual(5);
  });

  // ⚠️ The height of the pinned plate is a FLOOR, never a fixed track. A fixed
  // one has to be re-derived by hand every time a line changes its type size,
  // and when it is wrong the plate eats its own text instead of saying so.
  // `minmax(…, max-content)` costs a row that is a pixel out of true in that
  // case — visible, and not at the cost of the text.
  it("pins the plate in a row as a floor, not as a fixed height", () => {
    const row = ruleBody(scss, /\.cardscroller\s*\{/);
    expect(row, `${ANATOMY_FILE} has no .cardscroller block`).toBeTruthy();

    const nested = (row as string) + scss.slice(scss.indexOf(".cardscroller"));
    const tracks = nested.match(/grid-template-rows:\s*([^;]+);/);
    expect(tracks, "the row geometry sets no grid-template-rows for the tiles").toBeTruthy();

    expect(
      (tracks as RegExpMatchArray)[1],
      "the plate track inside .cardscroller is a fixed length. A card whose caption lines " +
        "outgrow it loses the bottom of its last line to `overflow: hidden` — silently, because " +
        "the clipped line still measures its full height. Use minmax(<floor>, max-content)."
    ).toMatch(/minmax\(/);
  });

  // The single source for the spacing between caption lines, and the reason
  // the centring can work at all: a line with vertical margins of its own
  // would push the stack off centre again.
  it("gives the plate one rhythm and centres it", () => {
    const plate = ruleBody(scss, /^\.card-plate\s*\{/m);
    expect(plate, `${ANATOMY_FILE} has no .card-plate block`).toBeTruthy();

    expect(plate, "the plate does not lay its lines out as a column").toMatch(/flex-direction:\s*column/);
    expect(plate, "the plate has no `gap` — the lines' spacing has no single source").toMatch(/\bgap:/);
    expect(
      plate,
      "the plate does not centre its lines. A pinned plate always has slack on the cards with " +
        "fewer lines, and in block flow all of it lands at the bottom edge."
    ).toMatch(/justify-content:\s*center/);
  });

  it.each([...components])("%s leaves the vertical rhythm to the plate", (path, source) => {
    const offenders = captionClasses(source)
      .map(cls => [cls, ruleBody(source.slice(source.indexOf("<style")), new RegExp(`\\.${cls}\\s*\\{`))] as const)
      .filter(([, body]) => body && /margin-top:|margin-bottom:|margin:\s*[^;]*\s[^;]*;/.test(body))
      .map(([cls]) => cls);

    expect(
      offenders,
      `${path} sets a vertical margin on ${offenders.join(", ")}. The spacing between caption ` +
        `lines is the plate's \`gap\` (${ANATOMY_FILE}) — a margin here is a second rhythm for ` +
        `this one card type, and it pushes the centred stack off centre.`
    ).toEqual([]);
  });
});
