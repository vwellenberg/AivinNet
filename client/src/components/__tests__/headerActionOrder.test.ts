import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The detail headers present their actions in ONE order — see the
// `.header-actions` block in src/assets/scss/Global/_button-classes.scss.
//
// This is a test rather than a comment because prose did not hold the line
// twice over: the mix header shipped with its own row anatomy and was missed by
// two rounds of header work (#243, #244), and the CLAUDE.md sent readers to a
// mixin that had been deleted, so following the documentation produced NEW
// drift. This fails the build the moment a button is appended to the wrong end
// of a row, or a fifth header row appears that nobody knows about.
// ---------------------------------------------------------------------------
const CANONICAL = ["play", "favourite", "pin", "secondary", "overflow"] as const;
type Slot = (typeof CANONICAL)[number];

// Read through Vite rather than `fs`, so the test sees exactly the files the
// build sees and needs no path arithmetic of its own.
const SOURCES = import.meta.glob("/src/**/*.vue", { as: "raw", eager: true }) as Record<string, string>;

const HEADERS = [
  "/src/components/AlbumView/Header/Buttons.vue",
  "/src/components/ArtistView/HeaderComponents/Buttons.vue",
  "/src/components/PlaylistView/Header/Info.vue",
];

interface Tag {
  name: string;
  attrs: string;
  kind: "open" | "close" | "self";
}

/**
 * Minimal tag scanner. A real template parse would mean depending on
 * @vue/compiler-sfc, which this project does not declare, and all that is
 * needed here is the sequence of element boundaries. Quoted attribute values
 * are skipped so a `>` inside a binding cannot end a tag early.
 */
function scanTags(source: string): Tag[] {
  const tags: Tag[] = [];
  let i = 0;

  while (i < source.length) {
    const lt = source.indexOf("<", i);
    if (lt === -1) break;

    if (source.startsWith("<!--", lt)) {
      const end = source.indexOf("-->", lt);
      i = end === -1 ? source.length : end + 3;
      continue;
    }

    let j = lt + 1;
    let quote = "";
    while (j < source.length) {
      const c = source[j];
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === ">") {
        break;
      }
      j++;
    }

    const raw = source.slice(lt + 1, j);
    const closing = raw.startsWith("/");
    const self = raw.endsWith("/");
    const body = raw.replace(/^\//, "").replace(/\/$/, "");
    const name = (body.match(/^[\w.-]+/) || [""])[0];

    if (name) {
      tags.push({
        name,
        attrs: body.slice(name.length),
        kind: closing ? "close" : self ? "self" : "open",
      });
    }

    i = j + 1;
  }

  return tags;
}

function classesOf(attrs: string): string[] {
  const match = attrs.match(/\bclass="([^"]*)"/);
  return match ? match[1].trim().split(/\s+/) : [];
}

/**
 * Which slot of the canonical row an element occupies. An unrecognised element
 * throws instead of falling through to "secondary": a new kind of header
 * control should be a deliberate decision about where it belongs.
 */
function slotOf(tag: Tag): Slot {
  const byComponent: Record<string, Slot> = {
    PlayBtnRect: "play",
    HeartSvg: "favourite",
    PinButton: "pin",
  };
  if (byComponent[tag.name]) return byComponent[tag.name];

  if (tag.name !== "button") {
    throw new Error(`unknown header action <${tag.name}> — decide its slot in headerActionOrder.test.ts first`);
  }

  const classes = classesOf(tag.attrs);
  if (classes.includes("options")) return "overflow";
  // A "save" button means the same thing as a favourite on a collection page —
  // bookmark glyph, never a heart. No header uses it right now (the mix header
  // was the last one); kept so the next one does not have to rediscover it.
  if (classes.includes("savebtn")) return "favourite";
  return "secondary";
}

/** The direct children of the `.header-actions` row, in document order. */
function actionRowSlots(source: string): Slot[] {
  const tags = scanTags(source);
  const start = tags.findIndex(t => t.kind !== "close" && classesOf(t.attrs).includes("header-actions"));
  if (start === -1) return [];

  const slots: Slot[] = [];
  let depth = 1;

  for (let i = start + 1; i < tags.length; i++) {
    const tag = tags[i];
    if (tag.kind === "close") {
      depth--;
      if (depth === 0) break;
      continue;
    }
    if (depth === 1) slots.push(slotOf(tag));
    if (tag.kind === "open") depth++;
  }

  return slots;
}

describe("detail header action rows", () => {
  it.each(HEADERS)("%s presents its actions in the canonical order", file => {
    const slots = actionRowSlots(SOURCES[file]);

    expect(slots.length).toBeGreaterThan(0);
    expect(slots).toContain("play");

    // Strictly increasing, which rejects a wrong order and a slot used twice
    // alike — two overflow buttons in one row is not a thing.
    const positions = slots.map(slot => CANONICAL.indexOf(slot));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(new Set(positions).size).toBe(positions.length);
  });

  // A mix header once existed through two rounds of header work without anyone
  // noticing it was a fourth detail header. If a fourth appears again, this
  // fails until it is listed above and therefore checked.
  it("knows about every header action row in the codebase", () => {
    const found = Object.entries(SOURCES)
      .filter(([, source]) => /\bclass="[^"]*\bheader-actions\b/.test(source))
      .map(([file]) => file)
      .sort();

    expect(found).toEqual([...HEADERS].sort());
  });

  // A row only holds the line if every action is IN it. The playlist header's
  // Edit and Delete sat in `.last-updated` instead — an absolutely positioned
  // box in the header's bottom-right corner. On a phone the status text hides,
  // so the two buttons came to rest right beside the action row without being
  // part of it: measured 4px higher than their neighbours and 30px away where
  // the row's own gap is 8px. That box is a status line; actions belong in the
  // row above, which is where the canonical order is checked.
  it("keeps the playlist header's actions in its row, not in the corner box", () => {
    expect(SOURCES["/src/components/PlaylistView/Header/LastUpdated.vue"]).not.toMatch(/<button/);
  });
});
