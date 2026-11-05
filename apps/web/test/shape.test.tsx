// Quick mode step 2 (#39): shaping corners, cutting them back by apex radius, adding and deleting.
import { bakeBuilt, racingLine, type DesignPoint, type RcTrack, type RcVenue } from "@track-studio/engine";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { draftFromDoc, newDraft, SelectionPanel, toDoc, type Draft } from "../src/designer/Designer.js";
import { liveGeometry } from "../src/designer/geometry.js";
import { historyReducer, type HistoryState } from "../src/designer/history.js";
import { designStep, gridFor, paintTo, reopenLaying, withLaying, type Cell, type Laying } from "../src/designer/lanes.js";
import { movePoint } from "../src/designer/mode.js";
import {
  alongBisector,
  APEX_MAX,
  apexOf,
  apexRadius,
  deleteCorner,
  handleDistance,
  handlePoint,
  insertAfter,
  insertNearTrack,
  isReduced,
  laneLines,
  placeCorner,
  QUICK_SIZES,
  radiusForApex,
  radiusFromDrag,
  setApex,
  turnLabel,
} from "../src/designer/shape.js";

const ref = <T,>(p: string) => JSON.parse(readFileSync(join(__dirname, "../../../reference", p), "utf8")) as T;
const clubHall = ref<RcVenue>("venues/club-hall.rcvenue.json");

/** paint through `targets` on the venue's grid, every state along the way */
function paint(d: Draft, targets: Cell[]): Laying[] {
  const g = gridFor(d);
  const out: Laying[] = [];
  let lay: Laying = { cells: [], closed: false };
  for (const t of targets) {
    const r = paintTo(g, lay, t);
    expect(r.refused).toBeUndefined();
    out.push(...r.states);
    lay = out[out.length - 1] ?? lay;
  }
  return out;
}

/** a club-hall draft with the lane laid and closed (step 2) */
function laid(targets: Cell[]): Draft {
  const d0 = newDraft({ area: clubHall.area, obstacles: [], name: "t" });
  const states = paint(d0, targets);
  return states.reduce((d, s) => withLaying(d, s), d0);
}

/** the Board's standard test track: round the edge of the club hall, with a hairpin pair dipping in from the south */
const TEST_TRACK: Cell[] = [[0, 0], [6, 0], [6, 3], [7, 3], [7, 0], [10, 0], [10, 5], [0, 5], [0, 0]];

/** a square: (0,0) → (10,0) → (10,10) → (0,10), turning left (counter-clockwise) at each corner */
const SQUARE: DesignPoint[] = [
  { x: 0, z: 0, radius: 1 },
  { x: 10, z: 0, radius: 1 },
  { x: 10, z: 10, radius: 1 },
  { x: 0, z: 10, radius: 1 },
];

