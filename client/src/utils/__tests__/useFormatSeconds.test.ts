import { describe, it, expect } from "vitest";
import formatSeconds from "../useFormatSeconds";

describe("formatSeconds", () => {
  it("returns 00:00 for undefined", () => {
    expect(formatSeconds(undefined)).toBe("00:00");
  });

  it("formats seconds below one minute", () => {
    expect(formatSeconds(45)).toBe("00:45");
  });

  it("formats minutes and seconds", () => {
    expect(formatSeconds(125)).toBe("02:05");
  });

  it("formats hours, minutes, and seconds", () => {
    expect(formatSeconds(3661)).toBe("01:01:01");
  });

  it("long format: seconds only", () => {
    expect(formatSeconds(30, true)).toBe("30 Seconds");
  });

  it("long format: minutes only", () => {
    expect(formatSeconds(180, true)).toBe("3 minutes");
  });

  it("long format: hours and minutes", () => {
    expect(formatSeconds(7320, true)).toBe("2 hrs, 2 minutes");
  });
});
