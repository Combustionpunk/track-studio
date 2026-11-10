// Quick mode step 1 (#38): the lane-width grid, painting, closing the loop and what it bakes.
import { bakeBuilt, venueCheck, type Built, type Obstacle, type RcTrack, type RcVenue } from "@track-studio/engine";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bridgeCrossing } from "../src/designer/crossings.js";
import { draftFromDoc, newDraft, toDoc, type Draft } from "../src/designer/Designer.js";
import { liveGeometry } from "../src/designer/geometry.js";
import { historyReducer, type HistoryState } from "../src/designer/history.js";
import {
  cellAt,
  cellCentre,
  designStep,
  dragCell,
  gridFor,
  isLoop,
  key,
  laneGrid,
  loopPoints,
  neighbours,
  paintTo,
  releaseStep,
  REFUSAL_TEXT,
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
  const d0 = newDraft({ area: v.area, name: "test", laneWidth });
  const lay = last(paintAll(gridFor(d0, v.obstacles), targets));
  expect(lay.closed).toBe(true);
  const d = withLaying(d0, lay);
  expect(designStep(d)).toBe(2);
  return toDoc(d);
}

/** errors of the track itself and of the venue check (1.7: obstacles and the area are the venue's) */
const errorsIn = (doc: RcTrack, v: RcVenue) => [...bakeBuilt(doc).checks, ...venueCheck(doc, v).checks].filter((c) => c.level === "error");

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
    const touching = toDoc(newDraft({ area: v.area, name: "t" }));
    touching.design.points = [{ x: -10, z: -5, radius: 1 }, { x: 10, z: -5, radius: 1 }, { x: 10, z: -1, radius: 1 }, { x: -10, z: -1, radius: 1 }];
    expect(venueCheck(touching, v).checks.map((c) => c.code)).toContain("obstacle");
    // one row further away is fine
    expect(errorsIn(laidDoc(v, [[0, 0], [10, 0], [10, 1], [0, 1], [0, 0]]), v)).toEqual([]);
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
      expect(errorsIn(laidDoc(v, [...free]), v), `${rotation}°`).toEqual([]);
      const forced = toDoc(newDraft({ area: v.area, name: "t" }));
      const open = laneGrid(v.area, [], 2);
      forced.design.points = loopPoints(open, last(paintAll(open, [...hit])).cells);
      expect(venueCheck(forced, v).checks.map((c) => c.code), `${rotation}°`).toContain("obstacle");
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

  it("fills a skipped gap one step at a time", () => {
    // in line with the end of the lane; a gap off the line fills corner to corner first (#82, "diagonal lanes" below)
    expect(stepsBetween([0, 0], [3, 0])).toEqual([[1, 0], [2, 0], [3, 0]]);
    expect(stepsBetween([1, 0], [1, 3])).toEqual([[1, 1], [1, 2], [1, 3]]);
    expect(stepsBetween([2, 2], [0, 2])).toEqual([[1, 2], [0, 2]]);
    const s = paintAll(g, [[0, 0], [3, 0], [3, 1]]);
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
    // [1, 0] could only be crossed, and straight on from it is off the grid (#91: said as a dead end)
    const laid = last(paintAll(g, [[0, 0], [2, 0], [2, 1], [1, 1]]));
    expect(paintTo(g, laid, [1, 0])).toEqual({ states: [], refused: "dead-end" });
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
    const d0 = newDraft({ area: venue("club-hall").area, name: "t" });
    const grid = gridFor(d0);
    let h: HistoryState<Draft> = { past: [], present: d0, future: [], group: null, at: 0, travels: 0 };
    const states = paintAll(grid, [[0, 0], [2, 0], [2, 1], [3, 1], [3, 0]]); // paint, gap-fill, back-track
    states.push(...paintAll(grid, [[3, 2], [2, 2], [0, 2], [0, 0]], last(states))); // back-track, and close
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
    const fromVenue = newDraft({ area: v.area, name: "t", drawnFor: { venueTemplate: v.id, name: v.info.name } });
    const blank = newDraft({ area: { length: 30, width: 15 }, name: "t" });
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
    it(`a loop round the edge of ${v.info.name} bakes with no errors, and none against the venue`, () => {
      const g = laneGrid(v.area, v.obstacles ?? [], 2);
      expect(errorsIn(laidDoc(v, edgeLoop(g)), v)).toEqual([]);
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
    // and so does the bake (1.9, #95): the squeezed legs are a lane-overlap error, the laid hairpin none
    expect(bakeBuilt(squeezed).checks.filter((c) => c.code === "lane-overlap").map((c) => c.level)).toEqual(["error"]);
    expect(b.checks.filter((c) => c.code === "lane-overlap")).toEqual([]);
  });

  it("the start line goes in the middle of the longest straight", () => {
    const doc = laidDoc(venue("club-hall"), [[0, 0], [10, 0], [10, 5], [0, 5], [0, 0]]);
    const b = bakeBuilt(doc);
    // the south straight, from x = -10 + 1 to 10 - 1, centre (0, -5)
    expect(b.startLine.x).toBeCloseTo(0, 2);
    expect(b.startLine.z).toBeCloseTo(-5, 2);
  });
});