describe("the apex handle", () => {
  it("sits in the middle of the inside edge: P + b · (r/cos(θ/2) − r + w/2)", () => {
    const a = apexOf(SQUARE, 1, 2)!;
    expect(a.th).toBeCloseTo(Math.PI / 2, 9);
    // a left turn at (10, 0) from east to north: the inside is up and to the left
    expect(a.b[0]).toBeCloseTo(-Math.SQRT1_2, 9);
    expect(a.b[1]).toBeCloseTo(Math.SQRT1_2, 9);
    const r = 3;
    const d = r / Math.cos(Math.PI / 4) - r + 1;
    expect(handleDistance(r, a.th, a.w)).toBeCloseTo(d, 9);
    const h = handlePoint(a, r);
    expect(h[0]).toBeCloseTo(10 - d * Math.SQRT1_2, 9);
    expect(h[1]).toBeCloseTo(d * Math.SQRT1_2, 9);
    // which is where the engine's inside edge is: r − w/2 from the arc's centre, at (10 − r, r)
    expect(Math.hypot(h[0] - (10 - r), h[1] - r)).toBeCloseTo(r - 1, 9);
  });

  it("dragged to distance d sets r = (d − w/2) / (1/cos(θ/2) − 1), so the handle lands back under the pointer", () => {
    const a = apexOf(SQUARE, 1, 2)!;
    for (const apex of [0, 0.6, 1.8, 4, 4.5]) {
      const r = apex + 1;
      const d = handleDistance(r, a.th, a.w);
      expect(radiusFromDrag(d, a.th, a.w)).toBeCloseTo(r, 2);
      expect(apexRadius({ x: 0, z: 0, radius: radiusFromDrag(d, a.th, a.w) }, 2)).toBeCloseTo(apex, 2);
    }
    // the drag distance is measured along the bisector: sideways movement doesn't count
    const q = handlePoint(a, 3);
    expect(alongBisector(a, [q[0] + a.b[1] * 2, q[1] - a.b[0] * 2])).toBeCloseTo(handleDistance(3, a.th, a.w), 9);
  });

  it("works for a 45° corner too, and a right turn", () => {
    const pts: DesignPoint[] = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 20, z: -10 }, { x: 10, z: -20 }];
    const a = apexOf(pts, 1, 2)!;
    expect((a.th * 180) / Math.PI).toBeCloseTo(45, 9);
    expect(a.b[1]).toBeLessThan(0); // turning right (south): the inside is to the south
    const d = handleDistance(5.5, a.th, 2);
    expect(radiusFromDrag(d, a.th, 2)).toBeCloseTo(5.5, 2);
  });

  it("keeps the apex radius between 0 and 9 m", () => {
    const a = apexOf(SQUARE, 1, 2)!;
    expect(radiusFromDrag(0, a.th, 2)).toBe(1); // dragged onto the corner point: apex 0
    expect(radiusFromDrag(-3, a.th, 2)).toBe(1);
    expect(radiusFromDrag(100, a.th, 2)).toBe(APEX_MAX + 1);
    expect(radiusFromDrag(handleDistance(20, a.th, 2), a.th, 2)).toBe(APEX_MAX + 1);
  });

  it("moves neither the corner point nor its neighbours", () => {
    const a = apexOf(SQUARE, 1, 2)!;
    const r = radiusFromDrag(handleDistance(5, a.th, 2), a.th, 2);
    const after = setApex(SQUARE, 1, r - 1, 2);
    after.forEach((p, k) => {
      expect([p.x, p.z]).toEqual([SQUARE[k].x, SQUARE[k].z]);
      if (k !== 1) expect(p).toEqual(SQUARE[k]);
    });
    expect(after[1]).toEqual({ x: 10, z: 0, radius: 5 });
  });

  it("has no handle where the line runs straight through a point", () => {
    const pts: DesignPoint[] = [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 10, z: 0 }, { x: 5, z: 5 }];
    expect(apexOf(pts, 1, 2)).toBeNull();
    expect(apexOf(pts, 0, 2)).not.toBeNull();
  });
});

