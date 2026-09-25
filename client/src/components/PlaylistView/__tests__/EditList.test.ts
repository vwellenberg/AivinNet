import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import EditList from "@/components/PlaylistView/EditList.vue";
import AfterHeader from "@/components/PlaylistView/AfterHeader.vue";
import { movePlaylistTrack, removeTracks } from "@/requests/playlists";
import usePlaylistStore from "@/stores/pages/playlist";
import { useToast } from "@/stores/notification";

// ---------------------------------------------------------------------------
// The playlist edit mode: grips to reorder, buttons to remove, built for the
// finger (a long press on a song row opens its menu, so the mouse drag never
// reached a phone). Pinned here: a drag or an arrow key moves exactly one row
// and sends anchors; a removal waits for its undo and only then reaches the
// server; leaving the mode settles what is still waiting.
// ---------------------------------------------------------------------------

vi.mock("@/requests/playlists", () => ({
  movePlaylistTrack: vi.fn(),
  removeTracks: vi.fn(),
  getPlaylist: vi.fn(),
  removeBannerImage: vi.fn(),
}));

const move = vi.mocked(movePlaylistTrack);
const remove = vi.mocked(removeTracks);

function track(hash: string) {
  return {
    trackhash: hash,
    title: `Title ${hash}`,
    album: "Album",
    albumhash: "al1",
    artists: [{ name: "Artist", artisthash: "ar1" }],
    albumartists: [{ name: "Artist", artisthash: "ar1" }],
    image: `al1.webp?pathhash=${hash}`,
    duration: 200,
    filepath: `/music/${hash}.flac`,
  } as never;
}

function setup(hashes = ["a", "b", "c", "d"]) {
  const playlist = usePlaylistStore();
  playlist.info = { id: 7, name: "Mix", count: hashes.length, duration: 800 } as never;
  playlist.allTracks = hashes.map(track);
  playlist.allLoaded = true;
  playlist.loadedHashCount = hashes.length;

  // The component looks its scroller up by id, like the page it lives in.
  const scroller = document.createElement("div");
  scroller.id = "contentscroller";
  document.body.appendChild(scroller);

  const wrapper = mount(EditList, { attachTo: scroller });
  return { playlist, wrapper };
}

const shown = (wrapper: ReturnType<typeof mount>) => wrapper.findAll(".edit-title").map(n => n.text());
const order = () => usePlaylistStore().allTracks.map(t => t.trackhash);

function pointer(type: string, clientY: number, target: EventTarget = window) {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientY });
  Object.defineProperty(ev, "pointerId", { value: 1 });
  Object.defineProperty(ev, "pointerType", { value: "touch" });
  target.dispatchEvent(ev);
  return ev;
}

