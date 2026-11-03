import { bakeBuilt, type Check, type DesignPoint, type RcTrack } from "@track-studio/engine";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { draftFromDoc, toDoc } from "../src/designer/Designer.js";
import { allows, checkCounts, deletePoint, insertPoint, movePoint, pressOnStraight, problemMarks, readMode, snapModeFor, submitBlock, visibleChecks, wheelEdit } from "../src/designer/mode.js";
import { historyReducer, type HistoryState } from "../src/designer/history.js";
import { keepPinned, pinnedCorners, snapCentre } from "../src/designer/snap.js";

const ref = <T,>(p: string) => JSON.parse(readFileSync(join(__dirname, "../../../reference", p), "utf8")) as T;

/** club-a with every kind of custom per-corner value: radius, width and both outer styles */
function customTrack(): RcTrack {
  const t = ref<RcTrack>("examples/club-a.rctrack.json");
  t.design.points = t.design.points.map((p, i) => ({ ...p, radius: 0.7 + i * 0.05, width: 2.4, ...(i % 3 === 0 ? { outer: "square" } : i % 3 === 1 ? { outer: "round" } : {}) }));
  return t;
}

const custom = (p: DesignPoint) => ({ radius: p.radius, width: p.width, outer: p.outer });

describe("the mode preference", () => {
  it("opens in Quick unless Advanced was chosen before", () => {
    expect(readMode(null)).toBe("quick");
    expect(readMode("")).toBe("quick");
    expect(readMode("nonsense")).toBe("quick");
    expect(readMode(JSON.stringify({ mode: "advanced" }))).toBe("advanced");
    expect(readMode(JSON.stringify({ mode: "quick" }))).toBe("quick");
  });
});

describe("what Quick mode allows", () => {
  it("hides radius, lane width, outer, fine/free snapping, outside-corner handles, hairpins and the full checks", () => {
    for (const a of ["radius", "width", "outer", "fineSnap", "freeSnap", "mitre", "hairpin", "fullChecks", "sizing", "trackSettings"] as const) {
      expect(allows("quick", a)).toBe(false);
      expect(allows("advanced", a)).toBe(true);
    }
  });

  it("the wheel over a corner changes nothing in Quick (the plan zooms instead)", () => {
    expect(wheelEdit("quick", { ctrlKey: false, metaKey: false })).toBeNull();
    expect(wheelEdit("quick", { ctrlKey: true, metaKey: false })).toBeNull();
    expect(wheelEdit("advanced", { ctrlKey: false, metaKey: false })).toBe("radius");
    expect(wheelEdit("advanced", { ctrlKey: true, metaKey: false })).toBe("width");
    expect(wheelEdit("advanced", { ctrlKey: false, metaKey: true })).toBe("width");
  });

  it("snaps to lanes only, whatever the keys or the toolbar say", () => {
    expect(snapModeFor("quick", { shiftKey: true, altKey: false }, "fine")).toBe("lanes");
    expect(snapModeFor("quick", { shiftKey: false, altKey: true }, "free")).toBe("lanes");
    expect(snapModeFor("advanced", { shiftKey: true, altKey: false }, "lanes")).toBe("fine");
    expect(snapModeFor("advanced", { shiftKey: false, altKey: true }, "lanes")).toBe("free");
    expect(snapModeFor("advanced", { shiftKey: false, altKey: false }, "fine")).toBe("fine");
  });
});

