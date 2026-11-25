import { describe, expect, it } from "vitest";
import { classesOf, scanTags, type Tag } from "./templateTags";

// ---------------------------------------------------------------------------
// On phones every detail head lays its body out as plate grid items
// (Global/detail-head.scss, `largePhones`): the body is `display: contents`,
// its text block goes beside the art cell and its action row becomes a strip
// under the whole plate. That only works while the body has exactly TWO
// children — text, then `.header-actions`. A third child would land in the
// same grid cell as the text and draw over it; an action row nested one level
// deeper (as the album's was, inside `.bottom`) would stay in the narrow text
// column, wrap onto two or three lines, and stretch the art cell into a sliver.
// ---------------------------------------------------------------------------

const SOURCES = import.meta.glob("/src/**/*.vue", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

const template = (source: string) => source.slice(source.indexOf("<template"), source.lastIndexOf("</template>"));

// HTML void elements have no closing tag, written with `/>` or not.
const VOID = new Set(["area", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/** The direct children of the first element carrying `cls`. */
function childrenOf(tags: Tag[], cls: string): Tag[] {
  const start = tags.findIndex((t) => t.kind === "open" && classesOf(t.attrs).includes(cls));
  if (start === -1) return [];
  const children: Tag[] = [];
  let depth = 0;
  for (const tag of tags.slice(start + 1)) {
    if (tag.kind === "close") {
      if (depth === 0) break;
      depth--;
      continue;
    }
    if (depth === 0) children.push(tag);
    if (tag.kind === "open" && !VOID.has(tag.name)) depth++;
  }
  return children;
}

/** The root element of the component a tag names, via the file's own import. */
function rootOfComponent(file: string, name: string): Tag | undefined {
  const spec = SOURCES[file].match(new RegExp(`import\\s+${name}\\s+from\\s+["']([^"']+)["']`))?.[1];
  if (!spec) return undefined;
  const dir = file.slice(0, file.lastIndexOf("/"));
  const path = spec.startsWith("@/") ? "/src/" + spec.slice(2) : new URL(spec, "file://" + dir + "/").pathname;
  const source = SOURCES[path];
  return source ? scanTags(template(source)).find((t) => t.name !== "template" && t.kind !== "close") : undefined;
}

const isActionRow = (file: string, tag: Tag): boolean => {
  if (classesOf(tag.attrs).includes("header-actions")) return true;
  const root = /^[A-Z]/.test(tag.name) ? rootOfComponent(file, tag.name) : undefined;
  return !!root && classesOf(root.attrs).includes("header-actions");
};

const bodies = Object.keys(SOURCES).filter((file) => /\bclass="[^"]*\bdh-body\b/.test(template(SOURCES[file])));

describe("every detail head body has two children: text, then the action row", () => {
  it("finds the four heads", () => {
    // Album, artist, playlist, smart playlist. A new head is welcome — it
    // just has to pass the checks below.
    expect(bodies.length).toBeGreaterThanOrEqual(4);
  });

  it.each(bodies)("%s", (file) => {
    const children = childrenOf(scanTags(template(SOURCES[file])), "dh-body");
    expect(children.map((c) => c.name), "direct children of .dh-body").toHaveLength(2);
    expect(isActionRow(file, children[0]), "the first child is the text, not the actions").toBe(false);
    expect(isActionRow(file, children[1]), "the last child is the .header-actions row").toBe(true);
  });
});
