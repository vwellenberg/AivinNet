import { describe, expect, it } from "vitest";

import { clampTravel, landingGap, landingIndex, makeRoomShift } from "../dragReorder";
import { resolveMove } from "../playlistMove";

// ---------------------------------------------------------------------------
// The finger-drag arithmetic of the playlist edit mode. The last block runs
// the result through the real `resolveMove()` and a model of the store's
// splice, so the two conventions (landing slot on screen, drop gap in the
// store) are proven to agree rather than assumed to.
// ---------------------------------------------------------------------------

const H = 72;

describe("where the dragged row lands", () => {
  it("stays put until it has covered half a row", () => {
    expect(landingIndex(3, 35, H, 10)).toBe(3);
    expect(landingIndex(3, 37, H, 10)).toBe(4);
    expect(landingIndex(3, -37, H, 10)).toBe(2);
  });

  it("counts whole rows of travel", () => {
    expect(landingIndex(0, 3 * H, H, 10)).toBe(3);
    expect(landingIndex(9, -9 * H, H, 10)).toBe(0);
  });

  it("never leaves the list, however far the finger goes", () => {
    expect(landingIndex(2, 100 * H, H, 5)).toBe(4);
    expect(landingIndex(2, -100 * H, H, 5)).toBe(0);
    expect(clampTravel(2, 100 * H, H, 5)).toBe(2 * H);
    expect(clampTravel(2, -100 * H, H, 5)).toBe(-2 * H);
  });

  it("does nothing without a layout (a zero row height, as in jsdom)", () => {
    expect(landingIndex(2, 500, 0, 5)).toBe(2);
    expect(clampTravel(2, 500, 0, 5)).toBe(0);
  });
});

describe("the rows making room", () => {
  it("steps the rows between up when the row moves down", () => {
    const shifts = [0, 1, 2, 3, 4, 5].map(i => makeRoomShift(i, 1, 4, H));
    expect(shifts).toEqual([0, 0, -H, -H, -H, 0]);
  });

  it("steps the rows between down when the row moves up", () => {
    const shifts = [0, 1, 2, 3, 4, 5].map(i => makeRoomShift(i, 4, 1, H));
    expect(shifts).toEqual([0, H, H, H, 0, 0]);
  });

  it("leaves everything alone while the row hovers over its own slot", () => {
    expect([0, 1, 2].map(i => makeRoomShift(i, 1, 1, H))).toEqual([0, 0, 0]);
  });
});

// A model of the playlist store's moveTrack (stores/pages/playlist.ts).
function storeMove<T>(list: T[], from: number, gap: number): T[] {
  const out = [...list];
  const [item] = out.splice(from, 1);
  out.splice(gap > from ? gap - 1 : gap, 0, item);
  return out;
}

// Rows as objects, the way the store holds them — two of them the SAME track.
const row = (hash: string) => ({ trackhash: hash, title: hash });

describe("a move on screen, in the store's terms", () => {
  it("lands the row exactly where it was dropped, down and up", () => {
    const all = ["a", "b", "c", "d", "e"].map(row);

    for (const [from, to] of [
      [0, 3],
      [3, 0],
      [1, 4],
      [4, 1],
      [2, 3],
    ]) {
      const target = landingGap(all, all, from, to);
      expect(target).not.toBeNull();
      const after = storeMove(all, target!.from, target!.gap);

      // What the screen showed at the drop is what the store now holds.
      const onScreen = [...all];
      const [moved] = onScreen.splice(from, 1);
      onScreen.splice(to, 0, moved);
      expect(after.map(t => t.trackhash)).toEqual(onScreen.map(t => t.trackhash));
    }
  });

  it("agrees with resolveMove on the anchor the server gets", () => {
    const all = ["a", "b", "c", "d", "e"].map(row);
    const down = landingGap(all, all, 0, 3)!;
    expect(resolveMove(all as never, down.from, down.gap)).toMatchObject({ trackhash: "a", beforeTrackhash: "e" });

    const toEnd = landingGap(all, all, 1, 4)!;
    expect(resolveMove(all as never, toEnd.from, toEnd.gap)).toMatchObject({ trackhash: "b", beforeTrackhash: null });

    const up = landingGap(all, all, 4, 0)!;
    expect(resolveMove(all as never, up.from, up.gap)).toMatchObject({ trackhash: "e", beforeTrackhash: "a" });
  });

  it("maps around a row that is hidden on screen (a removal waiting for its undo)", () => {
    const all = ["a", "b", "c", "d", "e"].map(row);
    const visible = all.filter(t => t.trackhash !== "c"); // a b d e

    // On screen: move "e" (index 3) to the top.
    const target = landingGap(all, visible, 3, 0)!;
    expect(target).toEqual({ from: 4, gap: 0 });

    // On screen: move "a" below "d" (visible index 2) — it lands in front of
    // "e", i.e. after the hidden "c", which keeps its place.
    const down = landingGap(all, visible, 0, 2)!;
    expect(storeMove(all, down.from, down.gap).map(t => t.trackhash)).toEqual(["b", "c", "d", "a", "e"]);
  });

  it("tells a duplicate track from its twin by the row, not by the hash", () => {
    const first = row("x");
    const twin = row("x");
    const all = [first, row("b"), twin, row("d")];

    // Move the SECOND "x" to the top.
    const target = landingGap(all, all, 2, 0)!;
    expect(target.from).toBe(2);
    const after = storeMove(all, target.from, target.gap);
    expect(after[0]).toBe(twin);
    expect(after[1]).toBe(first);
  });

  it("refuses a move that is not one", () => {
    const all = ["a", "b"].map(row);
    expect(landingGap(all, all, 1, 1)).toBeNull();
    expect(landingGap(all, all, 0, 5)).toBeNull();
    expect(landingGap(all, all, -1, 0)).toBeNull();
  });
});
