import { readFileSync } from "node:fs";

import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, withDirectives } from "vue";

import vContextMenu, { LONG_PRESS_MS, MOVE_TOLERANCE_PX } from "../vContextMenu";

// ---------------------------------------------------------------------------
// iOS Safari fires no `contextmenu` for a touch, and the tiles have no ⋮
// button — so on an iPhone no tile menu could be opened at all. The directive
// adds a long-press next to the right-click. These pin the gesture: it opens
// the menu once, at the finger, without letting the lifted finger follow the
// tile's link, and a plain tap or a scroll still behave like one.
// ---------------------------------------------------------------------------

type Point = { x: number; y: number };

function touch(el: Element, type: string, points: Point[] = []): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  const list = points.map(p => ({ clientX: p.x, clientY: p.y }));
  Object.defineProperty(ev, "touches", { value: list });
  el.dispatchEvent(ev);
  return ev;
}

function click(el: Element): MouseEvent {
  const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  return ev;
}

function setup() {
  const onMenu = vi.fn((e: MouseEvent) => ({ x: e.clientX, y: e.clientY, target: e.currentTarget }));
  const onLink = vi.fn();

  // A tile in miniature: the link is the root, the artwork a child the finger lands on.
  const Tile = defineComponent({
    setup: () => () =>
      withDirectives(h("a", { href: "#/album/x", class: "tile", onClick: onLink }, [h("img", { class: "art" })]), [
        [vContextMenu, onMenu],
      ]),
  });

  const wrapper = mount(Tile, { attachTo: document.body });
  const tile = wrapper.element as HTMLElement;
  const art = tile.querySelector(".art") as HTMLElement;
  return { wrapper, tile, art, onMenu, onLink };
}

