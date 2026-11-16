// The drag loupe (#125): where it goes in the plan box, including every edge and corner, and its readouts.
import { describe, expect, it } from "vitest";
import { LOUPE_GAP_PX, LOUPE_LAYOUTS, LOUPE_MARGIN_PX, LOUPE_PX, LOUPE_READ_PX, LOUPE_ZOOM, loupePlace, loupeText, loupeViewBox, type LoupePlace } from "../src/designer/loupe.js";

// the phone's plan box at 375 × 812: under the 52 px header, over the 64 px toolbar
const W = 375, H = 812 - 52 - 64;
const FOOT = LOUPE_PX + LOUPE_READ_PX;

/** the loupe (circle and readout) is inside the box, clear of every edge */
function inside(p: LoupePlace, w = W, h = H) {
  expect(p.left).toBeGreaterThanOrEqual(LOUPE_MARGIN_PX);
  expect(p.top).toBeGreaterThanOrEqual(LOUPE_MARGIN_PX);
  expect(p.left + LOUPE_PX).toBeLessThanOrEqual(w - LOUPE_MARGIN_PX);
  expect(p.top + FOOT).toBeLessThanOrEqual(h - LOUPE_MARGIN_PX);
}

/** the loupe doesn't cover the fingertip (a 44 px circle round the finger) */
function clearOfFinger(p: LoupePlace, f: { x: number; y: number }) {
  const nx = Math.max(p.left, Math.min(f.x, p.left + LOUPE_PX)), ny = Math.max(p.top, Math.min(f.y, p.top + FOOT));
  expect(Math.hypot(f.x - nx, f.y - ny)).toBeGreaterThanOrEqual(22);
}

describe("loupe placement", () => {
  it("sits above the finger, centred on it, in the middle of the plan", () => {
    const f = { x: 180, y: 400 };
    const p = loupePlace(f, W, H);
    expect(p.side).toBe("above");
    expect(p.left + LOUPE_PX / 2).toBe(180);
    expect(p.top + FOOT).toBe(400 - LOUPE_GAP_PX);
    inside(p);
    clearOfFinger(p, f);
  });

  it("flips below the finger near the top, so it never goes under the header", () => {
    for (const y of [0, 10, 60, 150]) {
      const f = { x: 180, y };
      const p = loupePlace(f, W, H);
      expect(p.side).toBe("below");
      expect(p.top).toBe(y + LOUPE_GAP_PX);
      inside(p);
      clearOfFinger(p, f);
    }
  });

  it("stays above, clear of the toolbar, near the bottom", () => {
    const f = { x: 180, y: H - 2 };
    const p = loupePlace(f, W, H);
    expect(p.side).toBe("above");
    inside(p);
  });

  it("is clamped inside the plan near a side edge, still clear of the finger", () => {
    for (const x of [0, 5, 40, W - 40, W - 5, W]) {
      const f = { x, y: 400 };
      const p = loupePlace(f, W, H);
      inside(p);
      clearOfFinger(p, f);
    }
    expect(loupePlace({ x: 0, y: 400 }, W, H).left).toBe(LOUPE_MARGIN_PX);
    expect(loupePlace({ x: W, y: 400 }, W, H).left).toBe(W - LOUPE_MARGIN_PX - LOUPE_PX);
  });

  it("stays on screen and off the finger at all four corners", () => {
    for (const f of [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: 0, y: H }, { x: W, y: H }, { x: 12, y: 30 }, { x: W - 12, y: H - 30 }]) {
      const p = loupePlace(f, W, H);
      inside(p);
      clearOfFinger(p, f);
    }
  });

  it("goes beside the finger when there's room neither above nor below (a short plan)", () => {
    const h = 300;
    const left = loupePlace({ x: 60, y: 150 }, W, h);
    expect(left.side).toBe("right");
    inside(left, W, h);
    clearOfFinger(left, { x: 60, y: 150 });
    const right = loupePlace({ x: W - 60, y: 150 }, W, h);
    expect(right.side).toBe("left");
    inside(right, W, h);
    clearOfFinger(right, { x: W - 60, y: 150 });
    // near the top or bottom of a short plan: level with the finger as far as the box allows
    for (const y of [0, h]) {
      const p = loupePlace({ x: 60, y }, W, h);
      inside(p, W, h);
      clearOfFinger(p, { x: 60, y });
    }
  });
});

describe("loupe view", () => {
  it("is centred on the point (y = -z) and shows 2.4 × the screen's scale", () => {
    const [x, y, w, h] = loupeViewBox([3, -1.5], 20).split(" ").map(Number);
    const size = LOUPE_PX / (20 * LOUPE_ZOOM);
    expect(w).toBeCloseTo(size, 9);
    expect(h).toBeCloseTo(size, 9);
    expect(x + w / 2).toBeCloseTo(3, 9);
    expect(y + h / 2).toBeCloseTo(1.5, 9);
  });
});

describe("loupe readout", () => {
  it("says where a corner is, in metres", () => {
    expect(loupeText({ kind: "point", x: 3.4, z: -1.25 })).toBe("x 3.40 · z −1.25 m");
    expect(loupeText({ kind: "point", x: -0.001, z: 0 })).toBe("x 0.00 · z 0.00 m");
  });
  it("gives an apex handle's radius", () => {
    expect(loupeText({ kind: "apex", radius: 1.8 })).toBe("Radius 1.80 m");
  });
  it("gives a jump's or the start's distance along the lap", () => {
    expect(loupeText({ kind: "along", distance: 12.345 })).toBe("12.3 m along the lap");
  });
});

it("is on for the phone and off for tablets (#125: tablets later)", () => {
  expect(LOUPE_LAYOUTS).toEqual({ phone: true, tablet: false });
});
