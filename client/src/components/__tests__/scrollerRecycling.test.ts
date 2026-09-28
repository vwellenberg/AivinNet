import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// A virtual scroller recycles its row nodes: when a row leaves the viewport,
// its view is handed the next item and only its CONTENT changes. A `:key` on
// the slot content that changes with the item defeats that — Vue sees a new
// key, throws the node away and mounts a new one, on every recycle.
//
// Every list here inherited that idiom (`:key="index"`, the playlist later
// `:key="item.id"`), and a new node is not free: song rows and tiles play
// their arrival (`mem-step-in`) when a node enters the document. Measured over
// twelve wheel steps on a 394-track playlist: 76 fresh row nodes, each one
// replaying its entrance mid-scroll, where the keyless search/artist lists
// built 3. Reported as "the rows build themselves up while I scroll".
//
// Identity is the scroller's own job — `key-field` (default `id`) on the ITEMS.
// The slot content stays unkeyed. The census marker is the shared feature
// (a scroller block), not a file list, so the next list joins by existing.
// ---------------------------------------------------------------------------

const VUE_SOURCES = import.meta.glob("/src/**/*.vue", { as: "raw", eager: true }) as Record<
  string,
  string
>;

/** Comments name the very binding this census bans — strip them first. */
function stripComments(source: string): string {
  return source.replace(/<!--[\s\S]*?-->/g, "");
}

function scrollerBlocks(source: string): string[] {
  return [...source.matchAll(/<(DynamicScroller|RecycleScroller)\b[\s\S]*?<\/\1>/g)].map(m => m[0]);
}

describe("virtual scroller rows are recycled, not rebuilt", () => {
  it("finds the scrollers it audits", () => {
    // Ten lists render through a scroller today. A census that finds none
    // (a renamed component, a broken glob) must not read as a clean one.
    const blocks = Object.values(VUE_SOURCES).flatMap(s => scrollerBlocks(stripComments(s)));
    expect(blocks.length).toBeGreaterThanOrEqual(10);
  });

  it("keys nothing inside a scroller's slot", () => {
    const offenders: string[] = [];

    for (const [path, raw] of Object.entries(VUE_SOURCES)) {
      for (const block of scrollerBlocks(stripComments(raw))) {
        // `:key` / `v-bind:key` — but not `key-field`, which is the scroller's
        // own (and correct) way of naming identity.
        for (const m of block.matchAll(/(?:^|\s)(?::|v-bind:)key="([^"]*)"/g)) {
          offenders.push(`${path}: :key="${m[1]}"`);
        }
      }
    }

    expect(offenders, "a key on recycled slot content remounts the row on every recycle").toEqual([]);
  });

  it("keys the tiles of a recycled card row by position", () => {
    // One level down, the same mistake: CardRow IS the recycled row on /albums
    // and the search card pages, and it keyed its tiles by albumhash. A
    // recycled row gets other albums, so every tile was a new node playing the
    // staggered wave — 83 tile arrivals after the scrolling had stopped, over
    // twelve wheel steps, with the row keys already gone.
    const raw = VUE_SOURCES["/src/components/shared/CardRow.vue"];
    expect(raw, "CardRow.vue moved — the census lost the card rows").toBeTruthy();

    const loop = stripComments(raw).match(/v-for="\(\s*\w+\s*,\s*(\w+)\s*\)\s+in\s+\w+"\s+:key="(\w+)"/);
    expect(loop, "CardRow's tiles are no longer keyed by their position").toBeTruthy();
    expect(loop![2]).toBe(loop![1]);
  });
});
