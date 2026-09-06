import { describe, expect, it } from "vitest";
import { computeEdgeScrollVelocity } from "../dragAutoScroll";

// Clean, round-number geometry so the linear ramp is easy to verify:
//   container: top=100, height=500  -> bottom=600
//   zone=100, minSpeed=5, maxSpeed=25
const RECT_TOP = 100;
const RECT_HEIGHT = 500;
const OPTS = { zone: 100, minSpeed: 5, maxSpeed: 25 };

const velocity = (pointerY: number) =>
  computeEdgeScrollVelocity(pointerY, RECT_TOP, RECT_HEIGHT, OPTS);

describe("computeEdgeScrollVelocity", () => {
  it("returns 0 in the neutral middle band", () => {
    expect(velocity(350)).toBe(0);
  });

  it("returns 0 exactly at the inner zone boundaries", () => {
    expect(velocity(RECT_TOP + OPTS.zone)).toBe(0); // top inner edge (200)
    expect(velocity(600 - OPTS.zone)).toBe(0); // bottom inner edge (500)
  });

  it("scrolls up (negative) in the top zone, ramping with depth", () => {
    expect(velocity(100)).toBe(-25); // at the top border -> max speed
    expect(velocity(150)).toBe(-15); // halfway in -> min + (max-min)*0.5
    expect(velocity(199)).toBeCloseTo(-5.2, 5); // just inside -> ~min speed
  });

  it("scrolls down (positive) in the bottom zone, ramping with depth", () => {
    expect(velocity(600)).toBe(25); // at the bottom border -> max speed
    expect(velocity(550)).toBe(15); // halfway in
    expect(velocity(501)).toBeCloseTo(5.2, 5); // just inside -> ~min speed
  });

  it("clamps to max speed when the pointer is dragged past the edge", () => {
    expect(velocity(50)).toBe(-25); // above the container
    expect(velocity(650)).toBe(25); // below the container
  });

  it("never lets the two zones overlap on a short container", () => {
    // height 40, zone capped to half (20): dead-centre stays neutral.
    expect(computeEdgeScrollVelocity(20, 0, 40, OPTS)).toBe(0);
    expect(computeEdgeScrollVelocity(0, 0, 40, OPTS)).toBe(-25); // top edge
    expect(computeEdgeScrollVelocity(40, 0, 40, OPTS)).toBe(25); // bottom edge
  });

  it("returns 0 for a zero-height container", () => {
    expect(computeEdgeScrollVelocity(0, 0, 0, OPTS)).toBe(0);
  });

  it("applies sensible defaults when no options are given", () => {
    // Default zone 64, so 300 is well inside a tall container -> neutral.
    expect(computeEdgeScrollVelocity(300, 0, 600)).toBe(0);
    // At the very top border -> default maxSpeed (22), scrolling up.
    expect(computeEdgeScrollVelocity(0, 0, 600)).toBe(-22);
  });
});
