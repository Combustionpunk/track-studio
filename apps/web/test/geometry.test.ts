import { bakeBuilt, type RcTrack } from "@track-studio/engine";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clampToArea, roundTo, wheelRadius, insertionFor, liveGeometry, nearestOnLine, snapPoint, starterDesign, starterLoop, tooClose, wrapDistance } from "../src/designer/geometry.js";

const ref = <T,>(p: string) => JSON.parse(readFileSync(join(__dirname, "../../../reference", p), "utf8")) as T;

describe("live geometry matches the engine", () => {
  it("racing line, features and start line as bake places them", () => {
    const t = ref<RcTrack>("examples/club-a.rctrack.json");
    const live = liveGeometry(t.design);
    const b = bakeBuilt(t);
    expect(live.racing.length).toBe(b.racingLine.length);
    live.racing.forEach((p, i) => expect(Math.hypot(p[0] - b.racingLine[i][0], p[1] - b.racingLine[i][1])).toBeLessThan(0.001));
    live.features.forEach((f, i) => {
      expect(f.x).toBeCloseTo(b.features[i].x, 3);
      expect(f.z).toBeCloseTo(b.features[i].z, 3);
      expect(f.heading).toBeCloseTo(b.features[i].heading, 3);
      expect(f.length).toBe(b.features[i].length);
    });
    expect(live.startLine.x).toBeCloseTo(b.startLine.x, 3);
    expect(live.total).toBeCloseTo(b.lapLength, 3);
  });

  it("projects a pointer onto the line", () => {
    const t = ref<RcTrack>("examples/club-a.rctrack.json");
    const live = liveGeometry(t.design);
    const b = bakeBuilt(t);
    const f = b.features[0];
    const hit = nearestOnLine(live, [f.x + 0.3, f.z - 0.2]);
    expect(hit.s).toBeCloseTo(t.design.features![0].distance, 0);
    expect(hit.dist).toBeLessThan(0.4);
    expect(wrapDistance(-1, 100)).toBe(99);
    expect(wrapDistance(101.234, 100)).toBe(1.25);
  });
});

describe("snapping", () => {
  const prev: [number, number] = [0, 0], next: [number, number] = [10, 10];
  it("grid only when no 45° line is near", () => {
    expect(snapPoint([3.37, 7.88], prev, next).p).toEqual([3.25, 8]);
  });
  it("onto a horizontal / vertical line from a neighbour, then along it in grid steps", () => {
    const r = snapPoint([4.13, 0.31], prev, next);
    expect(r.p).toEqual([4.25, 0]);
    expect(r.guides).toHaveLength(1);
    expect(snapPoint([9.8, 6.02], prev, next).p).toEqual([10, 6]);
  });
  it("onto a diagonal", () => {
    const r = snapPoint([3.1, 2.9], [0, 0], [20, -5]);
    expect(r.p[0]).toBe(r.p[1]);
    expect(r.p[0] % 0.25).toBe(0);
  });
  it("pulls the same distance however long the line (no 2 m jumps on long straights)", () => {
    expect(snapPoint([7.5, -2.5], [-9.5, -4.5], [9.5, 4.5]).p).toEqual([7.5, -2.5]); // 2 m off a 17 m line: stays
    expect(snapPoint([7.5, -4.2], [-9.5, -4.5], [9.5, 4.5]).p).toEqual([7.5, -4.5]); // 30 cm off: snaps
  });
  it("where both neighbours' lines meet (a square corner)", () => {
    const r = snapPoint([9.75, 0.3], [0, 0], [10, 10]);
    expect(r.p).toEqual([10, 0]);
    expect(r.guides).toHaveLength(2);
  });
  it("works from off-grid neighbours (stays on their line)", () => {
    expect(snapPoint([5.03, 0.95], [1.9, 0.9], [8, 8]).p).toEqual([5, 0.9]); // on the neighbour's line, x on the grid
    const d = snapPoint([4.95, 3.9], [1.9, 0.9], [20, -8]).p; // diagonal from (1.9, 0.9): exactly 45°
    expect(d[0] - 1.9).toBeCloseTo(d[1] - 0.9, 9);
  });
  it("Shift = free", () => {
    expect(snapPoint([3.37, 7.88], prev, next, true).p).toEqual([3.37, 7.88]);
    expect(snapPoint([-8.130000041674915, -3.870000135043586], prev, next, true).p).toEqual([-8.13, -3.87]);
  });
});

