// Quick mode step 1 (#38): the lane-width grid, painting, closing the loop and what it bakes.
import { bakeBuilt, type Built, type Obstacle, type RcTrack, type RcVenue } from "@track-studio/engine";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { draftFromDoc, newDraft, toDoc, type Draft } from "../src/designer/Designer.js";
import { historyReducer, type HistoryState } from "../src/designer/history.js";
import {
  cellAt,
  cellCentre,
  designStep,
  gridFor,
  isLoop,
  key,
  laneGrid,
  loopPoints,
  paintTo,
  stepsBetween,
  withLaying,
  type Cell,
  type LaneGrid,
  type Laying,
} from "../src/designer/lanes.js";

const ref = <T,>(p: string) => JSON.parse(readFileSync(join(__dirname, "../../../reference", p), "utf8")) as T;
const VENUES = ["club-hall", "small-hall", "sports-hall-b"].map((n) => ref<RcVenue>(`venues/${n}.rcvenue.json`));
const venue = (file: string) => VENUES[["club-hall", "small-hall", "sports-hall-b"].indexOf(file)];
const blocked = (g: LaneGrid) => [...g.blocked].sort();

const empty: Laying = { cells: [], closed: false };

/** Paint through `targets` in turn, as drags; every state along the way, in order. */
function paintAll(g: LaneGrid, targets: Cell[], from: Laying = empty): Laying[] {
  const states: Laying[] = [];
  let lay = from;
  for (const t of targets) {
    const r = paintTo(g, lay, t);
    expect(r.refused, `painting to ${t}`).toBeUndefined();
    states.push(...r.states);
    lay = states[states.length - 1] ?? lay;
  }
  return states;
}
const last = (s: Laying[]) => s[s.length - 1];

/** a doc from a venue with the given lane laid and closed */
function laidDoc(v: RcVenue, targets: Cell[], laneWidth = 2): RcTrack {
  const d0 = newDraft({ area: v.area, obstacles: v.obstacles ?? [], name: "test", laneWidth });
  const lay = last(paintAll(gridFor(d0), targets));
  expect(lay.closed).toBe(true);
  const d = withLaying(d0, lay);
  expect(designStep(d)).toBe(2);
  return toDoc(d);
}

/** the loop round the edge of the grid, leaving out columns at the east end until none of its squares is blocked */
function edgeLoop(g: LaneGrid): Cell[] {
  for (let C = g.cols; C >= 3; C--) {
    const R = g.rows;
    const ring: Cell[] = [];
    for (let c = 0; c < C; c++) ring.push([c, 0], [c, R - 1]);
    for (let r = 0; r < R; r++) ring.push([0, r], [C - 1, r]);
    if (ring.some((c) => g.blocked.has(`${c[0]},${c[1]}`))) continue;
    return [[0, 0], [C - 1, 0], [C - 1, R - 1], [0, R - 1], [0, 0]];
  }
  throw new Error("no clear edge loop");
}

/** Closest approach between two parts of the racing line at least `apart` metres apart along it. */
function closestApproach(b: Built, apart: number): number {
  const L = b.racingLine;
  const s = [0];
  for (let i = 1; i < L.length; i++) s.push(s[i - 1] + Math.hypot(L[i][0] - L[i - 1][0], L[i][1] - L[i - 1][1]));
  const total = b.lapLength;
  let best = Infinity;
  for (let i = 0; i < L.length; i++)
    for (let j = i + 1; j < L.length; j++) {
      const along = Math.min(s[j] - s[i], total - (s[j] - s[i]));
      if (along < apart) continue;
      best = Math.min(best, Math.hypot(L[i][0] - L[j][0], L[i][1] - L[j][1]));
    }
  return best;
}

