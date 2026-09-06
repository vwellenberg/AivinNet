import { readFileSync } from "node:fs";

import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import BrowseArtists from "@/components/SearchView/BrowseArtists.vue";
import useBrowseStore, { LETTERS } from "@/stores/searchBrowse";

import { blocks, ownDeclarations, styleBlock } from "./scssBlocks";

vi.mock("@/requests/useAxios", () => ({ default: vi.fn() }));

const artist = (name: string) => ({ name, artisthash: name, image: `${name}.webp` });

/**
 * Mounting calls `fetchArtists` — with `useAxios` mocked to nothing that would
 * fail and flip the store into its error state, which is a different branch of
 * the template. The state under test is set here directly.
 */
function mountBand(names: string[], letter = "A") {
  const store = useBrowseStore();
  vi.spyOn(store, "fetchArtists").mockResolvedValue(undefined);
  store.artists = names.map(artist) as never;
  store.letter = letter;
  // The row itself is CardScroller's business and pulls the router with it;
  // this test is about the band.
  return mount(BrowseArtists, { global: { stubs: { CardScroller: true } } });
}

describe("the letter band", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("renders one key per letter, plus the catch-all", () => {
    const keys = mountBand(["Air", "Bite"]).findAll(".band-key");
    expect(keys).toHaveLength(LETTERS.length);
    expect(keys[0].text()).toContain("#");
  });

  it("states the count on the keys that have one", () => {
    const keys = mountBand(["Air", "Alt-J", "Bite"]).findAll(".band-key");
    const a = keys[LETTERS.indexOf("A")];

    expect(a.find(".n").text()).toBe("2");
    expect(a.attributes("title")).toBe("2 artists under A");
    expect(keys[LETTERS.indexOf("B")].attributes("title")).toBe("1 artist under B");
  });

  // A key that vanishes when its letter is empty moves every other key, which
  // is the one thing a band people aim at must not do.
  it("keeps an empty letter visible, announced and still reachable", () => {
    const w = mountBand(["Air"]);
    const store = useBrowseStore();
    const z = w.findAll(".band-key")[LETTERS.indexOf("Z")];

    expect(z.classes()).toContain("off");
    expect(z.find(".n").exists()).toBe(false);
    expect(z.attributes("aria-disabled")).toBe("true");
    expect(z.attributes("title")).toBe("No artists under Z");
    // NOT the `disabled` attribute: a disabled control is not hit-tested, so
    // its title never appears, and it drops out of the tab order — a third of
    // this band would be unreachable by keyboard for the sake of a press that
    // the store already refuses.
    expect(z.attributes("disabled")).toBeUndefined();

    z.trigger("click");
    expect(store.letter).toBe("A");
  });

  it("announces which key is pressed", async () => {
    const w = mountBand(["Air", "Bite"], "A");
    const keys = w.findAll(".band-key");
    const a = keys[LETTERS.indexOf("A")];
    const b = keys[LETTERS.indexOf("B")];

    expect(a.attributes("aria-pressed")).toBe("true");
    expect(a.classes()).toContain("on");
    expect(b.attributes("aria-pressed")).toBe("false");

    await b.trigger("click");
    expect(b.attributes("aria-pressed")).toBe("true");
    expect(a.attributes("aria-pressed")).toBe("false");
  });

  it("renders nothing at all while the library has not arrived", () => {
    const w = mountBand([]);
    expect(w.find(".browse-artists").exists()).toBe(false);
    expect(w.find(".browse-notice").exists()).toBe(false);
  });

  it("says it is loading, rather than sitting blank", () => {
    const store = useBrowseStore();
    vi.spyOn(store, "fetchArtists").mockResolvedValue(undefined);
    store.loading = true;

    const w = mount(BrowseArtists, { global: { stubs: { CardScroller: true } } });
    expect(w.find(".browse-notice").text()).toContain("Loading");
  });

  // The store knew it had failed and nobody read it, so the block was simply
  // absent — with nothing on screen to try again with.
  it("says so and offers a retry when the load failed", async () => {
    const store = useBrowseStore();
    const fetch = vi.spyOn(store, "fetchArtists").mockResolvedValue(undefined);
    store.failed = true;

    const w = mount(BrowseArtists, { global: { stubs: { CardScroller: true } } });
    expect(w.find(".browse-notice").exists()).toBe(true);
    expect(w.find(".browse-artists").exists()).toBe(false);

    fetch.mockClear(); // the mount's own call
    await w.find(".retry").trigger("click");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  // A refresh that fails after the store's TTL still has the whole list in
  // hand; replacing a working band with an error is the worse answer.
  it("keeps the band when a refresh fails but the artists are still there", () => {
    const store = useBrowseStore();
    vi.spyOn(store, "fetchArtists").mockResolvedValue(undefined);
    store.artists = [artist("Air")] as never;
    store.letter = "A";
    store.failed = true;

    const w = mount(BrowseArtists, { global: { stubs: { CardScroller: true } } });
    expect(w.find(".browse-artists").exists()).toBe(true);
    expect(w.find(".browse-notice").exists()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The two rules that are invisible in a mounted component: the touch target and
// the plate under the band. Both are the kind that is correct on the day it is
// written and quietly lost later.
// ---------------------------------------------------------------------------
describe("the band's geometry", () => {
  const STYLE = styleBlock(readFileSync("src/components/SearchView/BrowseArtists.vue", "utf-8"));

  it("takes the pill role for its keys", () => {
    const key = ownDeclarations(blocks(STYLE, ".band-key")[0] ?? "");
    expect(key, "no .band-key block to read").toContain("min-width");
    expect(key).toMatch(/@include btn-pill/);
  });

  it("grows the key to the 44px floor on touch, gated on POINTER not width", () => {
    expect(
      STYLE,
      "the touch branch is gated on a width breakpoint — a narrow desktop window is " +
        "not a touch device, and a touch tablet is not narrow (styling.md)"
    ).toMatch(/@media\s*\(hover:\s*none\)/);

    const touch = /@media\s*\(hover:\s*none\)\s*\{([\s\S]*?)\n {2}\}/.exec(STYLE)?.[1] ?? "";
    expect(touch, "nothing inside the touch branch").toContain("band-key");
    expect(touch).toMatch(/height:\s*2\.75rem/);
    expect(touch).toMatch(/min-width:\s*2\.75rem/);
  });

  it("puts the band on a veil plate, because bare controls on the ground do not read", () => {
    const plate = ownDeclarations(blocks(STYLE, ".band-plate")[0] ?? "");
    expect(plate, "no .band-plate block to read").toContain("border-radius");
    expect(plate).toContain("var(--mem-veil)");
    expect(plate).toMatch(/border:\s*\$candy-border/);
  });
});