describe("apex radius in numbers", () => {
  it("writes r = apex + w/2 with the corner's own lane width, and only the radius", () => {
    expect(radiusForApex(1.8, 2)).toBe(2.8);
    expect(radiusForApex(0, 2.4)).toBe(1.2);
    expect(radiusForApex(12, 2)).toBe(10);
    expect(radiusForApex(-1, 2)).toBe(1);
    const custom: DesignPoint[] = SQUARE.map((p, i) => (i === 2 ? { ...p, width: 2.4, outer: "square" } : p));
    expect(setApex(custom, 2, 0.6, 2)[2]).toEqual({ x: 10, z: 10, radius: 1.8, width: 2.4, outer: "square" });
    expect(apexRadius({ x: 0, z: 0, radius: 1.8, width: 2.4 }, 2)).toBe(0.6);
    // the engine's default radius (1) with a 2.4 m lane is below w/2: the apex reads as 0
    expect(apexRadius({ x: 0, z: 0 }, 2.4)).toBe(0);
  });

  it("offers Hairpin 0, Tight 0.6, Medium 1.8 and Sweeper 4.0 m", () => {
    expect(QUICK_SIZES.map((s) => [s.label, s.apex])).toEqual([["Hairpin", 0], ["Tight", 0.6], ["Medium", 1.8], ["Sweeper", 4]]);
  });

  it("names the turn", () => {
    expect(turnLabel(SQUARE, 1)).toBe("90° left");
    expect(turnLabel([...SQUARE].reverse(), 1)).toBe("90° right");
    expect(turnLabel([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 20, z: -10 }, { x: 0, z: -10 }], 1)).toBe("45° right");
  });

  it("shows (max) when the engine cut the radius down to fit, by #37's rule", () => {
    const pts = setApex(SQUARE, 1, 8, 2); // r 9 on 10 m straights next to r 1 corners: 9 + 1 = 10 fits exactly
    const { corners } = racingLine(pts, 2);
    expect(isReduced(pts[1], corners[1])).toBe(false);
    const big = setApex(SQUARE, 1, 9, 2); // r 10 + 1 > 10
    const c2 = racingLine(big, 2).corners;
    expect(isReduced(big[1], c2[1])).toBe(true);
    expect(c2[1].r).toBeCloseTo((10 * 10) / 11, 3);
    // and it agrees with the bake's radius-reduced check
    const doc = toDoc(laid(TEST_TRACK));
    doc.design.points = setApex(doc.design.points, 0, 9, 2);
    const b = bakeBuilt(doc);
    const lc = racingLine(doc.design.points, 2).corners;
    doc.design.points.forEach((p, i) => {
      const flagged = b.checks.some((c) => c.code === "radius-reduced" && c.x === p.x && c.z === p.z);
      expect(isReduced(p, lc[i]), `corner ${i}`).toBe(flagged);
    });
  });
});

describe("the selected corner's panel (Quick)", () => {
  const panel = (d: Draft, i: number, update: (fn: (d: Draft) => Draft, group?: string) => void = () => {}) =>
    renderToStaticMarkup(<SelectionPanel sel={{ kind: "point", i }} view="quick" draft={d} live={liveGeometry(d.design)} update={update} onDelete={() => {}} inCorner={new Set()} />);

  it("shows the turn, the apex radius to 0.1 m and the quick sizes, with the current one pressed", () => {
    const d = laid(TEST_TRACK);
    const h = panel({ ...d, design: { ...d.design, points: setApex(d.design.points, 0, 1.8, 2) } }, 0);
    expect(h).toContain("Corner 1");
    expect(h).toMatch(/90° (left|right)/);
    expect(h).toMatch(/Apex radius[\s\S]*value="1.8"/);
    for (const l of ["Hairpin", "Tight", "Medium", "Sweeper"]) expect(h).toContain(l);
    expect(h).toMatch(/aria-pressed="true"[^>]*>Medium/);
    expect(h).not.toContain("(max)");
    expect(h).not.toMatch(/Radius<|Lane width|Outside corner/); // no Advanced controls
  });

  it("says when the corner is cut back as far as the straights allow, with the apex it got", () => {
    const d = laid(TEST_TRACK);
    const pts = setApex(d.design.points, 0, 9, 2);
    const c = racingLine(pts, 2).corners[0];
    const h = panel({ ...d, design: { ...d.design, points: pts } }, 0);
    expect(h).toContain("Cut back as far as the straights allow");
    expect(h).toContain(`${Math.round((c.r - 1) * 10) / 10} m (max)`);
  });
});