describe("Quick mode edits keep custom values", () => {
  it("a new corner gets the defaults: no radius, width or outer written", () => {
    const t = customTrack();
    const pts = insertPoint("quick", t.design.points, 2, [1, 1]);
    expect(pts).toHaveLength(t.design.points.length + 1);
    expect(pts[3]).toEqual({ x: 1, z: 1 });
    // Advanced keeps today's behaviour (radius 1, the neighbours' width)
    expect(insertPoint("advanced", t.design.points, 2, [1, 1])[3]).toMatchObject({ x: 1, z: 1, radius: 1, width: 2.4 });
  });

  it("moving and deleting corners never touches the other corners' radius, width or outer", () => {
    const t = customTrack();
    const before = t.design.points;
    const lw = t.design.laneWidth ?? 2;
    const res = snapCentre([before[4].x + 0.6, before[4].z - 0.3], { area: t.area, points: before, laneWidth: lw, i: 4, mode: snapModeFor("quick", { shiftKey: true, altKey: true }, "free") });
    const moved = movePoint(before, 4, res.p);
    expect(moved.map(custom)).toEqual(before.map(custom));
    expect([moved[4].x, moved[4].z]).toEqual(res.p);
    const deleted = deletePoint(moved, 7);
    expect(deleted.map(custom)).toEqual(before.filter((_, i) => i !== 7).map(custom));
  });

  it("a Quick session round-trips the custom values unchanged", () => {
    const t = customTrack();
    const draft = draftFromDoc(t);
    const lw = draft.design.laneWidth ?? 2;
    let points = insertPoint("quick", draft.design.points, 0, [(draft.design.points[0].x + draft.design.points[1].x) / 2, (draft.design.points[0].z + draft.design.points[1].z) / 2]);
    points = movePoint(points, 1, [points[1].x + 0.25, points[1].z]);
    points = deletePoint(points, 1); // the new corner goes again
    // move custom corners away and back, the way a drag does (pinned hall corners follow, then return)
    for (const i of [0, 5, 11]) {
      const origin = points;
      const pinned = pinnedCorners(origin, draft.area, lw, i);
      const { p } = snapCentre([origin[i].x - 0.5, origin[i].z + 0.5], { area: draft.area, points: origin, laneWidth: lw, i, mode: "lanes" });
      let moved = movePoint(origin, i, p);
      if (pinned.size) moved = keepPinned(moved, pinned, lw, origin);
      moved = movePoint(moved, i, [origin[i].x, origin[i].z]);
      if (pinned.size) moved = keepPinned(moved, pinned, lw, origin);
      expect(moved.map(custom)).toEqual(origin.map(custom));
      points = moved;
    }
    const doc = toDoc({ ...draft, design: { ...draft.design, points } }, { id: t.id, revision: t.revision, doc: t });
    expect(doc.design.points.map(custom)).toEqual(t.design.points.map(custom));
    doc.design.points.forEach((q, k) => {
      expect(q.x).toBeCloseTo(t.design.points[k].x, 6);
      expect(q.z).toBeCloseTo(t.design.points[k].z, 6);
    });
    expect(doc.design.laneWidth).toBe(t.design.laneWidth);
  });
});

describe("press and drag on a straight", () => {
  const area = { length: 22, width: 12 };
  const loop = [{ x: -10, z: -5 }, { x: 10, z: -5 }, { x: 10, z: 5 }, { x: -10, z: 5 }];
  it("adds a corner on the straight under the pointer, ready to drag", () => {
    const r = pressOnStraight("quick", loop, [3.1, -4.7], "lanes", area, 2, 1000);
    expect(r.i).toBe(1);
    expect(r.points).toHaveLength(5);
    expect(r.points[1].z).toBe(-5);
    expect(r.points[1]).toEqual({ x: r.at[0], z: r.at[1] });
  });
  it("adding and dragging the corner is one undo step", () => {
    const r = pressOnStraight("quick", loop, [3.1, -4.7], "lanes", area, 2, 1000);
    const set = (s: HistoryState<typeof loop>, next: typeof loop, now: number) => historyReducer(s, { type: "set", next, group: r.group, now });
    let s: HistoryState<typeof loop> = { past: [], present: loop, future: [], group: null, at: 0 };
    s = set(s, r.points, 1000);
    for (let k = 1; k <= 5; k++) s = set(s, movePoint(s.present, r.i, [r.at[0], r.at[1] + k]), 1000 + k * 2000);
    expect(s.present[r.i]).toMatchObject({ z: 0 });
    s = historyReducer(s, { type: "undo" });
    expect(s.present).toBe(loop);
    expect(s.past).toEqual([]);
  });
});

