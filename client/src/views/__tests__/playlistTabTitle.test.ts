import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, reactive } from "vue";

import PlaylistView from "@/views/PlaylistView/index.vue";
import usePlaylistStore from "@/stores/pages/playlist";

// ---------------------------------------------------------------------------
// The tab named the PREVIOUS playlist. Two things make that possible, and the
// old code walked into both:
//
//   1. The name arrives with the FETCH, not with the mount — `info` is `{}`
//      until the request lands.
//   2. This view is reused across playlists: only `route.params.pid` changes,
//      so `setup()` never runs again.
//
// The old line was not even a lifecycle registration:
//
//      ;[onMounted, onUpdated].forEach(() => updatePageTitle(playlist.info.name))
//
// `forEach` CALLS its callback, so the two hooks were merely iterated over and
// never hooked up. Both reads happened synchronously during setup, against a
// store still holding the last playlist's info.
// ---------------------------------------------------------------------------

const route = reactive({ params: { pid: "1" }, query: {}, name: "playlist" });

// Partial mock: the real module is still needed (the queue store pulls the
// router in), only the two composables this view uses are replaced.
vi.mock("vue-router", async () => ({
  ...((await vi.importActual("vue-router")) as object),
  useRoute: () => route,
  onBeforeRouteLeave: vi.fn(),
}));

vi.mock("@/requests/playlists", () => ({ movePlaylistTrack: vi.fn() }));

function mountView() {
  const playlist = usePlaylistStore();
  vi.spyOn(playlist, "fetchAll").mockResolvedValue(undefined as never);

  mount(PlaylistView, {
    global: {
      stubs: {
        DynamicScroller: true,
        DynamicScrollerItem: true,
        Header: true,
        AfterHeader: true,
        SongItem: true,
        NoItems: true,
        AlbumsFetcher: true,
      },
    },
  });

  return playlist;
}

describe("the tab names the playlist that is open", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.title = "";
  });

  it("names the playlist once its info has loaded", async () => {
    const playlist = mountView();

    // Mounted before the fetch resolves: there is nothing to name yet.
    expect(document.title).toBe("AivinNet");

    playlist.info = { name: "Holiday Island" } as never;
    await nextTick();

    expect(document.title).toBe("Holiday Island | AivinNet");
  });

  it("follows the switch to another playlist in the same view", async () => {
    const playlist = mountView();

    playlist.info = { name: "90s" } as never;
    await nextTick();
    expect(document.title).toBe("90s | AivinNet");

    // Playlist -> playlist reuses this component instance; only the store's
    // info is replaced by the next fetch.
    route.params.pid = "2";
    playlist.info = { name: "Holiday Island" } as never;
    await nextTick();

    expect(document.title).toBe("Holiday Island | AivinNet");
  });
});
