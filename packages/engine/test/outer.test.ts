// rctrack 1.3: square / round outer corners, and clean shared-divider transitions.
import { describe, expect, it } from "vitest";
import {
  BEVEL_DIST,
  bakeBuilt,
  borders,
  dividers,
  MIN_DIVIDER,
  polylineLength,
  racingLine,
  squareOutline,
  unrle,
  type DesignPoint,
  type Point2,
  type RcTrack,
} from "../src/index.js";
import { allTracks, extraDir, readJson } from "./helpers.js";
import { join } from "node:path";

const fixture = (name: string) => readJson<RcTrack>(join(extraDir, `${name}.rctrack.json`));
const withOuter = (t: RcTrack, outer: "square" | "round"): RcTrack => ({ ...t, design: { ...t.design, points: t.design.points.map((p) => ({ ...p, outer })) } });

describe("square outer corners", () => {
  it("points width/2 from the edges fill the whole area, corners included", () => {
    const t = fixture("square-fill");
    const b = bakeBuilt(t);
    expect(b.size).toEqual({ length: 22, width: 12, bbox: [-11, -6, 11, 6] });
    expect(b.checks).toEqual([]); // nothing outside the area
    const fp = b.footprint;
    const mask = unrle(fp.rle, fp.rows * fp.cols);
    const cell = (x: number, z: number) => mask[Math.floor((z - fp.origin[1]) / fp.cell) * fp.cols + Math.floor((x - fp.origin[0]) / fp.cell)];
    for (const [x, z] of [[-10.95, -5.95], [10.95, -5.95], [10.95, 5.95], [-10.95, 5.95]]) expect(cell(x, z), `${x},${z}`).toBe(1);
    // the outer pipe has square corners at the area's corners
    const outer = b.dividers.find((d) => d.points.some(([x, z]) => x === -11 && z === -6))!;
    expect(outer.points).toEqual(expect.arrayContaining([[-11, -6], [11, -6], [11, 6], [-11, 6]]));
  });

  it("round outer corners leave the area's corners empty (and are smaller)", () => {
    const b = bakeBuilt(withOuter(fixture("square-fill"), "round"));
    expect(b.size).toEqual({ length: 22, width: 12, bbox: [-11, -6, 11, 6] }); // the straights still reach the edges
    const fp = b.footprint;
    const mask = unrle(fp.rle, fp.rows * fp.cols);
    const c = mask[Math.floor((-5.95 - fp.origin[1]) / fp.cell) * fp.cols + Math.floor((-10.95 - fp.origin[0]) / fp.cell)];
    expect(c).toBe(0);
    expect(bakeBuilt(fixture("square-fill")).stats.dividerLength).toBeGreaterThan(b.stats.dividerLength);
  });

  it("round reproduces rctrack 1.2 exactly", () => {
    const t = readJson<RcTrack>(join(extraDir, "..", "v12", "round-sweepers.rctrack.json"));
    const { generator: _g, ...want } = t.built!;
    const { generator: _h, ...got } = bakeBuilt(t);
    expect(got).toEqual(want);
  });

  it("a sharp V is bevelled, never spiking out", () => {
    const t = fixture("sharp-v");
    const { line, corners } = racingLine(t.design.points, 2);
    const sharp = corners.filter((c) => c.th > (120 * Math.PI) / 180);
    expect(sharp.length).toBeGreaterThan(0);
    const bd = borders(line, corners, t.design.points);
    for (const c of sharp) {
      const outline = squareOutline(c, c.w / 2);
      expect(outline).toHaveLength(4); // S, bevel, bevel, E
      // along the bisector, nothing on the outer border reaches further from the arc centre than a 120° mitre would
      const nx = -c.a[1] * c.sign, nz = c.a[0] * c.sign;
      const C: Point2 = [c.start[0] + nx * c.r, c.start[1] + nz * c.r];
      let ux = c.sign * (c.a[1] + c.b[1]), uz = -c.sign * (c.a[0] + c.b[0]); // outer normals summed: the bisector
      const ul = Math.hypot(ux, uz);
      ux /= ul; uz /= ul;
      const limit = (c.r + c.w / 2) * BEVEL_DIST + 1e-9;
      const reach = (x: number, z: number) => (x - C[0]) * ux + (z - C[1]) * uz;
      const [ox, oz] = c.sign > 0 ? [bd.rx, bd.rz] : [bd.lx, bd.lz];
      for (let k = 0; k < c.m; k++) expect(reach(ox[c.arc0 + k], oz[c.arc0 + k])).toBeLessThanOrEqual(limit);
      for (const v of outline) expect(reach(v[0], v[1])).toBeLessThanOrEqual(limit);
      expect(Math.max(...outline.map((v) => reach(v[0], v[1])))).toBeCloseTo(limit, 6); // the bevel sits exactly there
    }
    // a mitre up to 120°: the two straights' outer edges meet at one point
    const right = racingLine([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 8 }, { x: 0, z: 8 }] as DesignPoint[], 2).corners[1];
    expect(squareOutline(right, 1)[1]).toEqual([11, -1]);
  });

  it("inner corners tighter than the lane collapse to the apex without looping", () => {
    const t = readJson<RcTrack>(allTracks.find((f) => f.name === "club-a.rctrack.json")!.path);
    const { line, corners } = racingLine(t.design.points, 2);
    const bd = borders(line, corners, t.design.points);
    corners.forEach((c, i) => {
      if (!(c.r - c.w / 2 <= 1e-9) || c.m === 0) return;
      const [ix, iz] = c.sign > 0 ? [bd.lx, bd.lz] : [bd.rx, bd.rz];
      const q = [ix[c.arc0], iz[c.arc0]];
      for (let k = 0; k < c.m; k++) expect([ix[c.arc0 + k], iz[c.arc0 + k]], `corner ${i}`).toEqual(q);
    });
  });
});

