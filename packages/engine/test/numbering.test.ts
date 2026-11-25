// One corner numbering everywhere (#176): cornerNumbering is what the designer, the build sheet and the Corners
// figure all name corners by.
import { describe, expect, it } from "vitest";
import { bakeBuilt, buildSheet, cornerNumbering, pointName, type DesignPoint, type RcTrack } from "../src/index.js";
import { allTracks, readJson } from "./helpers.js";

const track = (points: DesignPoint[]): RcTrack => {
  const doc: RcTrack = { format: "rctrack", version: 1, id: "t", revision: 1, info: { name: "t" }, area: { length: 40, width: 30 }, design: { laneWidth: 2, points } };
  return { ...doc, built: bakeBuilt(doc) };
};

// a loop with a hairpin at its east end drawn as two 90° points 2 m apart (points 2 and 3), and a 10° kink (point 5)
// on the north straight that isn't a corner
const HAIRPIN: DesignPoint[] = [
  { x: -14, z: -8 },
  { x: 4, z: -8 },
  { x: 12, z: 0 },
  { x: 12, z: 2 },
  { x: 4, z: 8 },
  { x: -5, z: 8.7 },
  { x: -14, z: 8 },
];

describe("cornerNumbering", () => {
  it("numbers a hairpin's two points 3a and 3b, counted once, and leaves a gentle bend unnumbered", () => {
    const n = cornerNumbering(HAIRPIN);
    expect(n.labels).toEqual(["1", "2", "3a", "3b", "4", null, "5"]);
    expect(n.numbers).toEqual([1, 2, 3, 3, 4, null, 5]);
    expect(n.groups).toEqual([[0], [1], [2, 3], [4], [6]]);
  });

  it("agrees with the Corners figure and the build sheet", () => {
    const doc = track(HAIRPIN);
    const n = cornerNumbering(HAIRPIN);
    expect(doc.built!.stats.corners).toBe(5);
    expect(n.groups).toHaveLength(doc.built!.stats.corners);
    const sheet = buildSheet(doc);
    expect(sheet.cornerPoints.map((c) => [c.index, c.label])).toEqual(n.labels.flatMap((l, i) => (l === null ? [] : [[i, l]])));
  });

  it.each(allTracks)("$name: one corner per stats.corners, labelled as the build sheet labels them", ({ path }) => {
    const doc = readJson<RcTrack>(path);
    const n = cornerNumbering(doc.design.points, doc.design.laneWidth);
    expect(n.groups).toHaveLength(doc.built!.stats.corners);
    const sheet = buildSheet(doc);
    expect(sheet.cornerPoints.map((c) => [c.index, c.label])).toEqual(n.groups.flat().map((i) => [i, n.labels[i]]));
  });

  it("names points for sentences: corners by label; a point that isn't a corner has no name, only the word point", () => {
    const n = cornerNumbering(HAIRPIN);
    expect(pointName(n, 2)).toBe("corner 3a");
    expect(pointName(n, 3, "corner point")).toBe("corner point 3b");
    expect(pointName(n, 5)).toBe("point");
    expect(pointName(n, 5, "corner point")).toBe("point");
  });

  it("renumbers as points come and go: a point added on the straight has no number, one dragged out is a corner", () => {
    const mid = { x: -5, z: -8 }; // halfway along the south straight, after corner 1
    expect(cornerNumbering([HAIRPIN[0], mid, ...HAIRPIN.slice(1)]).labels).toEqual(["1", null, "2", "3a", "3b", "4", null, "5"]);
    expect(cornerNumbering([HAIRPIN[0], { x: -5, z: -2 }, ...HAIRPIN.slice(1)]).labels).toEqual(["1", "2", "3", "4a", "4b", "5", null, "6"]);
    // deleting one of the hairpin's points leaves a single corner there
    expect(cornerNumbering(HAIRPIN.filter((_, i) => i !== 3)).labels).toEqual(["1", "2", "3", "4", null, "5"]);
  });

  it("a point that isn't a corner at point 0 leaves corner 1 to the next point; fewer than 3 points have no corners", () => {
    // point 0 a 10° kink on the south straight
    const n = cornerNumbering([{ x: -5, z: -8.7 }, { x: 4, z: -8 }, { x: 12, z: 0 }, { x: 12, z: 2 }, { x: 4, z: 8 }, { x: -14, z: 8 }, { x: -14, z: -8 }]);
    expect(n.labels).toEqual([null, "1", "2a", "2b", "3", "4", "5"]);
    expect(pointName(n, 0)).toBe("point");
    expect(cornerNumbering([{ x: 0, z: 0 }, { x: 1, z: 0 }])).toEqual({ labels: [null, null], numbers: [null, null], groups: [] });
  });
});