describe("crossing itself (#79)", () => {
  const v = venue("club-hall");
  const g = laneGrid(v.area, [], 2); // 11 × 6
  // a figure of eight: east along row 2, round the north-east lobe, south down column 5 straight across [5, 2], round
  // the south-west lobe and back up to the first square
  const EIGHT: Cell[] = [[0, 2], [8, 2], [8, 5], [5, 5], [5, 0], [0, 0], [0, 2]];
  /** up to the square before the crossing on the second pass */
  const toCrossing = () => last(paintAll(g, [[0, 2], [8, 2], [8, 5], [5, 5], [5, 3]]));
  const at52 = (cells: Cell[]) => cells.filter((c) => c[0] === 5 && c[1] === 2).length;

  it("a figure of eight painted on the grid crosses straight over and closes", () => {
    const states = paintAll(g, EIGHT);
    const lay = last(states);
    expect(lay.closed).toBe(true);
    expect(at52(lay.cells)).toBe(2);
    expect(isLoop(lay.cells)).toBe(true);
    // one state (undo step) per square, the crossing too
    const open = states.slice(0, -1);
    expect(open.map((s) => s.cells.length)).toEqual(open.map((_, i) => i + 1));
    // a straight-through square has no corner: the crossing adds none
    const pts = loopPoints(g, lay.cells);
    expect(pts).toHaveLength(6);
    expect(pts.some((p) => p.x === 0 && p.z === -1)).toBe(false); // [5, 2]'s centre
  });

  it("refuses a crossing that turns on the second pass, and stops on the crossing", () => {
    expect(REFUSAL_TEXT.crossing).toBe("The lane can only cross itself straight across, at right angles.");
    // in from the north, out to the west or east
    const at = last(paintTo(g, toCrossing(), [5, 2]).states);
    expect(at.cells.slice(-2)).toEqual([[5, 3], [5, 2]]);
    expect(paintTo(g, at, [4, 2])).toEqual({ states: [], refused: "crossing" });
    expect(paintTo(g, at, [6, 2])).toEqual({ states: [], refused: "crossing" });
    // straight on is fine
    expect(paintTo(g, at, [5, 1]).refused).toBeUndefined();
    // one drag straight across lays the crossing and goes on
    expect(last(paintTo(g, toCrossing(), [5, 0]).states).cells.slice(-4)).toEqual([[5, 3], [5, 2], [5, 1], [5, 0]]);
  });

  it("refuses a crossing with nowhere to go straight on: it needs the lane to carry straight on", () => {
    expect(REFUSAL_TEXT["dead-end"]).toBe("A crossing needs the lane to carry straight on.");
    // [1, 0] is straight through, but straight on from it is off the grid
    const laid = last(paintAll(g, [[0, 0], [2, 0], [2, 1], [1, 1]]));
    expect(paintTo(g, laid, [1, 0]).refused).toBe("dead-end");
    // or onto a blocked square: a pillar in [2, 0]
    const pillar = laneGrid(v.area, [{ type: "circle", x: -6, z: -5, radius: 0.3, label: "Pillar" }], 2);
    expect(blocked(pillar)).toEqual(["2,0"]);
    const lane = last(paintAll(pillar, [[0, 1], [4, 1], [4, 3], [2, 3], [2, 2]]));
    expect(paintTo(pillar, lane, [2, 1]).refused).toBe("dead-end");
    // straight on onto the first square closes the loop: that's fine
    const closing = last(paintAll(g, [[2, 0], [0, 0], [0, 1], [4, 1], [4, 3], [2, 3], [2, 2]]));
    const r = paintTo(g, closing, [2, 0]);
    expect(r.refused).toBeUndefined();
    expect(last(r.states).closed).toBe(true);
    expect(isLoop(last(r.states).cells)).toBe(true);
  });

  it("refuses to cross a square where the first pass turns", () => {
    // [8, 2] is the first pass's corner; come back into it from the east
    const round = last(paintAll(g, [[0, 2], [8, 2], [8, 5], [10, 5], [10, 2], [9, 2]]));
    expect(paintTo(g, round, [8, 2])).toEqual({ states: [], refused: "crossing" });
    // the first pass's square next to its corner goes straight through: that one can be crossed
    expect(paintTo(g, last(paintAll(g, [[0, 2], [3, 2], [3, 4], [2, 4], [2, 3]])), [2, 2]).refused).toBeUndefined();
  });

  it("isLoop: a crossing square twice at right angles; not on the first square", () => {
    const eight = last(paintAll(g, EIGHT)).cells;
    expect(isLoop(eight)).toBe(true);
    // round a ring twice: every square used twice, the first one too
    const ring = last(paintAll(g, [[0, 0], [3, 0], [3, 3], [0, 3], [0, 0]])).cells;
    expect(isLoop([...ring, ...ring])).toBe(false);
    // the first square used twice: the figure of eight started on its crossing
    const k = eight.findIndex((c) => c[0] === 5 && c[1] === 2);
    expect(isLoop([...eight.slice(k), ...eight.slice(0, k)])).toBe(false);
  });

  // #91: hand-made loops whose squares all touch, so each is refused by the rule it's about and not for a gap
  const touching = (cells: Cell[]) => cells.every((c, i) => {
    const n = cells[(i + 1) % cells.length];
    return Math.abs(n[0] - c[0]) + Math.abs(n[1] - c[1]) === 1;
  });

  it("isLoop: two passes through a square in line, not at right angles", () => {
    // In a loop of touching squares two passes in line through a square are only possible back and forth along one
    // row (two passes the same way would need a turn on a shared square). Every rule but the right angle holds here.
    for (const there of [
      [[0, 0], [1, 0], [2, 0], [1, 0]],
      [[0, 1], [1, 1], [2, 1], [3, 1], [2, 1], [1, 1]],
    ] as Cell[][]) {
      expect(touching(there)).toBe(true);
      expect(isLoop(there)).toBe(false);
    }
  });

  it("isLoop: a third pass through a crossing", () => {
    // [1, 1]: east, then north, then south. (A third pass can't be the only thing wrong in a loop of touching squares:
    // two of the three are in line, which the turn or right-angle rule refuses too.)
    const third: Cell[] = [[0, 1], [1, 1], [2, 1], [1, 1], [1, 2], [1, 1], [1, 0], [0, 0]];
    expect(touching(third)).toBe(true);
    expect(isLoop(third)).toBe(false);
  });

  it("isLoop: a turn on the crossing square", () => {
    // [1, 1]: the first pass straight east, the second in from the east and away north, at right angles
    const turning: Cell[] = [[0, 1], [1, 1], [2, 1], [1, 1], [1, 2], [0, 2]];
    expect(touching(turning)).toBe(true);
    expect(isLoop(turning)).toBe(false);
  });

  it("back-tracking off a crossing takes up only the second pass, and the square is single-use again", () => {
    const at = last(paintTo(g, toCrossing(), [5, 2]).states);
    const back = paintTo(g, at, [5, 3]);
    expect(back.states).toHaveLength(1);
    expect(at52(last(back.states).cells)).toBe(1);
    expect(last(back.states).cells).toEqual(toCrossing().cells);
    // dragging back past it along the first pass takes that up too
    const firstPass = last(paintAll(g, [[0, 2], [7, 2]]));
    const undone = last(paintTo(g, firstPass, [4, 2]).states);
    expect(at52(undone.cells)).toBe(0);
  });

  it("dragging back off a crossing and on along the other pass works square by square", () => {
    // past the crossing, then back up across it: each step takes one square up
    const past = last(paintAll(g, [[0, 2], [8, 2], [8, 5], [5, 5], [5, 0]]));
    const back = paintTo(g, past, [5, 4]);
    expect(back.states.map((s) => s.cells.length)).toEqual([past.cells.length - 1, past.cells.length - 2, past.cells.length - 3, past.cells.length - 4]);
    expect(at52(last(back.states).cells)).toBe(1);
  });

  it("the painted figure of eight bakes with one crossing and no errors but crossing-unbridged", () => {
    const doc = laidDoc(v, EIGHT);
    const b = bakeBuilt(doc);
    expect(b.crossings).toHaveLength(1);
    expect(b.crossings![0].x).toBeCloseTo(0, 2);
    expect(b.crossings![0].z).toBeCloseTo(-1, 2);
    expect(errorsIn(doc, v).map((c) => c.code)).toEqual(["crossing-unbridged"]);
    for (const p of doc.design.points) expect(Object.keys(p).sort()).toEqual(["radius", "x", "z"]);
  });

  it("Make it a crossover bridges it, so the check clears; undo takes it away", () => {
    const doc = laidDoc(v, EIGHT);
    const c = bakeBuilt(doc).checks.find((k) => k.code === "crossing-unbridged")!;
    const live = liveGeometry(doc.design);
    type Doc = { features: NonNullable<RcTrack["design"]["features"]> };
    let h: HistoryState<Doc> = { past: [], present: { features: doc.design.features ?? [] }, future: [], group: null, at: 0, travels: 0 };
    h = historyReducer(h, { type: "set", next: { features: bridgeCrossing(h.present.features, c, live.crossings, live.total)!.features }, now: 1000 });
    const bridged = { ...doc, design: { ...doc.design, features: h.present.features } };
    expect(h.present.features).toEqual([{ type: "crossover", distance: live.crossings[0].distances[0], over: "first" }]);
    expect(errorsIn(bridged, v)).toEqual([]);
    expect(bakeBuilt(bridged).crossings![0].bridge).toMatchObject({ type: "crossover", feature: 0 });
    h = historyReducer(h, { type: "undo" });
    expect(h.present.features).toEqual([]);
  });

  it("each step through a crossing is one undo state, and undo past the close comes back to the open lane", () => {
    const d0 = newDraft({ area: v.area, name: "t" });
    const states = paintAll(gridFor(d0), EIGHT);
    let h: HistoryState<Draft> = { past: [], present: d0, future: [], group: null, at: 0, travels: 0 };
    for (const s of states) h = historyReducer(h, { type: "set", next: withLaying(h.present, s), now: 1000 });
    expect(h.past.length).toBe(states.length);
    expect(designStep(h.present)).toBe(2);
    h = historyReducer(h, { type: "undo" });
    expect(h.present.laying).toEqual(states[states.length - 2].cells);
    expect(at52(h.present.laying!)).toBe(2);
  });
});

