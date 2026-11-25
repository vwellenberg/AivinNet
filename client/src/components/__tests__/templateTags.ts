// Shared template scanning for the source-reading tests (`headerActionOrder`,
// `detailHeadBody`).
//
// Not a test file — vitest collects `*.test.ts`, so this is only ever imported.
// Same warning as scssBlocks.ts: a broken parser goes quietly green, so every
// caller guards its own inputs.

export interface Tag {
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
export function scanTags(source: string): Tag[] {
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

export function classesOf(attrs: string): string[] {
  const match = attrs.match(/\bclass="([^"]*)"/);
  return match ? match[1].trim().split(/\s+/) : [];
}