describe("the lane-width grid", () => {
  it("covers each reference venue with whole lane-width squares from the south-west corner", () => {
    const club = laneGrid(venue("club-hall").area, [], 2); // 22 × 12
    expect([club.cols, club.rows, club.origin]).toEqual([11, 6, [-11, -6]]);
    const small = laneGrid(venue("small-hall").area, [], 2); // 20 × 11: the top 1 m strip isn't used
    expect([small.cols, small.rows, small.origin]).toEqual([10, 5, [-10, -5.5]]);
    const hallB = laneGrid(venue("sports-hall-b").area, [], 2); // 25 × 14: the east 1 m strip isn't used
    expect([hallB.cols, hallB.rows, hallB.origin]).toEqual([12, 7, [-12.5, -7]]);
    // other lane widths: 22 / 2.4 = 9.17, 12 / 2.4 = 5
    expect([laneGrid(venue("club-hall").area, [], 2.4).cols, laneGrid(venue("club-hall").area, [], 2.4).rows]).toEqual([9, 5]);
  });

  it("finds the square under a point, and nothing off the grid or in the unused strip", () => {
    const g = laneGrid(venue("small-hall").area, [], 2);
    expect(cellAt(g, [-9.9, -5.4])).toEqual([0, 0]);
    expect(cellAt(g, [9.9, 4.4])).toEqual([9, 4]);
    expect(cellAt(g, [0, 5])).toBeNull(); // in the 1 m strip along the north wall
    expect(cellAt(g, [-10.1, 0])).toBeNull();
    expect(cellCentre(g, [0, 0])).toEqual([-9, -4.5]);
  });

  it("blocks the squares the obstacles overlap", () => {
    for (const v of VENUES) {
      const g = laneGrid(v.area, v.obstacles ?? [], 2);
      if (!v.obstacles?.length) expect(g.blocked.size).toBe(0);
    }
    const g = laneGrid(venue("sports-hall-b").area, venue("sports-hall-b").obstacles ?? [], 2);
    // pillars at (±6, 1), r 0.35, sit on the line between rows 3 and 4; the fire exit fills x 10.5–12.5, z −7 to −4
    expect(blocked(g)).toEqual(["11,0", "11,1", "3,3", "3,4", "9,3", "9,4"]);
  });

  it("an obstacle within the pipes' 4 cm of a square blocks it; a turned one blocks what it reaches", () => {
    const area = { length: 10, width: 10 };
    // square [2, 2] is x and z −1 to 1: a box 5 cm short of its edges blocks only it
    const clear: Obstacle[] = [{ type: "rect", x: 0, z: 0, length: 1.9, width: 1.9, label: "Box" }];
    expect(blocked(laneGrid(area, clear, 2))).toEqual(["2,2"]);
    // filling it exactly, it touches its neighbours' edges, where their lanes' pipes would sit: they're blocked too
    const touching: Obstacle[] = [{ type: "rect", x: 0, z: 0, length: 2, width: 2, label: "Box" }];
    expect(blocked(laneGrid(area, touching, 2))).toEqual(["1,1", "1,2", "1,3", "2,1", "2,2", "2,3", "3,1", "3,2", "3,3"]);
    const turned: Obstacle[] = [{ type: "rect", x: 0, z: 0, length: 1.9, width: 1.9, rotation: 45, label: "Box" }]; // a diamond reaching 1.34 m
    expect(blocked(laneGrid(area, turned, 2))).toEqual(["1,2", "2,1", "2,2", "2,3", "3,2"]);
    const pillar: Obstacle[] = [{ type: "circle", x: -0.5, z: 0.5, radius: 0.4, label: "Pillar" }];
    expect(blocked(laneGrid(area, pillar, 2))).toEqual(["2,2"]);
    const onCorner: Obstacle[] = [{ type: "circle", x: -1, z: -1, radius: 0.3, label: "Pillar" }]; // where four squares meet
    expect(blocked(laneGrid(area, onCorner, 2))).toEqual(["1,1", "1,2", "2,1", "2,2"]);
  });

  it("so a lane next to an obstacle on a grid line can't be laid touching it, and the lanes the grid allows bake clean", () => {
    // a 2 × 2 m box filling square [3, 3] of the 22 × 12 hall (x −5 to −3, z 0 to 2)
    const v = { ...venue("club-hall"), obstacles: [{ type: "rect", x: -4, z: 1, length: 2, width: 2, label: "Box" }] as Obstacle[] };
    const g = laneGrid(v.area, v.obstacles, 2);
    expect(g.blocked.has("3,2")).toBe(true); // the square below it, and the one below and left, touching its corner
    expect(g.blocked.has("2,2")).toBe(true);
    expect(paintTo(g, last(paintAll(g, [[0, 2], [1, 2]])), [4, 2]).refused).toBe("blocked");
    // that lane would have put its pipe on the box
    const touching = toDoc(newDraft({ area: v.area, obstacles: v.obstacles, name: "t" }));
    touching.design.points = [{ x: -10, z: -5, radius: 1 }, { x: 10, z: -5, radius: 1 }, { x: 10, z: -1, radius: 1 }, { x: -10, z: -1, radius: 1 }];
    expect(bakeBuilt(touching).checks.map((c) => c.code)).toContain("obstacle");
    // one row further away is fine
    const b = bakeBuilt(laidDoc(v, [[0, 0], [10, 0], [10, 1], [0, 1], [0, 0]]));
    expect(b.checks.filter((c) => c.level === "error")).toEqual([]);
  });

  it("a turned rectangle blocks the squares the bake's obstacle check finds, turning counter-clockwise", () => {
    // 4 × 1 m centred in square [5, 3] of the 22 × 12 hall: at +30° its long side runs south-west to north-east, so
    // it reaches into [6, 4] and [4, 2]; turned the other way it would reach [6, 2] and [4, 4] instead
    const box = (rotation: number) => ({ ...venue("club-hall"), obstacles: [{ type: "rect", x: 0, z: 1, length: 4, width: 1, rotation, label: "Box" }] as Obstacle[] });
    const ne: Cell[] = [[6, 4], [10, 4], [10, 5], [6, 5], [6, 4]]; // a loop with its south-west square at [6, 4]
    const se: Cell[] = [[6, 2], [6, 0], [10, 0], [10, 2], [6, 2]]; // and one with its north-west square at [6, 2]
    for (const [rotation, free, hit] of [[30, se, ne], [-30, ne, se]] as const) {
      const v = box(rotation);
      const g = laneGrid(v.area, v.obstacles, 2);
      expect(g.blocked.has(key(hit[0])), `${rotation}°`).toBe(true);
      expect(paintTo(g, empty, hit[0]).refused).toBe("blocked");
      // the loop the grid allows bakes clean; the one through the blocked square, laid anyway, hits the obstacle
      expect(bakeBuilt(laidDoc(v, [...free])).checks.filter((c) => c.level === "error"), `${rotation}°`).toEqual([]);
      const forced = toDoc(newDraft({ area: v.area, obstacles: v.obstacles, name: "t" }));
      const open = laneGrid(v.area, [], 2);
      forced.design.points = loopPoints(open, last(paintAll(open, [...hit])).cells);
      expect(bakeBuilt(forced).checks.map((c) => c.code), `${rotation}°`).toContain("obstacle");
    }
    expect(blocked(laneGrid(box(30).area, box(30).obstacles, 2))).toEqual(["4,2", "4,3", "5,2", "5,3", "5,4", "6,3", "6,4"]);
  });
});

