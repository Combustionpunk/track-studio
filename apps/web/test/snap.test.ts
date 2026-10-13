import { bakeBuilt, borders, racingLine, unrle, type DesignPoint, type Point2, type RcTrack } from "@track-studio/engine";
import { describe, expect, it } from "vitest";
import { besideLines, keepPinned, tidy, laneGrid, makeHairpin, mitrePoint, pinnedCorners, placeByMitre, snapCentre, snapInsertion, snapMitre, type SnapMode } from "../src/designer/snap.js";

const area = { length: 22, width: 12 };
const doc = (points: DesignPoint[], a = area, laneWidth = 2): RcTrack => ({ format: "rctrack", version: 1, id: "t", revision: 1, info: { name: "t" }, area: a, design: { laneWidth, points } });
const ctx = (points: DesignPoint[], i: number, mode: SnapMode = "lanes", a = area) => ({ area: a, points, laneWidth: 2, i, mode });
const cellAt = (b: ReturnType<typeof bakeBuilt>, x: number, z: number) => {
  const f = b.footprint;
  return unrle(f.rle, f.rows * f.cols)[Math.floor((z - f.origin[1]) / f.cell) * f.cols + Math.floor((x - f.origin[0]) / f.cell)];
};

describe("lane grid", () => {
  it.each([1.8, 2.0, 2.4])("lanes flush to each wall (w = %s)", (w) => {
    const g = laneGrid(22, w);
    expect(g[0]).toBeCloseTo(-11 + w / 2, 9);
    expect(g[g.length - 1]).toBeCloseTo(11 - w / 2, 9);
    // from the left wall in whole lanes
    for (let k = 0; -11 + w / 2 + k * w <= 11 - w / 2; k++) expect(g).toContainEqual(Math.round((-11 + w / 2 + k * w) * 1000) / 1000);
  });

  it("an area that isn't a whole number of lanes: flush to both walls", () => {
    const g = laneGrid(21, 2);
    expect(g).toContain(-9.5); // against the west wall
    expect(g).toContain(9.5); // against the east wall
    expect(g).toContain(-7.5); // a lane beside the west one
    expect(g).toContain(7.5);
    expect(g.every((v) => v >= -9.5 && v <= 9.5)).toBe(true);
  });

  it("a 4-point loop snapped in Lanes mode fills 22 x 12 exactly", () => {
    let pts: DesignPoint[] = [{ x: -9, z: -4 }, { x: 9, z: -4 }, { x: 9, z: 4 }, { x: -9, z: 4 }];
    const rough: Point2[] = [[-10.3, -4.7], [10.2, -4.6], [10.4, 4.8], [-9.8, 4.7]];
    rough.forEach((r, i) => {
      const s = snapCentre(r, ctx(pts, i));
      pts = pts.map((p, k) => (k === i ? { ...p, x: s.p[0], z: s.p[1] } : p));
    });
    expect(pts.map((p) => [p.x, p.z])).toEqual([[-10, -5], [10, -5], [10, 5], [-10, 5]]);
    expect(snapCentre([10.4, 4.8], ctx(pts, 2)).tags).toContain("corner");
    const b = bakeBuilt(doc(pts));
    expect(b.size).toEqual({ length: 22, width: 12, bbox: [-11, -6, 11, 6] });
    for (const [x, z] of [[-10.95, -5.95], [10.95, -5.95], [10.95, 5.95], [-10.95, 5.95]]) expect(cellAt(b, x, z), `${x},${z}`).toBe(1);
  });

  it("lane grid uses the point's own width", () => {
    const pts: DesignPoint[] = [{ x: -9, z: -4, width: 2.4 }, { x: 9, z: -4 }, { x: 9, z: 4 }, { x: -9, z: 4 }];
    expect(snapCentre([-10.2, -4.9], ctx(pts, 0)).p).toEqual([-9.8, -4.8]);
  });
});

describe("modes", () => {
  const pts: DesignPoint[] = [{ x: -9, z: -4 }, { x: 9, z: -4 }, { x: 3, z: 3 }, { x: -9, z: 4 }];
  it("Shift = Fine: 0.25 m grid", () => {
    const s = snapCentre([2.13, 0.62], ctx(pts, 2, "fine"));
    expect(s.p).toEqual([2.25, 0.5]);
    expect(snapCentre([2.13, 2.62], ctx(pts, 2, "fine")).tags).toContain("45°"); // near a 45° line from a neighbour
  });
  it("Alt = Free: no snapping", () => {
    expect(snapCentre([2.137, 2.621], ctx(pts, 2, "free")).p).toEqual([2.137, 2.621]);
  });
  it("Lanes: lane grid, and 0/90° from a neighbour", () => {
    expect(snapCentre([2.6, 0.7], ctx(pts, 2)).p).toEqual([2, 1]); // 2 m lanes in 22 x 12: centres at even x, odd z
    const flat = snapCentre([3.1, -3.8], ctx([{ x: -9, z: -4.3 }, { x: 9, z: -4 }, { x: 3, z: 3 }, { x: -9, z: 4 }], 0));
    expect(flat.p[1]).toBeCloseTo(-4, 9); // horizontal from its neighbour
  });
});

