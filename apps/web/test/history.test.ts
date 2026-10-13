import { describe, expect, it } from "vitest";
import { historyReducer, MERGE_MS, type HistoryState } from "../src/designer/history.js";

const start = (v: number): HistoryState<number> => ({ past: [], present: v, future: [], group: null, at: 0 });
const set = (s: HistoryState<number>, next: number, group?: string, now = 1000) => historyReducer(s, { type: "set", next, group, now });

describe("history", () => {
  it("undo / redo whole snapshots", () => {
    let s = set(set(start(1), 2), 3);
    expect(s.past).toEqual([1, 2]);
    s = historyReducer(s, { type: "undo" });
    expect(s.present).toBe(2);
    s = historyReducer(s, { type: "redo" });
    expect(s.present).toBe(3);
    s = historyReducer(historyReducer(s, { type: "undo" }), { type: "undo" });
    expect(s.present).toBe(1);
    s = set(s, 9); // a new change drops the redo steps
    expect(s.future).toEqual([]);
    expect(historyReducer(start(1), { type: "undo" }).present).toBe(1);
  });

  it("a drag is one step however long it takes", () => {
    let s = start(0);
    for (let i = 1; i <= 50; i++) s = set(s, i, "drag:p3:1", 1000 + i * 1000);
    expect(s.past).toEqual([0]);
    expect(s.present).toBe(50);
    s = set(s, 51, "drag:p3:2", 99999); // the next drag is a new step
    expect(s.past).toEqual([0, 50]);
  });

  it("wheel bursts merge, pauses split them", () => {
    let s = set(start(0), 1, "radius:2", 1000);
    s = set(s, 2, "radius:2", 1000 + MERGE_MS - 1);
    expect(s.past).toEqual([0]);
    s = set(s, 3, "radius:2", 1000 + 3 * MERGE_MS);
    expect(s.past).toEqual([0, 2]);
    s = set(s, 4, "width:2", 1000 + 3 * MERGE_MS + 1); // a different thing is a new step
    expect(s.past).toEqual([0, 2, 3]);
  });
});
