import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import PlayingMeter from "../PlayingMeter.vue";

// ---------------------------------------------------------------------------
// The meter (#357) paints itself with an SVG <mask> and one <clipPath> per bar,
// and both are addressed by id. Two of these render at once — the track row and
// the player bar — so a shared id is not cosmetic: an `url(#…)` reference
// resolves to the FIRST match in the document, and the second meter would then
// be clipped by the first one's bars. It would still animate, just wrongly, and
// only on screens showing both. The counter that prevents this has to live in
// module scope; declared inside <script setup> it re-runs per instance and
// hands every meter the same number. That is the mistake this file catches.
// ---------------------------------------------------------------------------

const idsOf = (html: string) => (html.match(/id="([^"]+)"/g) ?? []).map(m => m.slice(4, -1));

describe("PlayingMeter", () => {
  it("gives every instance its own mask and clip ids", () => {
    const a = idsOf(mount(PlayingMeter).html());
    const b = idsOf(mount(PlayingMeter).html());

    // one mask + one clip per bar
    expect(a).toHaveLength(5);
    expect(b).toHaveLength(5);
    expect(new Set([...a, ...b]).size).toBe(a.length + b.length);
  });

  it("points every clip-path and mask reference at an id it actually owns", () => {
    const wrapper = mount(PlayingMeter);
    const html = wrapper.html();
    const owned = new Set(idsOf(html));
    const refs = (html.match(/url\(#([^)]+)\)/g) ?? []).map(m => m.slice(5, -1));

    expect(refs.length).toBe(5);
    refs.forEach(ref => expect(owned.has(ref)).toBe(true));
  });

  it("draws four bars of four segments, with only the top one as the peak", () => {
    const wrapper = mount(PlayingMeter);

    expect(wrapper.findAll("clipPath rect.bar")).toHaveLength(4);
    expect(wrapper.findAll("rect.seg")).toHaveLength(12);
    expect(wrapper.findAll("rect.peak")).toHaveLength(4);

    // The peak is the topmost segment of each bar: y = 3, the ink ceiling of
    // the 24x24 chrome raster.
    wrapper.findAll("rect.peak").forEach(peak => expect(peak.attributes("y")).toBe("3"));
  });

  it("freezes instead of disappearing when paused", () => {
    const playing = mount(PlayingMeter, { props: { playing: true } });
    const paused = mount(PlayingMeter, { props: { playing: false } });

    expect(playing.classes()).not.toContain("paused");
    expect(paused.classes()).toContain("paused");
    // Hiding it would reflow the row it sits in, so the bars must stay.
    expect(paused.findAll("clipPath rect.bar")).toHaveLength(4);
  });

  it("labels its state for assistive tech", () => {
    expect(mount(PlayingMeter, { props: { playing: true } }).attributes("aria-label")).toBe("Now playing");
    expect(mount(PlayingMeter, { props: { playing: false } }).attributes("aria-label")).toBe("Paused");
  });

  it("goes silent where it only repeats what the chrome already says", () => {
    // The player bar carries a second meter next to the track title and the
    // transport buttons. Announcing "Now playing" twice on one screen is noise,
    // so that copy asks to be skipped — and must not keep a contradictory
    // role/label alongside aria-hidden.
    const decorative = mount(PlayingMeter, { props: { decorative: true } });

    expect(decorative.attributes("aria-hidden")).toBe("true");
    expect(decorative.attributes("aria-label")).toBeUndefined();
    expect(decorative.attributes("role")).toBeUndefined();

    const labelled = mount(PlayingMeter);
    expect(labelled.attributes("aria-hidden")).toBeUndefined();
    expect(labelled.attributes("role")).toBe("img");
  });
});