describe("moving a corner", () => {
  const area = { length: 22, width: 12 };
  it("lane lines go through the centres of step 1's squares", () => {
    expect(laneLines(area, 2)).toEqual({ x: [-10, -8, -6, -4, -2, 0, 2, 4, 6, 8, 10], z: [-5, -3, -1, 1, 3, 5] });
  });

  it("snaps to a lane line within 0.2 m, each way on its own", () => {
    expect(placeCorner([2.15, 0.3], area, 2, false)).toEqual({ p: [2, 0.3], snapped: true });
    expect(placeCorner([2.25, 0.85], area, 2, false)).toEqual({ p: [2.25, 1], snapped: true });
    expect(placeCorner([1.81, 2.81], area, 2, false)).toEqual({ p: [2, 3], snapped: true });
    expect(placeCorner([2.5, 2], area, 2, false)).toEqual({ p: [2.5, 2], snapped: false });
  });

  it("goes anywhere with Alt (free), but stays in the area", () => {
    expect(placeCorner([2.15, 0.9], area, 2, true)).toEqual({ p: [2.15, 0.9], snapped: false });
    expect(placeCorner([30, -9], area, 2, true).p).toEqual([11, -6]);
  });

  it("writes only x and z", () => {
    const pts: DesignPoint[] = [{ x: 0, z: 0, radius: 2, width: 2.4, outer: "round" }, ...SQUARE.slice(1)];
    expect(movePoint(pts, 0, [1, 1])[0]).toEqual({ x: 1, z: 1, radius: 2, width: 2.4, outer: "round" });
  });
});

describe("adding and deleting corners", () => {
  it("adds straight after the selected corner, an apex radius of 0, and selects it", () => {
    const r = insertAfter(SQUARE, 1, [14, 5], 2)!;
    expect(r.index).toBe(2);
    expect(r.points).toHaveLength(5);
    expect(r.points[2]).toEqual({ x: 14, z: 5, radius: 1 });
    expect(r.points.filter((_, k) => k !== 2)).toEqual(SQUARE);
    // tapping round lays corners in order: the next one goes after the new one
    const r2 = insertAfter(r.points, r.index, [12, 9], 2)!;
    expect(r2.index).toBe(3);
    expect(r2.points.slice(2, 4).map((p) => [p.x, p.z])).toEqual([[14, 5], [12, 9]]);
  });

  it("refuses a corner on top of a neighbour", () => {
    expect(insertAfter(SQUARE, 1, [10.1, 0], 2)).toBeNull();
  });

  it("with nothing selected, a tap within 1.5 lane widths of the track goes into that part of it", () => {
    const r = insertNearTrack(SQUARE, [5, 2], 2, 2)!; // near the south straight, (0,0) → (10,0)
    expect(r.index).toBe(1);
    expect(r.points[1]).toEqual({ x: 5, z: 2, radius: 1 });
    expect(insertNearTrack(SQUARE, [12.5, 5], 2.5, 2)!.index).toBe(2); // the east straight
    expect(insertNearTrack(SQUARE, [5, 5], 3.01, 2)).toBeNull(); // too far from the track
  });

  it("deletes the selected corner so its neighbours' straights join; a loop keeps 3", () => {
    const five = insertAfter(SQUARE, 1, [14, 5], 2)!.points;
    expect(deleteCorner(five, 2)).toEqual(SQUARE);
    expect(deleteCorner(SQUARE, 0)).toHaveLength(3);
    expect(deleteCorner(SQUARE.slice(0, 3), 0)).toBeNull();
  });
});

