import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatDateAdded } from "../dates";

// Fixed "now": 2026-07-12T12:00:00Z
const NOW = Date.UTC(2026, 6, 12, 12, 0, 0);
const nowSeconds = Math.floor(NOW / 1000);

describe("formatDateAdded", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for very recent timestamps", () => {
    expect(formatDateAdded(nowSeconds - 30)).toBe("just now");
  });

  it("treats future timestamps (clock skew) as 'just now'", () => {
    expect(formatDateAdded(nowSeconds + 120)).toBe("just now");
  });

  it("formats minutes with singular/plural", () => {
    expect(formatDateAdded(nowSeconds - 60)).toBe("1 minute ago");
    expect(formatDateAdded(nowSeconds - 5 * 60)).toBe("5 minutes ago");
  });

  it("formats hours", () => {
    expect(formatDateAdded(nowSeconds - 60 * 60)).toBe("1 hour ago");
    expect(formatDateAdded(nowSeconds - 23 * 60 * 60)).toBe("23 hours ago");
  });

  it("formats days", () => {
    expect(formatDateAdded(nowSeconds - 24 * 60 * 60)).toBe("1 day ago");
    expect(formatDateAdded(nowSeconds - 3 * 24 * 60 * 60)).toBe("3 days ago");
  });

  it("formats weeks up to four", () => {
    expect(formatDateAdded(nowSeconds - 7 * 24 * 60 * 60)).toBe("1 week ago");
    expect(formatDateAdded(nowSeconds - 27 * 24 * 60 * 60)).toBe("3 weeks ago");
  });

  it("switches to an absolute short date from ~4 weeks on", () => {
    const fourWeeks = nowSeconds - 28 * 24 * 60 * 60;
    expect(formatDateAdded(fourWeeks)).toBe("Jun 14, 2026");
  });

  it("formats old dates absolutely", () => {
    const jan5 = Math.floor(Date.UTC(2026, 0, 5, 12, 0, 0) / 1000);
    expect(formatDateAdded(jan5)).toBe("Jan 5, 2026");
  });
});
