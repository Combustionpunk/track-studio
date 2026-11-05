// Reverse the direction of travel (#36): reorder the points, move every distance to the same physical spot, re-bake.
import { describe, expect, it } from "vitest";
import { arclength, bakeBuilt, distanceToPolyline, racingLine, reverseDesign, type Design, type Divider, type Point2, type RcTrack } from "../src/index.js";
import { allTracks, readJson } from "./helpers.js";

const TOL = 0.01; // 1 cm
/**
 * Dividers come out of the bake's pipe merging, which walks the borders in driving order: reversed, the same pipes are
 * drawn but split into runs differently, and where two lanes share a pipe it settles a few cm to one side. So the
 * divider geometry is the same within 15 cm and the pipe length within 0.5 % (not 1 cm; see the PR for #36).
 */
const PIPE_TOL = 0.15;
const PIPE_LENGTH_REL = 0.005;
const pyMod = (a: number, b: number) => ((a % b) + b) % b;
const xz = (pts: number[][]): Point2[] => pts.map((p) => [p[0], p[1]]);
const angleDiff = (a: number, b: number) => Math.abs(pyMod(a - b + 540, 360) - 180);
/** closed racing line at full sampling, as the bake builds it */
const dense = (d: Design): Point2[] => {
  const { line } = racingLine(d.points, d.laneWidth ?? 2.0);
  const pts = Array.from(line.x, (x, i): Point2 => [x, line.z[i]]);
  return [...pts, pts[0]];
};
/** furthest any vertex of `a` is from all of the dividers in `b` */
const coverage = (a: Divider[], b: Divider[]) =>
  Math.max(...a.flatMap((d) => d.points.map((p) => Math.min(...b.map((e) => distanceToPolyline(p, e.closed ? [...e.points, e.points[0]] : e.points))))));