describe("undo and going back to step 1", () => {
  const set = (h: HistoryState<Draft>, next: Draft, group?: string) => historyReducer(h, { type: "set", next, group, now: 1000 });

  it("insert, insert-near-track and delete are one undo step each; undo past the first shaping step reopens the loop", () => {
    const d0 = newDraft({ area: clubHall.area, obstacles: [], name: "t" });
    const states = paint(d0, TEST_TRACK);
    let h: HistoryState<Draft> = { past: [], present: d0, future: [], group: null, at: 0 };
    for (const s of states) h = set(h, withLaying(h.present, s));
    expect(designStep(h.present)).toBe(2);
    const closed = h.present;
    const withPoints = (pts: DesignPoint[]) => ({ ...h.present, design: { ...h.present.design, points: pts } });
    const pts = closed.design.points;
    h = set(h, withPoints(insertAfter(pts, 1, [3, -3], 2)!.points), `drag:insert:1`);
    h = set(h, withPoints(insertNearTrack(h.present.design.points, [-10, 0], 0, 2)!.points), `drag:insert:2`);
    h = set(h, withPoints(deleteCorner(h.present.design.points, 0)!), `delete:3`);
    h = set(h, withPoints(setApex(h.present.design.points, 0, 1.8, 2)), `apex:0`);
    for (let k = 0; k < 4; k++) h = historyReducer(h, { type: "undo" });
    expect(h.present).toBe(closed);
    h = historyReducer(h, { type: "undo" });
    expect(designStep(h.present)).toBe(1);
    expect(h.present.laying).toEqual(states[states.length - 2].cells);
  });

  it("\"1 · Lay the lanes\" reopens the loop and throws the shaping away", () => {
    const d = laid(TEST_TRACK);
    expect(d.laid).toBeDefined();
    const shaped = { ...d, design: { ...d.design, points: setApex(d.design.points, 0, 4.5, 2) } };
    const back = reopenLaying(shaped);
    expect(designStep(back)).toBe(1);
    expect(back.design.points).toEqual([]);
    expect(back.laying).toEqual(d.laid);
    expect("laid" in back).toBe(false);
    // the reopened loop closes again with one more square, the same as before
    const again = paintTo(gridFor(back), { cells: back.laying!, closed: false }, TEST_TRACK[0]);
    expect(again.states).toEqual([{ cells: d.laid, closed: true }]);
    expect(withLaying(back, again.states[0]).design.points).toEqual(d.design.points);
    // a track that wasn't laid here starts from no squares
    expect(reopenLaying(draftFromDoc(ref<RcTrack>("examples/club-a.rctrack.json"))).laying).toEqual([]);
  });

  it("the laid squares never reach the file", () => {
    const doc = toDoc(laid(TEST_TRACK));
    expect("laid" in doc).toBe(false);
    expect("laying" in doc).toBe(false);
  });
});

describe("the file", () => {
  it("Quick → Advanced → Quick leaves it unchanged", () => {
    // the mode is a view preference kept on the device: it's not in the draft, so switching changes nothing
    for (const n of ["club-a", "freeform-example", "freeform-at-sports-hall-b"]) {
      const doc = ref<RcTrack>(`examples/${n}.rctrack.json`);
      const base = { id: doc.id, revision: doc.revision, doc };
      const d = draftFromDoc(doc);
      expect(JSON.stringify(d)).not.toMatch(/"mode"|quick|advanced/i);
      const once = toDoc(d, base);
      expect(toDoc(draftFromDoc(once), base)).toEqual(once);
      expect(once.design.points).toEqual(doc.design.points);
    }
  });

  it("Quick's edits write only x, z and radius on points", () => {
    const d = laid(TEST_TRACK);
    let pts = d.design.points;
    pts = movePoint(pts, 2, placeCorner([3.1, -2.9], d.area, 2, false).p);
    pts = setApex(pts, 0, 4.5, 2);
    pts = insertAfter(pts, 3, [5, 2], 2)!.points;
    pts = deleteCorner(pts, 5)!;
    for (const p of pts) expect(Object.keys(p).sort()).toEqual(["radius", "x", "z"]);
  });
});

describe("the Board's test", () => {
  it("a 4.5 m apex sweeper on the bottom-left corner, next to a hairpin pair, fits with no problems", () => {
    const d = laid(TEST_TRACK);
    const pts = d.design.points;
    const bl = pts.findIndex((p) => p.x === -10 && p.z === -5);
    expect(bl).toBeGreaterThanOrEqual(0);
    const doc = toDoc({ ...d, design: { ...d.design, points: setApex(pts, bl, 4.5, 2) } });
    expect(doc.design.points[bl].radius).toBe(5.5);
    const b = bakeBuilt(doc);
    expect(b.checks.filter((c) => c.level !== "info")).toEqual([]);
    expect(b.checks.filter((c) => c.code === "radius-reduced")).toEqual([]);
    // it really is a 4.5 m apex: the racing line's corner keeps its full radius
    expect(racingLine(doc.design.points, 2).corners[bl].r).toBeCloseTo(5.5, 6);
  });
});