describe("the edit list", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    move.mockResolvedValue(true);
    remove.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("shows every track with a remove button and a grip", () => {
    const { wrapper } = setup();
    expect(shown(wrapper)).toEqual(["Title a", "Title b", "Title c", "Title d"]);
    expect(wrapper.findAll("button.edit-remove")).toHaveLength(4);
    expect(wrapper.findAll("button.edit-grip")).toHaveLength(4);
  });

  it("moves a row by dragging its grip, and sends the anchor", async () => {
    const { wrapper } = setup();
    const grip = wrapper.findAll(".edit-grip")[0].element;

    pointer("pointerdown", 100, grip);
    // Past one and a half rows down (jsdom has no layout; the row height falls
    // back to 72): the row now hovers over the third slot.
    pointer("pointermove", 100 + 1.6 * 72);
    await wrapper.vm.$nextTick();

    // The rows in between step up to make room, the one below the target stays.
    const rows = wrapper.findAll(".edit-row");
    expect(rows[1].attributes("style")).toContain("translateY(-72px)");
    expect(rows[2].attributes("style")).toContain("translateY(-72px)");
    expect(rows[3].attributes("style") ?? "").not.toContain("translateY");
    expect(rows[0].classes()).toContain("is-lifted");

    pointer("pointerup", 100 + 1.6 * 72);
    await flushPromises();

    expect(order()).toEqual(["b", "c", "a", "d"]);
    expect(move).toHaveBeenCalledWith(7, "a", "d");
    expect(wrapper.find(".is-lifted").exists()).toBe(false);
  });

  it("drops nothing when the browser cancels the touch", async () => {
    const { wrapper } = setup();
    pointer("pointerdown", 100, wrapper.findAll(".edit-grip")[0].element);
    pointer("pointermove", 400);
    pointer("pointercancel", 400);
    await flushPromises();

    expect(move).not.toHaveBeenCalled();
    expect(order()).toEqual(["a", "b", "c", "d"]);
  });

  it("moves a row one step per arrow key and keeps the focus on it", async () => {
    const { wrapper } = setup();
    await wrapper.findAll(".edit-grip")[0].trigger("keydown", { key: "ArrowDown" });
    await flushPromises();

    expect(order()).toEqual(["b", "a", "c", "d"]);
    expect(move).toHaveBeenCalledWith(7, "a", "c");
    expect(document.activeElement).toBe(wrapper.findAll(".edit-grip")[1].element);
  });

  it("waits for a move to settle before starting the next", async () => {
    const { wrapper } = setup();
    let answer: (ok: boolean) => void = () => undefined;
    move.mockReturnValueOnce(new Promise(resolve => (answer = resolve)));

    await wrapper.findAll(".edit-grip")[0].trigger("keydown", { key: "ArrowDown" });
    await wrapper.findAll(".edit-grip")[2].trigger("keydown", { key: "ArrowUp" });
    expect(move).toHaveBeenCalledTimes(1);

    answer(true);
    await flushPromises();
    expect(order()).toEqual(["b", "a", "c", "d"]);
  });

  it("hides a removed row at once, and tells the server only when the undo runs out", async () => {
    vi.useFakeTimers();
    const { wrapper } = setup();

    await wrapper.findAll(".edit-remove")[1].trigger("click");
    expect(shown(wrapper)).toEqual(["Title a", "Title c", "Title d"]);
    expect(remove).not.toHaveBeenCalled();

    vi.advanceTimersByTime(8000);
    await flushPromises();

    expect(remove).toHaveBeenCalledWith(7, [{ trackhash: "b", index: 1 }], false);
    expect(order()).toEqual(["a", "c", "d"]);
  });

  it("brings the row back on undo, and never tells the server", async () => {
    vi.useFakeTimers();
    const { wrapper } = setup();

    await wrapper.findAll(".edit-remove")[1].trigger("click");
    const toast = useToast().notifs.at(-1);
    expect(toast?.action?.label).toBe("Undo");

    toast?.action?.handler();
    await wrapper.vm.$nextTick();
    expect(shown(wrapper)).toEqual(["Title a", "Title b", "Title c", "Title d"]);

    vi.advanceTimersByTime(10000);
    await flushPromises();
    expect(remove).not.toHaveBeenCalled();
  });

  it("moves around a row whose undo is still running", async () => {
    const { wrapper } = setup();
    await wrapper.findAll(".edit-remove")[1].trigger("click"); // "b" hidden: a c d

    // On screen, "d" (third visible row) goes to the top.
    await wrapper.findAll(".edit-grip")[2].trigger("keydown", { key: "ArrowUp" });
    await flushPromises();
    await wrapper.findAll(".edit-grip")[1].trigger("keydown", { key: "ArrowUp" });
    await flushPromises();

    expect(shown(wrapper)).toEqual(["Title d", "Title a", "Title c"]);
    expect(move).toHaveBeenLastCalledWith(7, "d", "a");
  });

  it("settles a pending removal when the mode is left", async () => {
    const { wrapper } = setup();
    await wrapper.findAll(".edit-remove")[0].trigger("click");
    expect(remove).not.toHaveBeenCalled();

    wrapper.unmount();
    await flushPromises();

    expect(remove).toHaveBeenCalledWith(7, [{ trackhash: "a", index: 0 }], false);
  });

  it("brings the row back when the server refuses the removal", async () => {
    remove.mockResolvedValue(false);
    const { wrapper } = setup();
    await wrapper.findAll(".edit-remove")[0].trigger("click"); // "a"
    await wrapper.findAll(".edit-remove")[0].trigger("click"); // "b" — settles "a"

    await flushPromises();
    expect(shown(wrapper)).toEqual(["Title a", "Title c", "Title d"]);
    expect(order()).toEqual(["a", "b", "c", "d"]);
  });
});

describe("the caption bar", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("offers Edit on an editable list, and nothing on a generated one", async () => {
    const editable = mount(AfterHeader, { props: { caps_list: true, editable: true } });
    await editable.find("button.ah-edit").trigger("click");
    expect(editable.emitted("edit")).toHaveLength(1);

    const fixed = mount(AfterHeader, { props: { caps_list: true, editable: false } });
    expect(fixed.find("button").exists()).toBe(false);
  });

  it("names the mode and offers Done while editing", async () => {
    const bar = mount(AfterHeader, { props: { caps_list: true, editing: true, count: 12 } });
    expect(bar.text()).toContain("Edit order");
    expect(bar.text()).toContain("12");
    await bar.find("button.ah-edit").trigger("click");
    expect(bar.emitted("done")).toHaveLength(1);
  });
});