describe("painting the lane", () => {
  const g = laneGrid(venue("sports-hall-b").area, venue("sports-hall-b").obstacles ?? [], 2);

  it("lays a square per step through neighbouring squares", () => {
    const s = paintAll(g, [[0, 0], [1, 0], [1, 1]]);
    expect(s.map((x) => x.cells.length)).toEqual([1, 2, 3]);
    expect(last(s)).toEqual({ cells: [[0, 0], [1, 0], [1, 1]], closed: false });
  });

  it("fills a skipped gap one step at a time, along the larger axis first", () => {
    expect(stepsBetween([0, 0], [3, 1])).toEqual([[1, 0], [2, 0], [3, 0], [3, 1]]);
    expect(stepsBetween([0, 0], [1, 3])).toEqual([[0, 1], [0, 2], [0, 3], [1, 3]]);
    expect(stepsBetween([2, 2], [0, 2])).toEqual([[1, 2], [0, 2]]);
    const s = paintAll(g, [[0, 0], [3, 1]]);
    expect(s.map((x) => x.cells.length)).toEqual([1, 2, 3, 4, 5]); // one state (undo step) per square
    expect(last(s).cells).toEqual([[0, 0], [1, 0], [2, 0], [3, 0], [3, 1]]);
  });

  it("dragging back onto the previous square takes it up, a step at a time", () => {
    const laid = last(paintAll(g, [[0, 0], [4, 0]]));
    const back = paintTo(g, laid, [2, 0]);
    expect(back.states.map((x) => x.cells.length)).toEqual([4, 3]);
    expect(last(back.states).cells).toEqual([[0, 0], [1, 0], [2, 0]]);
    // and onwards again from there
    expect(last(paintTo(g, last(back.states), [2, 1]).states).cells).toEqual([[0, 0], [1, 0], [2, 0], [2, 1]]);
  });

  it("refuses a blocked square, and keeps what it laid before it", () => {
    expect(paintTo(g, empty, [11, 0])).toEqual({ states: [], refused: "blocked" });
    const r = paintTo(g, last(paintAll(g, [[8, 0]])), [11, 0]);
    expect(r.refused).toBe("blocked");
    expect(last(r.states).cells).toEqual([[8, 0], [9, 0], [10, 0]]);
  });

  it("refuses a square used already, and squares off the grid", () => {
    const laid = last(paintAll(g, [[0, 0], [2, 0], [2, 1], [1, 1]]));
    expect(paintTo(g, laid, [1, 0])).toEqual({ states: [], refused: "used" });
    expect(paintTo(g, empty, [12, 0]).refused).toBe("outside");
    expect(paintTo(g, empty, [0, -1]).refused).toBe("outside");
  });

  it("closes the loop coming back onto the first square once there are at least 4", () => {
    // 3 squares: the first square is the previous one, so stepping there takes up the last square instead
    const three = last(paintAll(g, [[0, 0], [1, 0], [1, 1]]));
    expect(paintTo(g, three, [0, 1]).states).toEqual([{ cells: [[0, 0], [1, 0], [1, 1], [0, 1]], closed: false }]);
    const four = last(paintAll(g, [[0, 0], [1, 0], [1, 1], [0, 1]]));
    const closed = paintTo(g, four, [0, 0]);
    expect(closed.states).toEqual([{ cells: four.cells, closed: true }]);
    expect(isLoop(four.cells)).toBe(true);
    // a closed lane takes no more paint
    expect(paintTo(g, closed.states[0], [5, 5]).states).toEqual([]);
  });

  it("each painted step is one undo step", () => {
    const d0 = newDraft({ area: venue("club-hall").area, obstacles: [], name: "t" });
    const grid = gridFor(d0);
    let h: HistoryState<Draft> = { past: [], present: d0, future: [], group: null, at: 0, travels: 0 };
    const states = paintAll(grid, [[0, 0], [2, 0], [2, 1], [3, 1], [3, 0]]); // paint, gap-fill, back-track
    states.push(...paintAll(grid, [[2, 2], [0, 2], [0, 0]], last(states))); // and close
    expect(last(states).closed).toBe(true);
    for (const s of states) h = historyReducer(h, { type: "set", next: withLaying(h.present, s), now: 1000 });
    expect(h.past.length).toBe(states.length);
    expect(designStep(h.present)).toBe(2);
    // undo the close: back to the open lane, one step from closing
    h = historyReducer(h, { type: "undo" });
    expect(designStep(h.present)).toBe(1);
    expect(h.present.laying).toEqual(states[states.length - 2].cells);
    // undo the back-track, then the square before it
    let u = h;
    for (let k = states.length - 2; k > 0; k--) {
      u = historyReducer(u, { type: "undo" });
      expect(u.present.laying).toEqual(states[k - 1].cells);
    }
    expect(historyReducer(u, { type: "undo" }).present.laying).toEqual([]);
  });
});