// a loop with two long parallel straights: bottom (east) and a return leg (west) above it
const twoStraights = (z: number, w = 2): DesignPoint[] => [{ x: -9, z: -5 }, { x: 9, z: -5 }, { x: 9, z: z + 2.5 }, { x: 4, z }, { x: -6, z }, { x: -9, z: z + 3 }].map((p) => ({ ...p, width: w }));

describe("beside other lanes", () => {
  it("parallel horizontal straights end up exactly w apart", () => {
    const pts = twoStraights(-3.4);
    pts[3] = { ...pts[3], z: -3.35 };
    for (const i of [3, 4]) {
      const s = snapCentre([pts[i].x + 0.07, pts[i].z + 0.13], ctx(pts, i));
      expect(s.tags).toContain("beside lane");
      pts[i] = { ...pts[i], x: s.p[0], z: s.p[1] };
    }
    expect(pts[3].z).toBeCloseTo(-3, 9);
    expect(pts[4].z).toBeCloseTo(-3, 9);
  });

  it("parallel 45° diagonals end up exactly w apart and share one pipe", () => {
    // a loop with a diagonal up and, later, a diagonal down beside it
    let pts: DesignPoint[] = [
      { x: -9, z: -5 }, { x: -2, z: -5 }, { x: 4, z: 1 }, { x: 9, z: 1 }, { x: 9, z: 5 }, { x: 5.2, z: 4.9 }, { x: -1.3, z: -1.4 }, { x: -9, z: -1.4 },
    ];
    for (const i of [5, 6]) {
      const s = snapCentre([pts[i].x, pts[i].z], ctx(pts, i));
      expect(s.tags, `point ${i}`).toContain("beside lane");
      pts = pts.map((p, k) => (k === i ? { ...p, x: s.p[0], z: s.p[1] } : p));
    }
    // perpendicular distance between the diagonal centre lines: (x - z) differs by w·√2
    const c1 = pts[1].x - pts[1].z, c2 = pts[2].x - pts[2].z, c3 = pts[5].x - pts[5].z, c4 = pts[6].x - pts[6].z;
    expect(c1).toBeCloseTo(c2, 9);
    expect(c3).toBeCloseTo(c4, 2);
    expect(Math.abs(c3 - c1) / Math.SQRT2).toBeCloseTo(2, 2);
    // built: one pipe along the middle of the pair
    const b = bakeBuilt(doc(pts));
    const midC = (c1 + c3) / 2;
    const onMid = b.dividers.filter((d) => {
      let along = 0;
      for (let k = 1; k < d.points.length; k++) {
        const [p, q] = [d.points[k - 1], d.points[k]];
        if (Math.abs(p[0] - p[1] - midC) / Math.SQRT2 < 0.02 && Math.abs(q[0] - q[1] - midC) / Math.SQRT2 < 0.02) along += Math.hypot(q[0] - p[0], q[1] - p[1]);
      }
      return along > 3;
    });
    expect(onMid).toHaveLength(1);
    // and no second pipe close beside it along the middle half of where they overlap (the ends peel away)
    const along = (p: DesignPoint) => p.x + p.z;
    const lo = Math.max(Math.min(along(pts[1]), along(pts[2])), Math.min(along(pts[5]), along(pts[6])));
    const hi = Math.min(Math.max(along(pts[1]), along(pts[2])), Math.max(along(pts[5]), along(pts[6])));
    const q = (hi - lo) / 4;
    const near = b.dividers.flatMap((d) => d.points).filter(([x, z]) => {
      const off = Math.abs(x - z - midC) / Math.SQRT2;
      return off > 0.02 && off < 0.6 && x + z > lo + q && x + z < hi - q;
    });
    expect(hi - lo).toBeGreaterThan(4);
    expect(near).toEqual([]);
  });

  it("only straights running alongside count (not far away, not across)", () => {
    const pts = twoStraights(1);
    expect(besideLines([4, 1], { points: pts, laneWidth: 2, i: 3 })).toEqual([]);
  });
});