describe("v-context-menu", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("opens the menu on a long-press, once, at the finger", () => {
    const { tile, art, onMenu } = setup();

    touch(art, "touchstart", [{ x: 120, y: 340 }]);
    vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    expect(onMenu).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onMenu).toHaveBeenCalledTimes(1);
    // Real coordinates, so the store anchors at the finger and not at the
    // tile's corner (its x===0 && y===0 fallback).
    expect(onMenu.mock.results[0].value).toEqual({ x: 120, y: 340, target: tile });

    vi.advanceTimersByTime(LONG_PRESS_MS * 4);
    expect(onMenu).toHaveBeenCalledTimes(1);
  });

  it("keeps the lifted finger from following the link", () => {
    const { art, onMenu, onLink } = setup();

    touch(art, "touchstart", [{ x: 10, y: 10 }]);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    const end = touch(art, "touchend");
    // Cancelling touchend is what stops the browser synthesising the click.
    expect(end.defaultPrevented).toBe(true);

    // …and a browser that sends it anyway gets it eaten before RouterLink.
    const ev = click(art);
    expect(ev.defaultPrevented).toBe(true);
    expect(onLink).not.toHaveBeenCalled();
    expect(onMenu).toHaveBeenCalledTimes(1);
  });

  it("does not eat a later, real click", () => {
    const { tile, art, onLink } = setup();

    touch(art, "touchstart", [{ x: 10, y: 10 }]);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    touch(art, "touchend");

    // No synthesised click came (the cancelled touchend worked). Pick the
    // tile a second later — by mouse, or Enter on the focused link.
    vi.advanceTimersByTime(1000);
    const ev = click(tile);
    expect(ev.defaultPrevented).toBe(false);
    expect(onLink).toHaveBeenCalledTimes(1);
  });

  it("leaves a plain tap alone", () => {
    const { art, onMenu, onLink } = setup();

    touch(art, "touchstart", [{ x: 10, y: 10 }]);
    vi.advanceTimersByTime(150);
    const end = touch(art, "touchend");
    const ev = click(art);

    expect(end.defaultPrevented).toBe(false);
    expect(ev.defaultPrevented).toBe(false);
    expect(onLink).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    expect(onMenu).not.toHaveBeenCalled();
  });

  it("gives way to a finger that moves", () => {
    const { art, onMenu } = setup();

    touch(art, "touchstart", [{ x: 100, y: 100 }]);
    // A tremble inside the tolerance does not count as a move.
    touch(art, "touchmove", [{ x: 103, y: 104 }]);
    touch(art, "touchmove", [{ x: 100, y: 100 + MOVE_TOLERANCE_PX + 1 }]);
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);

    expect(onMenu).not.toHaveBeenCalled();
  });

  it("gives way to a scroll", () => {
    const { art, onMenu } = setup();
    const row = document.createElement("div");
    document.body.appendChild(row);

    touch(art, "touchstart", [{ x: 100, y: 100 }]);
    // A card row scrolling sideways — `scroll` does not bubble.
    row.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);

    expect(onMenu).not.toHaveBeenCalled();
  });

  it("gives way to a second finger and to touchcancel", () => {
    const { art, onMenu } = setup();

    touch(art, "touchstart", [{ x: 10, y: 10 }]);
    touch(art, "touchstart", [
      { x: 10, y: 10 },
      { x: 90, y: 90 },
    ]);
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);

    touch(art, "touchstart", [{ x: 10, y: 10 }]);
    touch(art, "touchcancel");
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);

    expect(onMenu).not.toHaveBeenCalled();
  });

  // Android fires `contextmenu` for a long-press itself. The menu store
  // toggles, so a second call would close the menu the first one opened.
  it("opens once when Android's own contextmenu comes after the timer", () => {
    const { art, onMenu } = setup();

    touch(art, "touchstart", [{ x: 10, y: 10 }]);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    const native = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
    art.dispatchEvent(native);
    touch(art, "touchend");

    expect(native.defaultPrevented).toBe(true);
    expect(onMenu).toHaveBeenCalledTimes(1);
  });

  it("opens once when Android's own contextmenu comes before the timer", () => {
    const { art, onMenu, onLink } = setup();

    touch(art, "touchstart", [{ x: 10, y: 10 }]);
    vi.advanceTimersByTime(LONG_PRESS_MS - 100);
    art.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    const end = touch(art, "touchend");
    click(art);

    expect(onMenu).toHaveBeenCalledTimes(1);
    expect(end.defaultPrevented).toBe(true);
    expect(onLink).not.toHaveBeenCalled();
  });

  it("still opens on a right-click, every time", () => {
    const { art, onMenu } = setup();

    for (let i = 0; i < 2; i += 1) {
      const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 700, clientY: 300 });
      art.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
    }
    expect(onMenu).toHaveBeenCalledTimes(2);
  });

  it("marks the element for the stylesheet that mutes the platform's long-press", () => {
    const { wrapper, tile } = setup();
    expect(tile.hasAttribute("data-context-menu")).toBe(true);

    // Read off disk: a `.scss` through import.meta.glob comes back empty under
    // test (.claude/rules/testing.md). Comments go first, so the rule cannot
    // pass by being mentioned in prose.
    const scss = readFileSync("src/assets/scss/Global/basic.scss", "utf8").replace(/\/\/[^\n]*/g, "");
    expect(scss).toContain("[data-context-menu]");
    const rule = scss.slice(scss.indexOf("[data-context-menu]"));
    expect(rule).toMatch(/-webkit-touch-callout:\s*none/);
    expect(rule).toMatch(/any-pointer:\s*coarse[\s\S]*user-select:\s*none/);

    wrapper.unmount();
    expect(tile.hasAttribute("data-context-menu")).toBe(false);
  });

  // The menu is open; then the gesture is cancelled while the finger is still
  // down — the menu taking focus scrolls, or the finger slides towards it. The
  // lifted finger's click must still be eaten.
  it("still eats the click when the open gesture is cancelled before release", () => {
    const { art, onMenu, onLink } = setup();
    const row = document.createElement("div");
    document.body.appendChild(row);

    touch(art, "touchstart", [{ x: 10, y: 10 }]);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    row.dispatchEvent(new Event("scroll"));
    touch(art, "touchmove", [{ x: 10, y: 60 }]);
    const end = touch(art, "touchend");
    const ev = click(art);

    expect(onMenu).toHaveBeenCalledTimes(1);
    expect(end.defaultPrevented).toBe(true);
    expect(ev.defaultPrevented).toBe(true);
    expect(onLink).not.toHaveBeenCalled();
  });

  it("opens once when the browser's contextmenu comes after release (Windows touch)", () => {
    const { art, onMenu } = setup();

    touch(art, "touchstart", [{ x: 10, y: 10 }]);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    touch(art, "touchend");
    click(art);
    vi.advanceTimersByTime(50);
    const late = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
    art.dispatchEvent(late);

    expect(late.defaultPrevented).toBe(true);
    expect(onMenu).toHaveBeenCalledTimes(1);

    // …but a real right-click a moment later is a new request.
    vi.advanceTimersByTime(1000);
    art.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    expect(onMenu).toHaveBeenCalledTimes(2);
  });

  it("stops listening when the tile goes away", () => {
    const { wrapper, tile, onMenu } = setup();

    touch(tile, "touchstart", [{ x: 10, y: 10 }]);
    wrapper.unmount();
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    tile.dispatchEvent(new MouseEvent("contextmenu", { cancelable: true }));

    expect(onMenu).not.toHaveBeenCalled();
  });
});