/** shoelace: > 0 counter-clockwise */
const signedArea = (pts: Point2[]) => pts.reduce((a, p, i) => { const q = pts[(i + 1) % pts.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;

describe.each(allTracks)("reverse $name", ({ path }) => {
  const doc = readJson<RcTrack>(path);
  const before = bakeBuilt(doc);
  const reversed = { ...doc, design: reverseDesign(doc.design) };
  const after = bakeBuilt(reversed);
  const lap = before.lapLength;

  it("reversing twice gives the original design (distances on the same lap)", () => {
    const twice = reverseDesign(reversed.design);
    const { line } = racingLine(doc.design.points, doc.design.laneWidth ?? 2.0);
    const lap = arclength(line.x, line.z).total; // unrounded: distances past one lap wrap by exactly this
    const norm = (d: Design) => ({
      ...d,
      features: (d.features ?? []).map((f) => ({ ...f, distance: pyMod(f.distance, lap) })),
      start: { ...d.start, distance: pyMod(d.start?.distance ?? 0, lap) },
    });
    const a = norm(twice), b = norm(doc.design);
    expect(a.points).toEqual(b.points);
    expect({ ...a, points: [], features: [], start: {} }).toEqual({ ...b, points: [], features: [], start: {} });
    a.features.forEach((f, i) => {
      expect({ ...f, distance: 0 }).toEqual({ ...b.features[i], distance: 0 });
      expect(Math.abs(f.distance - b.features[i].distance)).toBeLessThan(1e-9);
    });
    expect(Math.abs(a.start.distance - b.start.distance)).toBeLessThan(1e-9);
  });

  it("keeps point 0 and each point's own radius, width and outer", () => {
    const p = doc.design.points, q = reversed.design.points;
    expect(q[0]).toEqual(p[0]);
    expect(q.slice(1)).toEqual(p.slice(1).reverse());
    expect(reversed.design.features?.map((f) => [f.type, f.length, f.height])).toEqual(doc.design.features?.map((f) => [f.type, f.length, f.height]));
  });

  it("distances are wrapped into [0, lapLength)", () => {
    for (const d of [...(reversed.design.features ?? []).map((f) => f.distance), reversed.design.start!.distance!]) {
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThan(lap);
    }
  });

  it("same lap length, size and corners", () => {
    expect(Math.abs(after.lapLength - before.lapLength)).toBeLessThanOrEqual(TOL);
    expect(after.size!.length).toBeCloseTo(before.size!.length, 2);
    expect(after.size!.width).toBeCloseTo(before.size!.width, 2);
    after.size!.bbox.forEach((v, i) => expect(Math.abs(v - before.size!.bbox[i])).toBeLessThanOrEqual(TOL));
    expect(after.stats.corners).toBe(before.stats.corners);
  });

  it(`same pipes: as many runs, every one within ${PIPE_TOL * 100} cm of the other bake's, length within ${PIPE_LENGTH_REL * 100} %`, () => {
    expect(after.dividers.length).toBe(before.dividers.length);
    expect(coverage(after.dividers, before.dividers)).toBeLessThanOrEqual(PIPE_TOL);
    expect(coverage(before.dividers, after.dividers)).toBeLessThanOrEqual(PIPE_TOL);
    expect(Math.abs(after.stats.dividerLength - before.stats.dividerLength)).toBeLessThanOrEqual(before.stats.dividerLength * PIPE_LENGTH_REL);
  });

  it("the racing line is the same loop traversed the other way", () => {
    const a = xz(before.racingLine), b = xz(after.racingLine);
    // each exported point (every 0.25 m) lies on the other bake's full line
    const da = dense(doc.design), db = dense(reversed.design);
    expect(Math.max(...b.map((p) => distanceToPolyline(p, da)))).toBeLessThanOrEqual(TOL);
    expect(Math.max(...a.map((p) => distanceToPolyline(p, db)))).toBeLessThanOrEqual(TOL);
    expect(Math.sign(signedArea(b))).toBe(-Math.sign(signedArea(a)));
    expect(Math.abs(signedArea(b) + signedArea(a))).toBeLessThan(0.1);
  });

  it("every jump stays in the same spot, keeps its type and faces the other way", () => {
    expect(after.features.length).toBe(before.features.length);
    after.features.forEach((f, i) => {
      const e = before.features[i];
      expect(f.type).toBe(e.type);
      expect(Math.hypot(f.x - e.x, f.z - e.z)).toBeLessThanOrEqual(TOL);
      expect(angleDiff(f.heading, e.heading + 180)).toBeLessThan(0.01);
    });
  });

  it("the start line stays in the same spot and faces the other way", () => {
    const s = after.startLine, e = before.startLine;
    expect(Math.hypot(s.x - e.x, s.z - e.z)).toBeLessThanOrEqual(TOL);
    expect(angleDiff(s.heading, e.heading + 180)).toBeLessThan(0.01);
  });
});

describe("reverseDesign", () => {
  it("does not modify its input", () => {
    const doc = readJson<RcTrack>(allTracks[0].path);
    const copy = JSON.stringify(doc.design);
    reverseDesign(doc.design);
    expect(JSON.stringify(doc.design)).toBe(copy);
  });

  it("writes the start distance even when the design had none (0 is not the same spot reversed)", () => {
    const doc = readJson<RcTrack>(allTracks[0].path);
    const { start: _, ...design } = doc.design;
    const r = reverseDesign(design);
    const a = bakeBuilt({ ...doc, design }).startLine, b = bakeBuilt({ ...doc, design: r }).startLine;
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThanOrEqual(TOL);
  });

  it("works when point 0 is not a corner (no arc: distance 0 is point 0 itself)", () => {
    const doc = readJson<RcTrack>(allTracks[0].path);
    const p = doc.design.points, last = p[p.length - 1];
    // a point half-way along the last straight, as point 0: it turns by 0
    const design: Design = { ...doc.design, points: [{ x: (last.x + p[0].x) / 2, z: (last.z + p[0].z) / 2 }, ...p] };
    const a = bakeBuilt({ ...doc, design }), b = bakeBuilt({ ...doc, design: reverseDesign(design) });
    expect(Math.abs(a.lapLength - b.lapLength)).toBeLessThanOrEqual(TOL);
    expect(a.features.length).toBeGreaterThan(0);
    for (const [f, e] of [...b.features.map((f, i) => [f, a.features[i]] as const), [b.startLine, a.startLine] as const]) {
      expect(Math.hypot(f.x - e.x, f.z - e.z)).toBeLessThanOrEqual(TOL);
      expect(angleDiff(f.heading, e.heading + 180)).toBeLessThan(0.01);
    }
  });

  it("leaves a design with fewer than 3 points as it is", () => {
    const d: Design = { points: [{ x: 0, z: 0 }, { x: 1, z: 0 }] };
    expect(reverseDesign(d)).toEqual(d);
  });
});