describe("closing the loop", () => {
  it("puts a corner at the centre of each square where the direction changes, x, z and radius only", () => {
    const g = laneGrid({ length: 22, width: 12 }, [], 2);
    const lay = last(paintAll(g, [[0, 0], [3, 0], [3, 2], [0, 2], [0, 0]]));
    expect(lay.closed).toBe(true);
    const pts = loopPoints(g, lay.cells);
    expect(pts).toEqual([
      { x: -10, z: -5, radius: 1 },
      { x: -4, z: -5, radius: 1 },
      { x: -4, z: -1, radius: 1 },
      { x: -10, z: -1, radius: 1 },
    ]);
    for (const p of pts) expect(Object.keys(p).sort()).toEqual(["radius", "x", "z"]);
  });

  it("a loop that starts in the middle of a straight puts no corner on its first square", () => {
    // an L, started at [3, 0] on the south side: the south straight (the longest) runs through the close
    const cells: Cell[] = [[3, 0], [10, 0], [10, 2], [5, 2], [5, 5], [0, 5], [0, 0], [3, 0]];
    const doc = laidDoc(venue("club-hall"), cells);
    const pts = doc.design.points;
    expect(pts).toHaveLength(6);
    expect(pts.some((p) => p.x === -4 && p.z === -5)).toBe(false); // [3, 0]'s centre
    expect(pts[0]).toEqual({ x: 10, z: -5, radius: 1 }); // the first corner after it, [10, 0]
    expect(pts[pts.length - 1]).toEqual({ x: -10, z: -5, radius: 1 }); // [0, 0]
    const b = bakeBuilt(doc);
    expect(b.checks.filter((c) => c.level === "error")).toEqual([]);
    // the start line is in the middle of the south straight, x −9 to 9, past the end of the points and round to point 0
    expect(b.startLine.x).toBeCloseTo(0, 2);
    expect(b.startLine.z).toBeCloseTo(-5, 2);
    // 6 quarter turns of r 1 and the straights 2, 8, 4, 8, 8, then half of 18
    expect(doc.design.start?.distance).toBeCloseTo((6 * Math.PI) / 2 + 30 + 9, 3);
  });

  it("radius = half the lane width (an apex radius of 0)", () => {
    const g = laneGrid({ length: 22, width: 12 }, [], 2.4);
    const lay = last(paintAll(g, [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]));
    expect(loopPoints(g, lay.cells).every((p) => p.radius === 1.2)).toBe(true);
  });

  it("new designs (template and blank) open in step 1; existing tracks in step 2", () => {
    const v = venue("sports-hall-b");
    const fromVenue = newDraft({ area: v.area, obstacles: v.obstacles ?? [], name: "t", basedOn: { venueTemplate: v.id, revision: v.revision }, rostrum: v.rostrum });
    const blank = newDraft({ area: { length: 30, width: 15 }, obstacles: [], name: "t" });
    for (const d of [fromVenue, blank]) {
      expect(designStep(d)).toBe(1);
      expect(d.design.points).toEqual([]);
    }
    for (const n of ["club-a", "freeform-example", "freeform-at-sports-hall-b"]) expect(designStep(draftFromDoc(ref<RcTrack>(`examples/${n}.rctrack.json`)))).toBe(2);
  });

  it("only writes x, z and radius on points, and the rest of the file stays the format", () => {
    const doc = laidDoc(venue("club-hall"), [[0, 0], [10, 0], [10, 5], [0, 5], [0, 0]]);
    expect("laying" in doc).toBe(false);
    for (const p of doc.design.points) expect(Object.keys(p).sort()).toEqual(["radius", "x", "z"]);
    expect(bakeBuilt(doc).lapLength).toBeGreaterThan(0);
  });

  for (const v of VENUES) {
    it(`a loop round the edge of ${v.info.name} bakes with no outside-area or obstacle errors`, () => {
      const g = laneGrid(v.area, v.obstacles ?? [], 2);
      const b = bakeBuilt(laidDoc(v, edgeLoop(g)));
      expect(b.checks.filter((c) => c.level === "error")).toEqual([]);
      expect(b.checks.some((c) => c.code === "outside-area")).toBe(false);
    });
  }

  it("a hairpin made of two adjacent turns bakes with no lane overlap", () => {
    const v = venue("club-hall");
    // round the edge, with a hairpin dipping down columns 6 and 5 from the north side
    const doc = laidDoc(v, [[0, 0], [10, 0], [10, 5], [6, 5], [6, 2], [5, 2], [5, 5], [0, 5], [0, 0]]);
    const b = bakeBuilt(doc);
    expect(b.checks.filter((c) => c.level === "error")).toEqual([]);
    // the two legs of the hairpin are a lane apart (centre to centre): parts of the line further apart along the
    // lap than half way round the hairpin's turn are never closer than one lane width
    const w = 2;
    expect(closestApproach(b, (Math.PI * w) / 2 + 0.3)).toBeGreaterThanOrEqual(w - 0.02);
    // the check itself does find an overlap: the same hairpin with its legs half a lane apart
    const squeezed = structuredClone(doc);
    squeezed.design.points = squeezed.design.points.map((p) => (p.x === 2 ? { ...p, x: 1 } : p)); // column 6's corners
    expect(closestApproach(bakeBuilt(squeezed), (Math.PI * w) / 2 + 0.3)).toBeLessThan(w - 0.5);
  });

  it("the start line goes in the middle of the longest straight", () => {
    const doc = laidDoc(venue("club-hall"), [[0, 0], [10, 0], [10, 5], [0, 5], [0, 0]]);
    const b = bakeBuilt(doc);
    // the south straight, from x = -10 + 1 to 10 - 1, centre (0, -5)
    expect(b.startLine.x).toBeCloseTo(0, 2);
    expect(b.startLine.z).toBeCloseTo(-5, 2);
  });
});
