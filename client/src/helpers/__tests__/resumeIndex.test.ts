import { describe, expect, it } from "vitest";

import { resumeIndex } from "@/helpers/usePlayFrom";
import { Track } from "@/interfaces";

// Home's "Continue listening" resumes a playlist where the user stopped. The
// server's `track_index` counts the playlist's STORED list, which can hold
// orphans (hashes no longer in the library) that the client never receives —
// by index alone the resume lands too far. The track itself decides.
const tracks = ["t1", "t2", "t3", "t4"].map(trackhash => ({ trackhash }) as Track);

describe("resumeIndex", () => {
  it("finds the track itself, even when the server's index counted orphans", () => {
    // Stored list: orphan, t1, t2, t3, t4 → the server says index 3 for t3.
    expect(resumeIndex(tracks, "t3", 3)).toBe(2);
  });

  it("falls back to the index when the track is gone", () => {
    expect(resumeIndex(tracks, "gone", 1)).toBe(1);
  });

  it("falls back to the index without a trackhash, clamped to the list", () => {
    expect(resumeIndex(tracks, undefined, 2)).toBe(2);
    expect(resumeIndex(tracks, undefined, 99)).toBe(3);
    expect(resumeIndex(tracks, undefined, -1)).toBe(0);
  });
});