// ------------------------------------------------------------------ merge quality, on every fixture
function turnDeg(a: Point2, b: Point2, c: Point2): number {
  const ux = b[0] - a[0], uz = b[1] - a[1], vx = c[0] - b[0], vz = c[1] - b[1];
  const lu = Math.hypot(ux, uz), lv = Math.hypot(vx, vz);
  if (lu < 1e-9 || lv < 1e-9) return 0;
  return (Math.acos(Math.max(-1, Math.min(1, (ux * vx + uz * vz) / (lu * lv)))) * 180) / Math.PI;
}

function crosses(p1: Point2, p2: Point2, p3: Point2, p4: Point2): boolean {
  const d = (a: Point2, b: Point2, c: Point2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
  return ((d1 > 1e-12 && d2 < -1e-12) || (d1 < -1e-12 && d2 > 1e-12)) && ((d3 > 1e-12 && d4 < -1e-12) || (d3 < -1e-12 && d4 > 1e-12));
}

describe.each(allTracks)("pipes of $name", ({ path }) => {
  const t = readJson<RcTrack>(path);
  const b = bakeBuilt(t);

  it("no fragment shorter than 0.25 m", () => {
    for (const d of b.dividers) expect(polylineLength(d.points, d.closed)).toBeGreaterThanOrEqual(MIN_DIVIDER);
  });

  it("no divider crosses itself", () => {
    for (const d of b.dividers) {
      const p = d.points, n = p.length, segs = d.closed ? n : n - 1;
      for (let a = 0; a < segs; a++)
        for (let c = a + 2; c < segs; c++) {
          if (d.closed && a === 0 && c === segs - 1) continue;
          expect(crosses(p[a], p[(a + 1) % n], p[c], p[(c + 1) % n]), `segments ${a} and ${c}`).toBe(false);
        }
    }
  });

  it("no kink sharper than 30° where a shared pipe and a separate one meet", () => {
    const { line, corners } = racingLine(t.design.points, t.design.laneWidth ?? 2);
    const res = dividers(line, corners, t.design.points);
    const n = line.n;
    // where merging starts / stops along each border
    const transitions: Point2[] = [];
    for (let side = 0; side < 2; side++)
      for (let k = 0; k < n; k++) {
        const i = side * n + k, j = side * n + ((k + 1) % n);
        if (res.weight[i] > 0.5 !== res.weight[j] > 0.5) transitions.push([res.mergedX[i], res.mergedZ[i]]);
      }
    // real corners of the geometry: square-corner mitres / bevels, collapsed inside apexes and tight inside arcs
    // (inner radius under 0.3 m: the pipe itself bends that sharply)
    const legit: Point2[] = [];
    corners.forEach((c, i) => {
      if (!(c.th > 1e-6 && c.r > 0)) return;
      if ((t.design.points[i].outer ?? "square") === "square") legit.push(...squareOutline(c, c.w / 2).slice(1, -1));
      if (c.r - c.w / 2 <= 1e-9) legit.push(c.P); // (near the apex)
      else if (c.r - c.w / 2 < 0.3) legit.push([c.start[0] - c.a[1] * c.sign * c.r, c.start[1] + c.a[0] * c.sign * c.r]); // arc centre
    });
    const near = (p: Point2, list: Point2[], r: number) => list.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= r);
    const bad: string[] = [];
    for (const d of b.dividers) {
      const p = d.points, m = p.length;
      for (let k = d.closed ? 0 : 1; k < (d.closed ? m : m - 1); k++) {
        const v = p[k];
        const turn = turnDeg(p[(k - 1 + m) % m], v, p[(k + 1) % m]);
        if (turn > 30 && near(v, transitions, 0.5) && !near(v, legit, 0.35 + c2(t))) bad.push(`${v} turns ${turn.toFixed(0)}°`);
      }
    }
    expect(bad).toEqual([]);
  });
});

/** the apex of a collapsed corner can sit up to ~width/2·√2 from its design point */
const c2 = (t: RcTrack) => ((t.design.laneWidth ?? 2) / 2) * Math.SQRT2;