describe("outside-corner handle", () => {
  it("dragged to a hall corner: the outer pipes meet there (within 1 mm)", () => {
    const pts: DesignPoint[] = [{ x: -9, z: -4 }, { x: 8.6, z: -4.3 }, { x: 9, z: 4 }, { x: -9, z: 4 }];
    const s = snapMitre([10.85, -5.8], ctx(pts, 1));
    expect(s.p).toEqual([11, -6]);
    expect(s.tags).toEqual(["corner"]);
    const P = placeByMitre(pts, 1, s.p, 2);
    const moved = pts.map((p, k) => (k === 1 ? { ...p, x: P[0], z: P[1] } : p));
    const m = mitrePoint(moved, 1, 2)!;
    expect(Math.hypot(m[0] - 11, m[1] + 6)).toBeLessThan(1e-3);
    // and the engine's lane edges reach the corner
    const { line, corners } = racingLine(moved, 2);
    const bd = borders(line, corners, moved);
    let best = Infinity;
    for (const [xs, zs] of [[bd.rx, bd.rz], [bd.lx, bd.lz]]) for (let k = 0; k < xs.length; k++) best = Math.min(best, Math.hypot(xs[k] - 11, zs[k] + 6));
    expect(best).toBeLessThan(1e-3);
    const b = bakeBuilt(doc(moved));
    expect(b.checks.filter((c) => c.level === "error")).toEqual([]);
    expect(cellAt(b, 10.95, -5.95)).toBe(1);
  });

  it("dragging all four outside corners into the hall's corners, one after another, ends exactly in the corners", () => {
    // the designer's starter loop in Club hall; each drag keeps the corners already placed pinned
    let pts: DesignPoint[] = [{ x: -9.5, z: -4.5 }, { x: 9.5, z: -4.5 }, { x: 9.5, z: 4.5 }, { x: -9.5, z: 4.5 }];
    const targets: Point2[] = [[-10.9, -5.85], [10.85, -5.9], [10.9, 5.85], [-10.85, 5.9]];
    targets.forEach((raw, i) => {
      const pinned = pinnedCorners(pts, area, 2, i); // at the start of the drag
      for (let move = 0; move < 5; move++) {
        // each pointer move: solve the dragged corner against its (pinned, adjusted) neighbours
        const s = snapMitre(raw, ctx(pts, i));
        const P = placeByMitre(pts, i, s.p, 2);
        pts = keepPinned(pts.map((p, k) => (k === i ? { ...p, x: tidy(P[0]), z: tidy(P[1]) } : p)), pinned, 2);
      }
    });
    pts.forEach((p, i) => expect([p.x, p.z], `corner ${i}`).toEqual([[-10, -5], [10, -5], [10, 5], [-10, 5]][i]));
    expect(bakeBuilt(doc(pts)).size).toEqual({ length: 22, width: 12, bbox: [-11, -6, 11, 6] });
  });

  it("a pinned corner doesn't get dragged along when a neighbour moves far", () => {
    const pts: DesignPoint[] = [{ x: -10, z: -5 }, { x: 10, z: -5 }, { x: 10, z: 5 }, { x: -2, z: 5 }, { x: -10, z: 5 }];
    const pinned = pinnedCorners(pts, area, 2, 3);
    expect([...pinned.keys()].sort()).toEqual([0, 1, 2, 4]);
    // pull point 3 down into the middle: corner 4's straight becomes a steep diagonal
    const moved = pts.map((p, k) => (k === 3 ? { ...p, x: -0.8, z: -1 } : p));
    const kept = keepPinned(moved, pinned, 2, pts);
    expect([kept[4].x, kept[4].z]).toEqual([-10, 5]);
    // a small nudge: it follows, its pipes stay in the hall corner
    const nudged = keepPinned(pts.map((p, k) => (k === 3 ? { ...p, z: 4.9 } : p)), pinned, 2, pts);
    const m = mitrePoint(nudged, 4, 2)!;
    expect(Math.hypot(m[0] + 11, m[1] - 6)).toBeLessThan(1e-3);
  });

  it("snaps to walls and to other pipes' corners", () => {
    const pts: DesignPoint[] = [{ x: -10, z: -5 }, { x: 10, z: -5 }, { x: 10, z: 5 }, { x: -10, z: 5 }];
    expect(snapMitre([5, -5.85], ctx(pts, 1)).p).toEqual([5, -6]);
    expect(snapMitre([10.8, 5.9], ctx(pts, 1)).p).toEqual([11, 6]);
  });
});

describe("helpers", () => {
  it("H makes a valid hairpin: two points w apart, still a closed loop", () => {
    const pts: DesignPoint[] = [{ x: -9, z: -4 }, { x: 9, z: -4 }, { x: 9, z: 4 }, { x: -9, z: 4 }];
    const hp = makeHairpin(pts, 1, 2)!;
    expect(hp).toHaveLength(5);
    expect(Math.hypot(hp[2].x - hp[1].x, hp[2].z - hp[1].z)).toBeCloseTo(2, 9);
    expect([hp[1].x, hp[1].z, hp[2].x, hp[2].z]).toEqual([9, -4, 9, -2]); // left turn: the second point to the left
    const b = bakeBuilt(doc(hp));
    expect(b.lapLength).toBeGreaterThan(40);
    expect(Number.isFinite(b.lapLength)).toBe(true);
    expect(b.racingLine.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))).toBe(true);
    expect(makeHairpin([{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 10, z: 0 }, { x: 5, z: 5 }], 1, 2)).toBeNull(); // straight: nothing to do
  });

  it("inserting a point uses the snap mode", () => {
    const pts: DesignPoint[] = [{ x: -10, z: -5 }, { x: 10, z: -5 }, { x: 10, z: 5 }, { x: -10, z: 5 }];
    expect(snapInsertion([3.37, -5], pts, 0, "lanes", area, 2)).toEqual([4, -5]);
    expect(snapInsertion([3.37, -5], pts, 0, "fine", area, 2)).toEqual([3.25, -5]);
    expect(snapInsertion([3.37, -5], pts, 0, "free", area, 2)).toEqual([3.37, -5]);
  });
});