describe("area and neighbours", () => {
  it("keeps points in, on the grid, a half lane from the edge", () => {
    expect(clampToArea([12, -7], { length: 22, width: 12 }, 1)).toEqual([10, -5]);
    expect(clampToArea([3, 2], { length: 22, width: 12 }, 1)).toEqual([3, 2]);
    expect(clampToArea([12, 0], { length: 22, width: 12 }, 0.9)).toEqual([10, 0]); // 10.1 rounds in to the grid
  });
  it("rejects points on top of a neighbour", () => {
    expect(tooClose([0.1, 0], [0, 0], [5, 5])).toBe(true);
    expect(tooClose([1, 0], [0, 0], [5, 5])).toBe(false);
  });
  it("inserts on the clicked straight, on the grid if the straight is axis-aligned", () => {
    const pts = [{ x: -10, z: -5 }, { x: 10, z: -5 }, { x: 10, z: 5 }, { x: -10, z: 5 }];
    expect(insertionFor(pts, [3.13, -4.6])).toEqual({ after: 0, at: [3.25, -5] });
    expect(insertionFor(pts, [9.5, 1.1])).toEqual({ after: 1, at: [10, 1] });
  });
});

describe("starter loop", () => {
  it("fills a plain hall without errors", () => {
    const area = { length: 22, width: 12 };
    const pts = starterLoop(area);
    expect(pts).toHaveLength(4);
    const b = bakeBuilt({ format: "rctrack", version: 1, id: "x", revision: 1, info: { name: "x" }, area, design: { laneWidth: 2, points: pts } });
    expect(b.checks.filter((c) => c.level === "error")).toEqual([]);
    expect(b.size!.length).toBeGreaterThan(17);
  });
  it("shrinks to clear obstacles", () => {
    const v = ref<{ area: { length: number; width: number }; obstacles: [] }>("venues/sports-hall-b.rcvenue.json");
    const pts = starterLoop(v.area, v.obstacles);
    const b = bakeBuilt({ format: "rctrack", version: 1, id: "x", revision: 1, info: { name: "x" }, area: v.area, obstacles: v.obstacles, design: { laneWidth: 2, points: pts } });
    expect(b.checks.filter((c) => c.level === "error")).toEqual([]);
  });
});

describe("starter design", () => {
  it("puts the start line on the first straight, not in a corner", () => {
    const d = starterDesign({ length: 22, width: 12 });
    const live = liveGeometry(d);
    const at = nearestOnLine(live, [live.startLine.x, live.startLine.z]);
    expect(at.curvature).toBe(0);
    expect(Math.abs(live.startLine.z - d.points[0].z)).toBeLessThan(1e-9); // on the bottom straight
  });
});

describe("steps", () => {
  it("rounds without float noise", () => {
    expect(roundTo(37.05, 0.05)).toBe(37.05);
    expect(roundTo(0.05 * 741, 0.05)).toBe(37.05);
    expect(wrapDistance(37.04, 100)).toBe(37.05);
  });
  it("wheel radius: 5 cm steps when tight, ~10% when wide, reversible-ish", () => {
    expect(wheelRadius(0.6, 1)).toBe(0.65);
    expect(wheelRadius(3, 1)).toBe(3.3);
    expect(wheelRadius(1, 10)).toBeCloseTo(2.6, 1); // a few notches take a hairpin to a sweeper
    expect(wheelRadius(0.1, -5)).toBe(0);
    expect(wheelRadius(14, 10)).toBe(15);
  });
});