describe("diagonal lanes (#82)", () => {
  const v = venue("club-hall");
  const g = laneGrid(v.area, [], 2); // 11 × 6
  // an octagon: east along row 0, corner to corner up to column 10, north, corner to corner to row 5, west, and so on
  // round; the last drag closes through a diagonal step onto the first square
  const OCTAGON: Cell[] = [[2, 0], [8, 0], [10, 2], [10, 3], [8, 5], [2, 5], [0, 3], [0, 2], [2, 0]];

  it("fills a fast drag's gap with diagonal steps while both axes differ, then straight", () => {
    expect(stepsBetween([0, 0], [3, 1])).toEqual([[1, 1], [2, 1], [3, 1]]);
    expect(stepsBetween([0, 0], [1, 3])).toEqual([[1, 1], [1, 2], [1, 3]]);
    expect(stepsBetween([4, 4], [1, 2])).toEqual([[3, 3], [2, 2], [1, 2]]);
    expect(stepsBetween([0, 0], [2, 2])).toEqual([[1, 1], [2, 2]]);
    expect(stepsBetween([2, 2], [0, 2])).toEqual([[1, 2], [0, 2]]); // in line: straight as before
    const s = paintAll(g, [[0, 0], [3, 1]]);
    expect(s.map((x) => x.cells.length)).toEqual([1, 2, 3, 4]); // one state (undo step) per square
    expect(last(s).cells).toEqual([[0, 0], [1, 1], [2, 1], [3, 1]]);
  });

  it("a loop with diagonal runs closes, through a diagonal step onto the first square", () => {
    const states = paintAll(g, OCTAGON);
    const lay = last(states);
    expect(lay.closed).toBe(true);
    expect(lay.cells.slice(-2)).toEqual([[0, 2], [1, 1]]); // the closing step [1, 1] → [2, 0] is corner to corner
    expect(isLoop(lay.cells)).toBe(true);
    expect(neighbours([0, 0], [1, 1])).toBe(true);
    expect(neighbours([0, 0], [2, 1])).toBe(false);
    expect(neighbours([0, 0], [0, 0])).toBe(false);
    expect(isLoop([[0, 0], [2, 1], [2, 2], [0, 2]])).toBe(false); // a knight's move isn't a step
  });

  it("puts a corner at every 45° change, radius half the lane width, x, z and radius only", () => {
    const pts = loopPoints(g, last(paintAll(g, OCTAGON)).cells);
    expect(pts).toEqual([
      { x: -6, z: -5, radius: 1 }, // the first square: in corner to corner, out east
      { x: 6, z: -5, radius: 1 },
      { x: 10, z: -1, radius: 1 },
      { x: 10, z: 1, radius: 1 },
      { x: 6, z: 5, radius: 1 },
      { x: -6, z: 5, radius: 1 },
      { x: -10, z: 1, radius: 1 },
      { x: -10, z: -1, radius: 1 },
    ]);
    for (const p of pts) expect(Object.keys(p).sort()).toEqual(["radius", "x", "z"]);
    // #104: a 135° turn paints, corner to corner north-east then back west past the square the diagonal passed
    expect(last(paintTo(g, last(paintAll(g, [[0, 0], [2, 2]])), [0, 2]).states).cells).toEqual([[0, 0], [1, 1], [2, 2], [1, 2], [0, 2]]);
  });

  it("a loop with 45° corners bakes with no errors, and none against the venue", () => {
    const doc = laidDoc(v, OCTAGON);
    expect(errorsIn(doc, v)).toEqual([]);
    const b = bakeBuilt(doc);
    expect(b.crossings).toBeUndefined();
    // width / 2 is an apex radius of 0 at 45° as at 90°: the engine keeps it, so the corners are as tight as they go
    expect(b.checks.map((c) => c.code)).not.toContain("tight-corner");
    // the start line goes on the longest straight: the south one, x −6 to 6 (the north one ties; ties go to the first)
    expect(b.startLine.z).toBeCloseTo(-5, 2);
    expect(doc.design.points.flatMap((p) => Object.keys(p)).every((k) => ["x", "z", "radius"].includes(k))).toBe(true);
  });

  it("on a venue with obstacles too: round sports hall B's pillars with diagonals", () => {
    const hall = venue("sports-hall-b");
    const hb = laneGrid(hall.area, hall.obstacles ?? [], 2); // blocked: 3,3 3,4 9,3 9,4 and the fire exit 11,0 11,1
    const loop: Cell[] = [[1, 0], [8, 0], [10, 2], [10, 5], [9, 6], [1, 6], [0, 5], [0, 1], [1, 0]];
    expect(last(paintAll(hb, loop)).closed).toBe(true);
    expect(errorsIn(laidDoc(hall, loop), hall)).toEqual([]);
  });

  it("refuses to cut a corner past a blocked square, and keeps what it laid before", () => {
    expect(REFUSAL_TEXT.corner).toBe("A diagonal can't cut past a square blocked by a fixed obstacle.");
    const pillar = laneGrid(v.area, [{ type: "circle", x: -6, z: -3, radius: 0.3, label: "Pillar" }], 2); // in [2, 1]
    expect(blocked(pillar)).toEqual(["2,1"]);
    // [1, 1] → [2, 0] passes between [2, 1] (the pillar) and [1, 0]
    expect(paintTo(pillar, last(paintAll(pillar, [[0, 1], [1, 1]])), [2, 0])).toEqual({ states: [], refused: "corner" });
    // [3, 0] → [2, 1]'s other side: [3, 1] → [2, 0] passes between [2, 1] and [3, 0]
    expect(paintTo(pillar, last(paintAll(pillar, [[4, 1], [3, 1]])), [2, 0]).refused).toBe("corner");
    // a drag that lays some steps first stops at the cut: [5, 3] → [1, 0] goes [4, 2], [3, 1], then [3, 1] → [2, 0]
    const run = paintTo(pillar, last(paintAll(pillar, [[5, 3]])), [1, 0]);
    expect(run.refused).toBe("corner");
    expect(last(run.states).cells).toEqual([[5, 3], [4, 2], [3, 1]]);
    // straight round the pillar is fine
    expect(paintTo(pillar, last(run.states), [3, 0]).refused).toBeUndefined();
  });

  it("cuts a corner past a square the lane already uses (#104), but never across its own diagonal", () => {
    // west to east along row 1, south into [2, 0], then corner to corner to [3, 1]: past [2, 1], the lane's own
    const hook = last(paintAll(g, [[0, 1], [2, 1], [2, 0]]));
    expect(last(paintTo(g, hook, [3, 1]).states).cells.at(-1)).toEqual([3, 1]);
    // east then straight back north-west: a 135° turn back past the square it came from
    expect(last(paintTo(g, last(paintAll(g, [[0, 0], [1, 0]])), [0, 1]).states).cells).toEqual([[0, 0], [1, 0], [0, 1]]);
    // an X of two diagonals: [0, 1] → [1, 0] then round to [1, 1] (beside the first diagonal: painted) and across to
    // [0, 0], between [0, 1] and [1, 0], which the lane steps straight between: a crossing, and not at right angles
    const x = last(paintAll(g, [[0, 1], [1, 0], [2, 0], [2, 1], [1, 1]]));
    expect(paintTo(g, x, [0, 0])).toEqual({ states: [], refused: "crossing" });
    // the other way round too: the X's second diagonal laid first, then [1, 0] → [0, 1] across it
    expect(paintTo(g, last(paintAll(g, [[0, 0], [1, 1], [2, 1], [2, 0], [1, 0]])), [0, 1]).refused).toBe("crossing");
    // and isLoop agrees: an X between two squares isn't a loop
    expect(isLoop([[0, 1], [1, 0], [2, 0], [2, 1], [1, 1], [0, 0]])).toBe(false);
  });

  it("a hook past the lane's own square bakes as a squeeze: the lanes share a pipe, one narrower (#104)", () => {
    const hook: Cell[] = [[0, 1], [2, 1], [2, 0], [3, 1], [3, 3], [0, 3], [0, 1]];
    const checks = bakeBuilt(laidDoc(v, hook)).checks;
    expect(checks.filter((c) => c.level === "error")).toEqual([]);
    expect(checks.filter((c) => c.code === "lane-squeeze").map((c) => c.message)).toEqual(["Lane narrows by 0.08 m at this corner"]);
  });

  it("two diagonal runs side by side, width / √2 apart, paint, and bake as a lane-overlap error (#104)", () => {
    // north-east from [0, 0] to [3, 3], round, and back south-west one column over: [4, 3] → [1, 0], past [3, 3]
    const close: Cell[] = [[0, 0], [3, 3], [4, 3], [1, 0], [0, 0]];
    expect(last(paintAll(g, close)).closed).toBe(true);
    // the lanes are 1.41 m apart, centre to centre: they run into each other, no pipe between
    expect(errorsIn(laidDoc(v, close), v).map((c) => [c.code, c.message])).toEqual([["lane-overlap", "Lanes overlap by 0.58 m here"]]);
    // two columns over they're 2.83 m apart, more than a lane: that loop closes and bakes clean
    const wide: Cell[] = [[0, 0], [0, 1], [2, 3], [3, 3], [3, 2], [1, 0], [0, 0]];
    expect(last(paintAll(g, wide)).closed).toBe(true);
    expect(errorsIn(laidDoc(v, wide), v)).toEqual([]);
  });

  it("a step into a square an earlier diagonal passed between paints (#104): the bake decides", () => {
    // north-east [1, 0] → [4, 3], round, then west along row 2: [3, 2] is on the diagonal, so stop at [4, 2]; and
    // along row 1 from the east, [3, 1] is one the diagonal passed between
    const round = last(paintAll(g, [[1, 0], [4, 3], [6, 3], [6, 1]]));
    expect(last(paintTo(g, round, [3, 1]).states).cells.slice(-3)).toEqual([[5, 1], [4, 1], [3, 1]]);
    // the same from the diagonal's other side, south down column 2 into [2, 2]
    expect(paintTo(g, last(paintAll(g, [[1, 0], [4, 3], [4, 5], [2, 5], [2, 3]])), [2, 2]).refused).toBeUndefined();
  });

  it("the point of a V paints next to anything: the lane, the area's edge, an obstacle (#104)", () => {
    // on the edge row: the point of [3, 4]… [5, 5] → [4, 4] is on the area's north edge
    expect(paintTo(g, last(paintAll(g, [[5, 1], [7, 3], [5, 5]])), [4, 4]).refused).toBeUndefined();
    // closing onto the first square: a V there, and a V on the last square
    expect(paintTo(g, last(paintAll(g, [[3, 0], [5, 2], [3, 4], [1, 2]])), [3, 0]).states.at(-1)?.closed).toBe(true);
    expect(paintTo(g, last(paintAll(g, [[1, 0], [2, 1], [1, 2], [0, 1]])), [1, 0]).states.at(-1)?.closed).toBe(true);
    // a point aimed at a blocked square: a pillar in [3, 2] only
    const pillar = laneGrid(v.area, [{ type: "circle", x: -4, z: -1.65, radius: 0.3, label: "Pillar" }], 2);
    expect(blocked(pillar)).toEqual(["3,2"]);
    expect(paintTo(pillar, last(paintAll(pillar, [[2, 0], [3, 1]])), [4, 0]).refused).toBeUndefined();
    // at a square the lane uses: north up column 6, then a V at [5, 2] pointing at [6, 2]
    expect(paintTo(g, last(paintAll(g, [[6, 0], [6, 4], [5, 4], [4, 3], [5, 2]])), [4, 1]).refused).toBeUndefined();
    // and later into the square beyond the point: a V at [5, 2] pointing east, then round into [6, 2]
    expect(paintTo(g, last(paintAll(g, [[3, 0], [5, 2], [3, 4], [4, 5], [7, 5], [7, 2]])), [6, 2]).refused).toBeUndefined();
  });

  it("a V's outside is round, so it stays inside its square: flush with the edge of the area and the obstacle (#104)", () => {
    // a diamond with its north and east points on the edge row and column
    const diamond: Cell[] = [[8, 3], [9, 4], [10, 3], [9, 2], [8, 3]];
    expect(laidDoc(v, diamond).design.points.map((p) => p.outer)).toEqual(["round", "round", "round", "round"]);
    expect(errorsIn(laidDoc(v, diamond), v)).toEqual([]);
    const top: Cell[] = [[5, 1], [7, 3], [5, 5], [3, 3], [5, 1]];
    expect(errorsIn(laidDoc(v, top), v)).toEqual([]);
    // only V points: a 90° turn between straights, or a 45° or 135° turn, keeps the default outside
    const pts = laidDoc(v, [[0, 0], [5, 0], [2, 3], [0, 3], [0, 0]]).design.points; // 90°, 135°, 45°, 90°
    expect(pts.map((p) => p.outer)).toEqual([undefined, undefined, undefined, undefined]);
    // a V pointing at a pillar: the pillar's square is beyond the point, and nothing reaches it
    const pillarHall: RcVenue = { ...v, obstacles: [{ type: "circle", x: -4, z: -1.65, radius: 0.3, label: "Pillar" }] }; // in [3, 2]
    const vAtPillar: Cell[] = [[2, 0], [3, 1], [4, 0], [5, 1], [5, 3], [1, 3], [1, 1], [2, 0]];
    expect(laidDoc(pillarHall, vAtPillar).design.points.find((p) => p.x === -4 && p.z === -3)?.outer).toBe("round");
    expect(errorsIn(laidDoc(pillarHall, vAtPillar), pillarHall)).toEqual([]);
  });

  it("Yeti's first case (8 Nov): the closing diagonal past the start square, a 135° turn, closes and bakes clean", () => {
    // east along the top row, down the right side, west, then diagonally north-west into the start square, past [1, 5]
    const loop: Cell[] = [[0, 5], [6, 5], [6, 0], [5, 0], [0, 5]];
    const lay = last(paintAll(g, loop));
    expect(lay.closed).toBe(true);
    expect(lay.cells.slice(-2)).toEqual([[2, 3], [1, 4]]);
    const doc = laidDoc(v, loop);
    expect(doc.design.points[0]).toEqual({ x: -10, z: 5, radius: 1 }); // the 135° turn on the start square
    expect(errorsIn(doc, v)).toEqual([]);
  });

  it("Yeti's second case (8 Nov): a lane right beside the point of a V paints and bakes clean", () => {
    // east along row 0 under a V at [4, 1] (pointing at [4, 0], down onto the lane), coming south-west from [8, 5]
    const loop: Cell[] = [[0, 0], [10, 0], [10, 5], [8, 5], [4, 1], [1, 4], [0, 4], [0, 0]];
    expect(last(paintAll(g, loop)).closed).toBe(true);
    const doc = laidDoc(v, loop);
    expect(doc.design.points[4]).toEqual({ x: -2, z: -3, radius: 1, outer: "round" });
    expect(errorsIn(doc, v)).toEqual([]);
  });

  it("every closed loop without crossings that painting allows bakes with no error but lane-overlap (fuzzed)", () => {
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    let baked = 0;
    for (let t = 0; t < 600 && baked < 40; t++) {
      let lay: Laying = { cells: [[Math.floor(rand() * g.cols), Math.floor(rand() * g.rows)]], closed: false };
      for (let k = 0; k < 60 && !lay.closed; k++) {
        const e = lay.cells[lay.cells.length - 1];
        const to: Cell = rand() < 0.1 ? lay.cells[0] : [e[0] + Math.floor(rand() * 3) - 1, e[1] + Math.floor(rand() * 3) - 1];
        lay = last(paintTo(g, lay, to).states) ?? lay;
      }
      if (!lay.closed || new Set(lay.cells.map(key)).size < lay.cells.length) continue;
      baked++;
      // #104: lanes may come closer than a lane width; where they run into each other, the bake says so
      const codes = errorsIn(laidDoc(v, [...lay.cells, lay.cells[0]]), v).map((c) => c.code);
      expect(codes.filter((c) => c !== "lane-overlap"), JSON.stringify(lay.cells)).toEqual([]);
    }
    expect(baked).toBe(40);
  });

  it("a crossing whose square straight on is beside a diagonal goes on there (#104): it's no dead end", () => {
    const fine = laneGrid(v.area, [], 1);
    const lay = last(paintAll(fine, [[3, 1], [3, 4], [5, 4], [5, 2], [4, 1], [4, 0], [1, 0], [1, 2], [2, 2]]));
    // [3, 2] crosses the first pass at right angles; straight on is [4, 2], which [5, 2] → [4, 1] passed between
    expect(last(paintTo(fine, lay, [4, 2]).states).cells.slice(-2)).toEqual([[3, 2], [4, 2]]);
  });

  it("a drag stays on its square until it's well inside the next, so a diagonal drag goes corner to corner", () => {
    const at = (c: number, r: number): [number, number] => [g.origin[0] + c * 2, g.origin[1] + r * 2]; // in squares
    expect(dragCell(g, at(0.5, 0.5), null)).toEqual([0, 0]);
    // a slow drag from [0, 0] towards [1, 1] a little off the diagonal clips [1, 0] near its corner: not taken
    expect(dragCell(g, at(1.1, 0.95), [0, 0])).toEqual([0, 0]);
    expect(dragCell(g, at(1.4, 1.35), [0, 0])).toEqual([1, 1]);
    // well inside a square next to it, straight or diagonal, it moves on
    expect(dragCell(g, at(1.3, 0.5), [0, 0])).toEqual([1, 0]);
    expect(dragCell(g, at(0.5, 1.75), [0, 0])).toEqual([0, 1]);
    // a fast drag that lands further away goes there at once (painting fills the gap); off the grid is null
    expect(dragCell(g, at(3.05, 0.5), [0, 0])).toEqual([3, 0]);
    expect(dragCell(g, at(-0.5, 0.5), [0, 0])).toBeNull();
  });

  it("lifting the pointer near the edge of the next square paints the step to it (#96)", () => {
    const at = (c: number, r: number): [number, number] => [g.origin[0] + c * 2, g.origin[1] + r * 2]; // in squares
    const lay = last(paintAll(g, [[0, 0], [2, 0]]));
    // the drag reached [3, 0] but not its middle 60%: dragCell keeps [2, 0], so only the release paints it
    expect(dragCell(g, at(3.1, 0.5), [2, 0])).toEqual([2, 0]);
    expect(releaseStep(g, lay, at(3.1, 0.5))).toEqual([{ cells: [[0, 0], [1, 0], [2, 0], [3, 0]], closed: false }]);
    // corner to corner too, lifted just past the shared corner
    expect(releaseStep(g, lay, at(3.05, 1.05))).toEqual([{ cells: [[0, 0], [1, 0], [2, 0], [3, 1]], closed: false }]);
    // over the lane's own end square, a square further away, off the grid: nothing
    expect(releaseStep(g, lay, at(2.9, 0.5))).toEqual([]);
    expect(releaseStep(g, lay, at(4.5, 0.5))).toEqual([]);
    expect(releaseStep(g, lay, at(2.5, -0.1))).toEqual([]);
    // never a step back (it would take the last square up) or a refused square, and nothing on an empty or closed lane
    expect(releaseStep(g, lay, at(1.9, 0.5))).toEqual([]);
    const hall = laneGrid(venue("sports-hall-b").area, venue("sports-hall-b").obstacles ?? [], 2); // [11, 0] is blocked
    expect(releaseStep(hall, last(paintAll(hall, [[8, 0], [10, 0]])), [hall.origin[0] + 22.1, hall.origin[1] + 1])).toEqual([]);
    expect(releaseStep(g, empty, at(0.1, 0.5))).toEqual([]);
    expect(releaseStep(g, { cells: [[0, 0], [1, 0], [1, 1], [0, 1]], closed: true }, at(0.9, 0.5))).toEqual([]);
  });

  it("lifting the pointer at the edge of the first square closes the loop (#96)", () => {
    const at = (c: number, r: number): [number, number] => [g.origin[0] + c * 2, g.origin[1] + r * 2];
    const open = last(paintAll(g, [[0, 0], [2, 0], [2, 2], [0, 2], [0, 1]]));
    expect(dragCell(g, at(0.5, 0.95), [0, 1])).toEqual([0, 1]);
    expect(releaseStep(g, open, at(0.5, 0.95))).toEqual([{ cells: open.cells, closed: true }]);
    // and corner to corner onto it
    const diag = last(paintAll(g, [[1, 0], [3, 0], [3, 2], [0, 2], [0, 1]]));
    expect(releaseStep(g, diag, at(1.05, 0.95))).toEqual([{ cells: diag.cells, closed: true }]);
  });

  it("a diagonal never crosses the lane (no X): crossings stay straight across at right angles", () => {
    // a diagonal step onto a square the lane goes straight through: not at right angles along the grid
    const lane = last(paintAll(g, [[0, 2], [6, 2], [6, 4], [4, 4], [4, 3]]));
    expect(paintTo(g, lane, [3, 2]).refused).toBe("crossing");
    // corner to corner across a diagonal pass, at right angles: [3, 1] → [2, 2], across [1, 1] → [2, 2] → [3, 3]
    const across = last(paintAll(g, [[0, 0], [4, 4], [5, 4], [5, 1], [3, 1]]));
    expect(paintTo(g, across, [2, 2])).toEqual({ states: [], refused: "crossing" });
    // a straight crossing of a square the first pass went through corner to corner: it paints up to the square beside
    // the diagonal (#104), and stops there
    const diag = last(paintAll(g, [[0, 0], [4, 4], [6, 4], [6, 2], [4, 2]]));
    const run = paintTo(g, diag, [2, 2]);
    expect(run.refused).toBe("crossing");
    expect(last(run.states).cells.at(-1)).toEqual([3, 2]);
    // and isLoop agrees: a crossing with a diagonal pass isn't a loop
    expect(isLoop([[0, 0], [1, 1], [2, 2], [3, 2], [3, 1], [2, 1], [1, 1], [0, 1]])).toBe(false);
  });

  it("back-tracking off a diagonal step takes it up, a step at a time, and goes on from there", () => {
    const laid = last(paintAll(g, [[0, 0], [4, 4]]));
    expect(laid.cells).toEqual([[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]]);
    const back = paintTo(g, laid, [2, 2]);
    expect(back.states.map((s) => s.cells)).toEqual([
      [[0, 0], [1, 1], [2, 2], [3, 3]],
      [[0, 0], [1, 1], [2, 2]],
    ]);
    // dragging back onto the previous square corner to corner never counts as cutting past the lane
    const bend = last(paintAll(g, [[0, 0], [2, 0], [3, 1]]));
    expect(last(paintTo(g, bend, [2, 0]).states).cells).toEqual([[0, 0], [1, 0], [2, 0]]);
    expect(last(paintTo(g, last(back.states), [2, 3]).states).cells).toEqual([[0, 0], [1, 1], [2, 2], [2, 3]]);
  });

  it("each step, diagonal or straight, is one undo state, and undo past the close comes back to the open lane", () => {
    const d0 = newDraft({ area: v.area, name: "t" });
    const states = paintAll(gridFor(d0), [[2, 0], [8, 0], [10, 2], [9, 1], [10, 2], ...OCTAGON.slice(3)]); // with a back-track
    expect(last(states).closed).toBe(true);
    let h: HistoryState<Draft> = { past: [], present: d0, future: [], group: null, at: 0, travels: 0 };
    for (const s of states) h = historyReducer(h, { type: "set", next: withLaying(h.present, s), now: 1000 });
    expect(h.past.length).toBe(states.length);
    expect(designStep(h.present)).toBe(2);
    let u = historyReducer(h, { type: "undo" });
    expect(designStep(u.present)).toBe(1);
    for (let k = states.length - 2; k > 0; k--) {
      expect(u.present.laying).toEqual(states[k].cells);
      u = historyReducer(u, { type: "undo" });
    }
    expect(u.present.laying).toEqual(states[0].cells);
  });
});