describe("checks in Quick and Advanced", () => {
  const checks: Check[] = [
    { level: "info", code: "radius-reduced", x: 0, z: 0, message: "Corner radius reduced" },
    { level: "warning", code: "tight-corner", x: 1, z: 1, message: "Tight" },
    { level: "error", code: "outside-area", x: 2, z: 2, message: "Outside" },
  ];

  it("Quick hides info; both list errors first", () => {
    expect(visibleChecks(checks, "quick").map((c) => c.level)).toEqual(["error", "warning"]);
    expect(visibleChecks(checks, "advanced").map((c) => c.level)).toEqual(["error", "warning", "info"]);
    expect(checkCounts(checks)).toEqual({ errors: 1, warnings: 1 });
  });

  it("draws errors as a section of the lane and warnings as a ring; never info", () => {
    const t = ref<RcTrack>("examples/club-a.rctrack.json");
    const b = bakeBuilt(t);
    const on = b.racingLine[20];
    const marks = problemMarks(
      [
        { level: "error", code: "outside-area", x: on[0], z: on[1], message: "e" },
        { level: "warning", code: "tight-corner", x: on[0], z: on[1], message: "w" },
        { level: "info", code: "radius-reduced", x: on[0], z: on[1], message: "i" },
        { level: "error", code: "obstacle", x: 100, z: 100, message: "far off the lane" },
      ],
      b.racingLine,
    );
    expect(marks.map((m) => [m.level, m.kind, m.index])).toEqual([
      ["error", "section", 0],
      ["warning", "ring", 1],
      ["error", "ring", 3],
    ]);
    const sec = marks[0];
    if (sec.kind !== "section") throw new Error("expected a section");
    // about 3 m of lane centred on the problem
    let len = 0;
    for (let k = 1; k < sec.points.length; k++) len += Math.hypot(sec.points[k][0] - sec.points[k - 1][0], sec.points[k][1] - sec.points[k - 1][1]);
    expect(len).toBeGreaterThan(2.4);
    expect(len).toBeLessThan(3.2);
    expect(sec.points.some((p) => Math.hypot(p[0] - on[0], p[1] - on[1]) < 1e-9)).toBe(true);
  });

  it("a section wraps round the start of the line", () => {
    const t = ref<RcTrack>("examples/club-a.rctrack.json");
    const b = bakeBuilt(t);
    const [m] = problemMarks([{ level: "error", code: "outside-area", x: b.racingLine[0][0], z: b.racingLine[0][1], message: "e" }], b.racingLine);
    if (m.kind !== "section") throw new Error("expected a section");
    expect(m.points.length).toBeGreaterThan(2);
    for (let k = 1; k < m.points.length; k++) expect(Math.hypot(m.points[k][0] - m.points[k - 1][0], m.points[k][1] - m.points[k - 1][1])).toBeLessThan(1);
  });
});

describe("Submit", () => {
  const pts: DesignPoint[] = [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 10, z: 5 },
  ];
  const base = { dirty: false, pending: false, points: pts };

  it("is open with no errors, even with warnings", () => {
    expect(submitBlock({ ...base, checks: [{ level: "warning", code: "tight-corner", x: 0, z: 0, message: "w" }] })).toBeNull();
  });

  it("says what to fix while errors exist, naming the nearest corner", () => {
    const msg = submitBlock({ ...base, checks: [{ level: "error", code: "outside-area", x: 10.5, z: 5.2, message: "Track goes outside the venue's track area" }] });
    expect(msg).toBe("Submit is waiting on 1 error. Move corner 3 back inside the track area to fix it.");
    const two = submitBlock({
      ...base,
      checks: [
        { level: "error", code: "obstacle", x: 0.2, z: 0.1, message: "Track overlaps a fixed obstacle" },
        { level: "error", code: "outside-area", x: 30, z: 30, message: "Track goes outside the venue's track area" },
      ],
    });
    expect(two).toBe("Submit is waiting on 2 errors. Move corner 1 so the track clears the fixed obstacle to fix it.");
    expect(submitBlock({ ...base, checks: [{ level: "error", code: "outside-area", x: 30, z: 30, message: "x" }] })).toBe(
      "Submit is waiting on 1 error. Move the track back inside the track area to fix it.",
    );
  });

  it("errors block even with unsaved changes, and say so first", () => {
    expect(submitBlock({ ...base, dirty: true, pending: true, checks: [{ level: "error", code: "outside-area", x: 30, z: 30, message: "x" }] })).toMatch(/^Submit is waiting on 1 error\./);
  });

  it("asks to save first, and waits for the checks", () => {
    expect(submitBlock({ ...base, dirty: true, checks: [] })).toBe("Save your changes before submitting.");
    expect(submitBlock({ ...base, pending: true, checks: [] })).toBe("Checking the track…");
  });
});
