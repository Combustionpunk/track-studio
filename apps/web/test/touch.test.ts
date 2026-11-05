// Tablet touch (#16): the pure parts of pinch, pan and the two-finger rule.
import { describe, expect, it } from "vitest";
import { historyReducer, type HistoryState } from "../src/designer/history.js";
import { toPlan, type View } from "../src/lib/plan.js";
import { Fingers, LONG_PRESS_MS, pinchView, slopFor, TAP_SLOP_PX } from "../src/lib/touch.js";

const W = 800, H = 600;
const V: View = { cx: 0, cy: 0, s: 20 };

describe("pinch and two-finger pan", () => {
  it("keeps the plan point between the fingers under them as they spread and move", () => {
    const a0 = { x: 300, y: 300 }, b0 = { x: 500, y: 300 };
    const a1 = { x: 220, y: 340 }, b1 = { x: 620, y: 340 }; // twice as far apart, midpoint 20 px right and 40 px down
    const under = toPlan(V, 400, 300, W, H);
    const v = pinchView(V, [a0, b0], [a1, b1], W, H, 1, 400);
    expect(v.s).toBeCloseTo(40, 9);
    const now = toPlan(v, 420, 340, W, H);
    expect(now[0]).toBeCloseTo(under[0], 9);
    expect(now[1]).toBeCloseTo(under[1], 9);
  });

  it("two fingers moving together only pan", () => {
    const v = pinchView(V, [{ x: 100, y: 100 }, { x: 200, y: 100 }], [{ x: 130, y: 90 }, { x: 230, y: 90 }], W, H, 1, 400);
    expect(v.s).toBe(20);
    expect(v.cx).toBeCloseTo(-30 / 20, 9);
    expect(v.cy).toBeCloseTo(10 / 20, 9);
  });

  it("keeps to the zoom limits, and ignores fingers on the same spot", () => {
    expect(pinchView(V, [{ x: 0, y: 0 }, { x: 10, y: 0 }], [{ x: 0, y: 0 }, { x: 1000, y: 0 }], W, H, 1, 50).s).toBe(50);
    expect(pinchView(V, [{ x: 5, y: 5 }, { x: 5, y: 5 }], [{ x: 5, y: 5 }, { x: 50, y: 5 }], W, H, 1, 400)).toEqual(V);
  });
});

describe("fingers on the plan", () => {
  it("the second finger starts a two-finger gesture once, and it lasts until every finger is up", () => {
    const f = new Fingers();
    expect(f.press(1)).toBe(false);
    expect(f.multi).toBe(false);
    expect(f.press(2)).toBe(true);
    expect(f.multi).toBe(true);
    expect(f.press(3)).toBe(false); // already two-finger
    f.lift(2);
    f.lift(3);
    expect(f.count).toBe(1);
    expect(f.multi).toBe(true); // the finger left behind doesn't paint or move anything
    f.lift(1);
    expect(f.multi).toBe(false);
    expect(f.press(4)).toBe(false);
  });

  it("lifting a finger it never saw changes nothing", () => {
    const f = new Fingers();
    f.press(1);
    f.lift(9);
    expect(f.count).toBe(1);
  });
});

describe("press tuning", () => {
  it("a touch press may wobble further than a mouse before it's a drag; a long-press is about 500 ms", () => {
    expect(slopFor("mouse")).toBe(3);
    expect(slopFor("touch")).toBe(TAP_SLOP_PX);
    expect(slopFor("pen")).toBe(TAP_SLOP_PX);
    expect(TAP_SLOP_PX).toBeGreaterThanOrEqual(8);
    expect(LONG_PRESS_MS).toBe(500);
  });
});

describe("cancelling an edit when a second finger lands", () => {
  it("puts the history back exactly as it was, redo steps included", () => {
    const set = (s: HistoryState<number>, next: number, group?: string) => historyReducer(s, { type: "set", next, group, now: 1000 });
    let s: HistoryState<number> = { past: [], present: 1, future: [], group: null, at: 0, travels: 0 };
    s = historyReducer(set(set(s, 2), 3), { type: "undo" }); // present 2, redo 3
    const before = s;
    s = set(set(set(s, 4), 5), 6, "drag:x"); // a one-finger edit paints three squares
    s = historyReducer(s, { type: "restore", state: before });
    expect(s).toEqual(before);
  });
});
