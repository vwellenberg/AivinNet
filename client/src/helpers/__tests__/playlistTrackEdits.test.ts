import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FromOptions } from "@/enums";
import { movePlaylistTrackTo, removePlaylistTrack } from "@/helpers/playlistTrackEdits";
import { movePlaylistTrack, removeTracks } from "@/requests/playlists";
import usePlaylistStore from "@/stores/pages/playlist";
import useTracklist from "@/stores/queue/tracklist";

// ---------------------------------------------------------------------------
// The playlist page's two writes, shared by the mouse drag, the edit mode and
// the track menu. What is pinned here is what the edit mode leans on: moves
// roll back when refused, and a removal drops the row the SERVER dropped —
// found by reference, because a move can land while the removal is in flight.
// ---------------------------------------------------------------------------

vi.mock("@/requests/playlists", () => ({
  movePlaylistTrack: vi.fn(),
  removeTracks: vi.fn(),
  getPlaylist: vi.fn(),
  removeBannerImage: vi.fn(),
}));

const move = vi.mocked(movePlaylistTrack);
const remove = vi.mocked(removeTracks);

// Backend-shaped: images carry the ?pathhash= suffix.
function track(hash: string, duration = 200) {
  return {
    trackhash: hash,
    title: `Title ${hash}`,
    album: "Album",
    albumhash: "al1",
    artists: [{ name: "Artist", artisthash: "ar1" }],
    albumartists: [{ name: "Artist", artisthash: "ar1" }],
    image: `al1.webp?pathhash=${hash}`,
    duration,
    filepath: `/music/${hash}.flac`,
  } as never;
}

function setup(hashes = ["a", "b", "c", "d"]) {
  const playlist = usePlaylistStore();
  playlist.info = { id: 7, name: "Mix", count: hashes.length + 1, duration: 1000 } as never;
  playlist.allTracks = hashes.map(h => track(h));
  playlist.loadedHashCount = hashes.length + 1; // one orphan hash the page never sees
  playlist.allLoaded = true;
  return playlist;
}

const order = () => usePlaylistStore().allTracks.map(t => t.trackhash);

describe("moving a track", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("reorders at once and sends trackhash anchors", async () => {
    setup();
    move.mockResolvedValue(true);

    const pending = movePlaylistTrackTo(0, 3); // "a" into the gap before "d"
    expect(order()).toEqual(["b", "c", "a", "d"]); // optimistic, before the answer

    expect(await pending).toBe(true);
    expect(move).toHaveBeenCalledWith(7, "a", "d");
  });

  it("puts the row back when the server refuses", async () => {
    setup();
    move.mockResolvedValue(false);

    expect(await movePlaylistTrackTo(3, 0)).toBe(false);
    expect(order()).toEqual(["a", "b", "c", "d"]);
  });

  it("mirrors the move into a queue that plays this playlist", async () => {
    const playlist = setup();
    const tracklist = useTracklist();
    tracklist.from = { type: FromOptions.playlist, id: 7, name: "Mix" } as never;
    tracklist.tracklist = playlist.allTracks.map(t => ({ ...t })) as never;
    const mirror = vi.spyOn(tracklist, "moveTrack").mockImplementation(() => undefined as never);
    move.mockResolvedValue(true);

    await movePlaylistTrackTo(0, 3);
    expect(mirror).toHaveBeenCalledWith(0, 3);
  });

  it("does not mirror a refused move", async () => {
    const playlist = setup();
    const tracklist = useTracklist();
    tracklist.from = { type: FromOptions.playlist, id: 7, name: "Mix" } as never;
    tracklist.tracklist = playlist.allTracks.map(t => ({ ...t })) as never;
    const mirror = vi.spyOn(tracklist, "moveTrack").mockImplementation(() => undefined as never);
    move.mockResolvedValue(false);

    await movePlaylistTrackTo(0, 3);
    expect(mirror).not.toHaveBeenCalled();
  });
});

describe("removing a track", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("drops the row once the server has, and keeps the header and the page cursor in step", async () => {
    const playlist = setup();
    remove.mockResolvedValue(true);

    expect(await removePlaylistTrack(1)).toBe(true);
    expect(remove).toHaveBeenCalledWith(7, [{ trackhash: "b", index: 1 }], true);
    expect(order()).toEqual(["a", "c", "d"]);
    expect(playlist.info.count).toBe(4);
    expect(playlist.info.duration).toBe(800);
    // The next page must start one hash earlier, or a track is skipped.
    expect(playlist.loadedHashCount).toBe(4);
  });

  it("keeps the row when the server refuses", async () => {
    const playlist = setup();
    remove.mockResolvedValue(false);

    expect(await removePlaylistTrack(1)).toBe(false);
    expect(order()).toEqual(["a", "b", "c", "d"]);
    expect(playlist.info.count).toBe(5);
  });

  it("drops the right row when a move lands while the request is out", async () => {
    const playlist = setup();
    let answer: (ok: boolean) => void = () => undefined;
    remove.mockReturnValue(new Promise(resolve => (answer = resolve)));

    const pending = removePlaylistTrack(1, false); // "b"
    expect(remove).toHaveBeenCalledWith(7, [{ trackhash: "b", index: 1 }], false);

    // Meanwhile "d" moves to the top: "b" is now at index 2, and index 1 is "a".
    playlist.moveTrack(3, 0);
    answer(true);
    await pending;

    expect(order()).toEqual(["d", "a", "c"]);
  });

  it("tells a duplicate from its twin", async () => {
    setup(["x", "b", "x"]);
    const twin = usePlaylistStore().allTracks[2];
    remove.mockResolvedValue(true);

    await removePlaylistTrack(2);
    expect(usePlaylistStore().allTracks).not.toContain(twin);
    expect(order()).toEqual(["x", "b"]);
  });
});

describe("entering the edit mode", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("loads the rest of the playlist first — a reorder of page one is no reorder", async () => {
    const playlist = setup();
    playlist.allLoaded = false;
    playlist.query = "gen";
    const fetchAll = vi.spyOn(playlist, "fetchAll").mockResolvedValue(undefined as never);

    await playlist.startEditing("c");

    expect(fetchAll).toHaveBeenCalledWith(7, false, true);
    expect(playlist.editing).toBe(true);
    expect(playlist.editFocus).toBe("c");
    // Every track, in stored order — never a filtered view.
    expect(playlist.query).toBe("");
  });

  it("leaves it when the page switches to another playlist", async () => {
    const playlist = setup();
    await playlist.startEditing();
    playlist.resetTracks();
    expect(playlist.editing).toBe(false);
  });
});
