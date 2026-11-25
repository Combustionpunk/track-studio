import { describe, expect, it } from "vitest";
import { shownMark, type PlanMark } from "../src/designer/highlight.js";

describe("the plan's highlight in the designer (#177)", () => {
  const start: PlanMark = { at: [1, 2], of: "start", mode: "quick" };
  const check: PlanMark = { at: [3, 4], of: "check", mode: "advanced" };

  it("shows the start line while it is selected", () => {
    expect(shownMark(start, { kind: "start" }, "quick")).toEqual([1, 2]);
  });
  it("drops the start line's once it is let go, or something else is selected", () => {
    expect(shownMark(start, null, "quick")).toBeNull();
    expect(shownMark(start, { kind: "point", i: 0 }, "quick")).toBeNull();
    expect(shownMark(start, { kind: "feature", i: 0 }, "quick")).toBeNull();
  });
  it("doesn't carry either across a change of mode", () => {
    expect(shownMark(start, { kind: "start" }, "advanced")).toBeNull();
    expect(shownMark(check, { kind: "point", i: 2 }, "quick")).toBeNull();
  });
  it("keeps a check's whatever is selected", () => {
    expect(shownMark(check, { kind: "point", i: 2 }, "advanced")).toEqual([3, 4]);
    expect(shownMark(check, null, "advanced")).toEqual([3, 4]);
  });
  it("shows nothing without a highlight", () => {
    expect(shownMark(null, { kind: "start" }, "quick")).toBeNull();
  });
});
