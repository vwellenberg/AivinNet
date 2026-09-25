import { describe, expect, it } from "vitest";

import { isStoredPlaylistId } from "../storedPlaylist";

describe("which playlist ids are stored ones", () => {
  it("accepts the numeric ids of playlists the user made, as number or route string", () => {
    expect(isStoredPlaylistId(7)).toBe(true);
    expect(isStoredPlaylistId("80")).toBe(true);
  });

  it("refuses the generated lists and anything that only starts with digits", () => {
    for (const id of ["recentlyadded", "recentlyplayed", "12-mix", "", undefined, null, "7.5"]) {
      expect(isStoredPlaylistId(id), String(id)).toBe(false);
    }
  });
});
