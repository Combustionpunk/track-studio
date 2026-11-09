// The 3D viewer's scene builder (#83): pure, no WebGL. Built from `built` and the drawing area only.
import { bake, drawingArea, PIPE_THICKNESS, PLAN_PALETTE, type Built, type BuiltFeature, type Crossing, type Point2, type RcTrack } from "@track-studio/engine";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { homePose, topPose } from "../src/viewer3d/camera.js";
import { buildScene, carpetMesh, DECK_THICKNESS, jumpMesh, PIPE_SIDES, pipeMesh, sceneFromDoc, type MeshData } from "../src/viewer3d/scene.js";

const read = <T,>(p: string) => JSON.parse(readFileSync(p, "utf8")) as T;
const ref = (p: string) => read<RcTrack>(join(__dirname, "../../../reference", p));
const EXTRA = join(__dirname, "../../../packages/engine/test/fixtures/extra");
const extra = (name: string) => read<RcTrack>(join(EXTRA, `${name}.rctrack.json`));

/** Vertex k of a mesh, back in plan terms: [x, z, height]. */
const vert = (m: MeshData, k: number): [number, number, number] => [m.positions[3 * k], -m.positions[3 * k + 2], m.positions[3 * k + 1]];
const verts = (m: MeshData) => Array.from({ length: m.positions.length / 3 }, (_, k) => vert(m, k));
const hasVert = (m: MeshData, x: number, z: number, y: number, tol = 1e-4) => verts(m).some(([a, b, c]) => Math.abs(a - x) < tol && Math.abs(b - z) < tol && Math.abs(c - y) < tol);

/** Distance from p to the polyline (closed or not). */
function toPolyline(p: Point2, pts: Point2[], closed: boolean): number {
  let best = Infinity;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2)) : 0;
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz));
  }
  return best;
}

/** Even-odd: is p inside the two rings? */
function insideEvenOdd(p: Point2, rings: Point2[][]): boolean {
  let inside = false;
  for (const r of rings)
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, zi] = r[i], [xj, zj] = r[j];
      if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
    }
  return inside;
}

/** Total plan area of a flat mesh's triangles. */
function planArea(m: MeshData): number {
  let a = 0;
  for (let t = 0; t < m.indices.length; t += 3) {
    const [p, q, r] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]].map((k) => vert(m, k));
    a += Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1])) / 2;
  }
  return a;
}

function ringArea(r: Point2[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) a += r[i][0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * r[i][1];
  return Math.abs(a / 2);
}

const club = ref("examples/club-a.rctrack.json");

describe("pipes follow built.dividers", () => {
  it("every divider point is the top of the pipe, and the pipe never strays more than a pipe from its run", () => {
    const b = club.built!;
    const m = pipeMesh(b.dividers);
    for (const d of b.dividers) for (const [x, z] of d.points) expect(hasVert(m, x, z, PIPE_THICKNESS)).toBe(true);
    for (const [x, z, y] of verts(m)) {
      expect(y).toBeGreaterThanOrEqual(-1e-9);
      expect(y).toBeLessThanOrEqual(PIPE_THICKNESS + 1e-9);
      // mitred joints reach further out than the radius at a corner, at most twice as far
      expect(Math.min(...b.dividers.map((d) => toPolyline([x, z], d.points, d.closed)))).toBeLessThanOrEqual(PIPE_THICKNESS + 1e-6);
    }
  });

  it("is round, 8 cm across, and shared pipes look the same", () => {
    const run = { points: [[0, 0], [4, 0]] as Point2[], closed: false };
    const a = pipeMesh([{ ...run, shared: false }]), s = pipeMesh([{ ...run, shared: true }]);
    expect(Array.from(s.positions)).toEqual(Array.from(a.positions));
    const v = verts(a);
    expect(Math.max(...v.map((p) => p[1]))).toBeCloseTo(PIPE_THICKNESS / 2, 6);
    expect(Math.min(...v.map((p) => p[1]))).toBeCloseTo(-PIPE_THICKNESS / 2, 6);
    expect(Math.min(...v.map((p) => p[2]))).toBeCloseTo(0, 6);
    expect(buildScene({ area: drawingArea(club), built: club.built! }).meshes.filter((m) => m.part === "pipe")).toHaveLength(1);
  });

  it("a closed run joins up all round with no end caps; an open one is capped", () => {
    const sq: Point2[] = [[0, 0], [4, 0], [4, 4], [0, 4]];
    const tris = (closed: boolean) => pipeMesh([{ points: sq, shared: false, closed }]).indices.length / 3;
    expect(tris(true)).toBe(4 * PIPE_SIDES * 2);
    expect(tris(false)).toBe(3 * PIPE_SIDES * 2 + 2 * (PIPE_SIDES - 2));
    // the corner is mitred: its top is right over the divider point
    expect(hasVert(pipeMesh([{ points: sq, shared: false, closed: true }]), 0, 0, PIPE_THICKNESS)).toBe(true);
  });
});

describe("a jump's mesh matches its profile and heading", () => {
  /** Where the profile point (along, height) is on the jump's edge `side` (−1 right, +1 left of travel). */
  const expected = (f: BuiltFeature, along: number, side: number): Point2 => {
    const h = (f.heading * Math.PI) / 180, tx = Math.cos(h), tz = Math.sin(h);
    return [f.x + tx * (along - f.length / 2) - tz * side * (f.width / 2), f.z + tz * (along - f.length / 2) + tx * side * (f.width / 2)];
  };

  for (const [name, f] of [
    ["club-a's tabletop, heading 0°", club.built!.features[0]],
    ["club-a's double, heading 180°", club.built!.features[1]],
    ["the figure of eight's crossover, heading 45°", extra("crossover-figure8").built!.features[0]],
  ] as const) {
    it(name, () => {
      const m = jumpMesh(f);
      for (const [a, ht] of f.profile)
        for (const side of [-1, 1]) {
          const [x, z] = expected(f, a, side);
          expect(hasVert(m.top, x, z, ht), `top at ${a} m, side ${side}`).toBe(true);
          expect(hasVert(m.sides, x, z, 0), `foot of the side at ${a} m`).toBe(true);
        }
      const all = [...verts(m.top), ...verts(m.sides)];
      expect(Math.max(...all.map((v) => v[2]))).toBeCloseTo(f.height, 6);
      // every vertex inside the footprint (length × width at the heading)
      const h = (f.heading * Math.PI) / 180;
      for (const [x, z] of all) {
        const u = (x - f.x) * Math.cos(h) + (z - f.z) * Math.sin(h), v = -(x - f.x) * Math.sin(h) + (z - f.z) * Math.cos(h);
        expect(Math.abs(u)).toBeLessThanOrEqual(f.length / 2 + 1e-6);
        expect(Math.abs(v)).toBeLessThanOrEqual(f.width / 2 + 1e-6);
      }
    });
  }

  it("the top's normals tilt back against the direction of travel on the way up", () => {
    const f = club.built!.features[2]; // kicker, heading 0°: up from 0 to 0.6 m
    const m = jumpMesh(f).top;
    const up = Array.from({ length: m.normals.length / 3 }, (_, k) => [m.normals[3 * k], m.normals[3 * k + 1], -m.normals[3 * k + 2]]).find(([nx]) => nx < -1e-3);
    expect(up).toBeDefined();
    expect(up![1]).toBeGreaterThan(0); // and still upward
  });

  it("a jump without a profile is a flat block of its height", () => {
    const f: BuiltFeature = { type: "tabletop", x: 0, z: 0, heading: 90, length: 2, width: 1, height: 0.2, profile: [] };
    const m = jumpMesh(f);
    expect(Math.max(...verts(m.top).map((v) => v[2]))).toBeCloseTo(0.2);
    expect(hasVert(m.top, 0.5, -1, 0.2)).toBe(true);
  });
});

describe("the carpet uses built.lanes", () => {
  for (const [name, doc] of [
    ["club-a", club],
    ["freeform-example", ref("examples/freeform-example.rctrack.json")],
    ["peel-round", extra("peel-round")],
  ] as const) {
    it(`${name}: fills the even-odd band between the lane edges, at floor level`, () => {
      const b = doc.built!;
      const m = carpetMesh(b);
      for (const [, , y] of verts(m)) expect(y).toBeCloseTo(0, 2);
      const rings = [b.lanes!.right, b.lanes!.left];
      // its area is the band's: one ring inside the other (within 0.1 %: club-a's edges touch where pipes are shared)
      const band = Math.abs(ringArea(b.lanes!.right) - ringArea(b.lanes!.left));
      expect(Math.abs(planArea(m) - band) / band).toBeLessThan(0.001);
      // every triangle's centre is on the carpet
      for (let t = 0; t < m.indices.length; t += 3) {
        const [p, q, r] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]].map((k) => vert(m, k));
        expect(insideEvenOdd([(p[0] + q[0] + r[0]) / 3, (p[1] + q[1] + r[1]) / 3], rings)).toBe(true);
      }
    });
  }

  it("fills in the square where the track crosses itself, as the plan does", () => {
    const b = extra("unbridged-figure8").built!;
    const m = carpetMesh(b);
    const c = b.crossings![0];
    const centre = verts(m).some(([x, z]) => Math.hypot(x - c.x, z - c.z) < 1.5);
    expect(centre).toBe(true);
    // a point at the crossing is covered by some triangle
    let covered = false;
    for (let t = 0; t < m.indices.length && !covered; t += 3) {
      const [p, q, r] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]].map((k) => vert(m, k));
      const s = (a: number[], b: number[]) => (b[0] - a[0]) * (c.z - a[1]) - (b[1] - a[1]) * (c.x - a[0]);
      const d1 = s(p, q), d2 = s(q, r), d3 = s(r, p);
      covered = !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
    }
    expect(covered).toBe(true);
  });

  it("a file baked before lanes (v1.4) gets a carpet along the racing line at its lane width", () => {
    const b = { ...club.built! };
    delete (b as Partial<Built>).lanes;
    const m = carpetMesh(b);
    expect(m.indices.length).toBeGreaterThan(0);
    for (const [x, z] of verts(m)) expect(toPolyline([x, z], b.racingLine.map((p) => [p[0], p[1]] as Point2), true)).toBeLessThan(1.0 + 0.05);
  });
});

describe("the scene", () => {
  it("is built from built and the drawing area: nothing is read from design", () => {
    for (const doc of [club, extra("crossover-figure8")]) {
      const guarded = new Proxy(doc, {
        get(t, k) {
          if (k === "design") throw new Error("the 3D viewer read design");
          return Reflect.get(t, k);
        },
        has(t, k) {
          if (k === "design") throw new Error("the 3D viewer read design");
          return Reflect.has(t, k);
        },
      });
      expect(() => sceneFromDoc(guarded)).not.toThrow();
    }
  });

  it("has the area as the floor, one mesh per colour, in the plan palette", () => {
    const s = buildScene({ area: drawingArea(club), built: club.built! });
    const parts = s.meshes.map((m) => m.part);
    expect(new Set(parts).size).toBe(parts.length); // merged: one mesh per part
    expect(parts).toEqual(expect.arrayContaining(["area", "carpet", "pipe", "jump", "jumpSide", "startA", "startB", "line"]));
    const colour = (p: string) => s.meshes.find((m) => m.part === p)!.colour;
    expect(colour("area")).toBe(PLAN_PALETTE["plan-area"]);
    expect(colour("carpet")).toBe(PLAN_PALETTE["plan-carpet"]);
    expect(colour("pipe")).toBe(PLAN_PALETTE["plan-pipe"]);
    expect(colour("jump")).toBe(PLAN_PALETTE["plan-jump"]);
    expect(colour("line")).toBe(PLAN_PALETTE["plan-line"]);
    expect(s.background).toBe(PLAN_PALETTE["plan-floor"]);
    const area = s.meshes.find((m) => m.part === "area")!;
    expect(planArea(area)).toBeCloseTo(22 * 12, 6);
  });

  it("puts the chequered start line across the lane at built.startLine", () => {
    const s = buildScene({ area: drawingArea(club), built: club.built! });
    const st = club.built!.startLine;
    const a = s.meshes.find((m) => m.part === "startA")!, b = s.meshes.find((m) => m.part === "startB")!;
    expect(planArea(a) + planArea(b)).toBeCloseTo(st.width * (2 * st.width) / Math.max(4, Math.round(st.width / 0.2)), 6);
    for (const [x, z] of [...verts(a), ...verts(b)]) expect(Math.hypot(x - st.x, z - st.z)).toBeLessThanOrEqual(Math.hypot(st.width / 2, 0.4) + 1e-6);
  });

  it("the racing line follows built.racingLine", () => {
    const b = club.built!;
    const line = buildScene({ area: drawingArea(club), built: b }).meshes.find((m) => m.part === "line")!;
    const pts = b.racingLine.map((p) => [p[0], p[1]] as Point2);
    for (const [x, z] of verts(line)) expect(toPolyline([x, z], pts, true)).toBeLessThan(0.05);
  });

  it("builds every reference and fixture file without NaN", () => {
    const files = [
      ...readdirSync(join(__dirname, "../../../reference/examples")).filter((f) => f.endsWith(".rctrack.json")).map((f) => join(__dirname, "../../../reference/examples", f)),
      ...readdirSync(EXTRA).filter((f) => f.endsWith(".rctrack.json")).map((f) => join(EXTRA, f)),
    ];
    for (const f of files) {
      const s = sceneFromDoc(read<RcTrack>(f));
      for (const m of s.meshes) {
        expect(m.positions.every(Number.isFinite), `${f} ${m.part}`).toBe(true);
        expect(m.normals.every(Number.isFinite), `${f} ${m.part} normals`).toBe(true);
        expect(Math.max(...m.indices)).toBeLessThan(m.positions.length / 3);
        expect(backFacing(m), `${f} ${m.part}: triangles wound against their normals`).toBe(0);
      }
    }
  });

  it("a 60 × 30 m layout with 40 corners and 10 jumps stays small: a handful of meshes, under 100k triangles", () => {
    const doc = bigLayout();
    const t0 = performance.now();
    const s = sceneFromDoc(doc);
    const ms = performance.now() - t0;
    const tris = s.meshes.reduce((n, m) => n + m.indices.length / 3, 0);
    expect(s.meshes.length).toBeLessThanOrEqual(8);
    expect(tris).toBeLessThan(100_000);
    expect(ms).toBeLessThan(1000);
  });
});

describe("crossings: the over pass on the bridge, the under pass beneath (#71)", () => {
  const BRIDGED = ["crossover-figure8", "tabletop-figure8", "two-crossings", "shallow-crossing"];
  const part = (s: ReturnType<typeof buildScene>, p: string) => s.meshes.find((m) => m.part === p)!;
  const sceneOf = (doc: RcTrack) => buildScene({ area: drawingArea(doc), built: doc.built! });

  /** A feature's frame: where along / across put you, and the other way round. */
  const frameOf = (f: BuiltFeature) => {
    const h = (f.heading * Math.PI) / 180, t: Point2 = [Math.cos(h), Math.sin(h)], n: Point2 = [-t[1], t[0]];
    const x0 = f.x - (t[0] * f.length) / 2, z0 = f.z - (t[1] * f.length) / 2;
    return {
      t, n,
      at: (along: number, across = 0): Point2 => [x0 + t[0] * along + n[0] * across, z0 + t[1] * along + n[1] * across],
      along: ([x, z]: Point2) => (x - x0) * t[0] + (z - z0) * t[1],
      across: ([x, z]: Point2) => (x - x0) * n[0] + (z - z0) * n[1],
    };
  };
  const profileAt = (f: BuiltFeature, a: number) => {
    const p = f.profile;
    if (a < p[0][0] || a > p[p.length - 1][0]) return 0;
    for (let k = 0; k + 1 < p.length; k++)
      if (a <= p[k + 1][0]) return p[k][1] + ((p[k + 1][1] - p[k][1]) * (a - p[k][0])) / (p[k + 1][0] - p[k][0] || 1);
    return 0;
  };
  /** How high the over pass is at p: the highest bridge whose lane p is on (bridges on one pass can overlap). */
  const bridgeHeight = (b: Built, p: Point2) =>
    Math.max(0, ...bridgedFeatures(b).map((f) => {
      const fr = frameOf(f);
      return Math.abs(fr.across(p)) <= f.width / 2 + PIPE_THICKNESS ? profileAt(f, fr.along(p)) : 0;
    }));
  const bridgedFeatures = (b: Built) => [...new Set((b.crossings ?? []).filter((c) => c.bridge && c.over).map((c) => c.bridge!.feature))].map((i) => b.features[i]);

  /** The heights at plan point p of every (not vertical) triangle of m over it. */
  function heightsAt(m: MeshData, [x, z]: Point2): number[] {
    const out: number[] = [];
    for (let t = 0; t < m.indices.length; t += 3) {
      const [p, q, r] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]].map((k) => vert(m, k));
      const det = (q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1]);
      if (Math.abs(det) < 1e-12) continue;
      const u = ((x - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (z - p[1])) / det, v = ((q[0] - p[0]) * (z - p[1]) - (x - p[0]) * (q[1] - p[1])) / det;
      if (u >= -1e-9 && v >= -1e-9 && u + v <= 1 + 1e-9) out.push(p[2] + u * (q[2] - p[2]) + v * (r[2] - p[2]));
    }
    return out;
  }

  /** The direction of the racing line at lap distance d. */
  function passDir(b: Built, d: number): Point2 {
    const L = b.racingLine;
    let s = 0;
    for (let i = 0; i < L.length; i++) {
      const a = L[i], c = L[(i + 1) % L.length], l = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (s + l >= d) return [(c[0] - a[0]) / l, (c[1] - a[1]) / l];
      s += l;
    }
    throw new Error("past the end of the lap");
  }
  const underOf = (b: Built, c: Crossing) => {
    const d = c.distances[c.over === "first" ? 1 : 0];
    const t = passDir(b, d);
    return { t, n: [-t[1], t[0]] as Point2, w: b.racingLine[0][2] };
  };

  for (const name of BRIDGED) {
    const doc = extra(name), b = doc.built!, s = sceneOf(doc);
    const carpet = part(s, "carpet"), line = part(s, "line"), pipe = part(s, "pipe");

    it(`${name}: the over pass's carpet and racing line follow the bridge's profile along its length`, () => {
      for (const f of bridgedFeatures(b)) {
        const fr = frameOf(f);
        for (let a = 0; a <= f.length + 1e-9; a += f.length / 40) {
          for (const across of [-0.8, 0, 0.8]) {
            const p = fr.at(a, across), want = bridgeHeight(b, p);
            const hs = heightsAt(carpet, p);
            expect(hs.length, `carpet at ${a.toFixed(2)} m, ${across} across`).toBeGreaterThan(0);
            expect(Math.max(...hs), `carpet at ${a.toFixed(2)} m, ${across} across`).toBeCloseTo(want + 0.002, 3);
          }
          expect(Math.max(...heightsAt(line, fr.at(a))), `line at ${a.toFixed(2)} m`).toBeCloseTo(bridgeHeight(b, fr.at(a)) + 0.006, 3);
        }
      }
    });

    it(`${name}: the over pass's pipes ride the bridge, at each step of its profile`, () => {
      for (const f of bridgedFeatures(b)) {
        const fr = frameOf(f);
        for (const [a] of f.profile)
          for (const side of [-1, 1]) {
            const p = fr.at(a, side * (f.width / 2 + PIPE_THICKNESS / 2)), want = bridgeHeight(b, p) + PIPE_THICKNESS;
            const near = verts(pipe).filter(([x, z, y]) => Math.hypot(x - p[0], z - p[1]) < 0.03 && Math.abs(y - want) < 0.005);
            expect(near.length, `pipe top at ${a} m, side ${side}`).toBeGreaterThan(0);
          }
      }
    });

    it(`${name}: the under pass stays on the floor, pipes and all, with a clear gap under the deck`, () => {
      for (const c of b.crossings!.filter((c) => c.bridge && c.over)) {
        const f = b.features[c.bridge!.feature], fr = frameOf(f), top = f.height;
        const u = underOf(b, c);
        // the under pass's carpet and racing line run through at floor level
        for (let k = -u.w; k <= u.w; k += 0.1) {
          const p: Point2 = [c.x + u.t[0] * k, c.z + u.t[1] * k];
          expect(Math.min(...heightsAt(carpet, p)), `under carpet at ${k.toFixed(1)}`).toBeCloseTo(0.002, 3);
          expect(Math.min(...heightsAt(line, p)), `under line at ${k.toFixed(1)}`).toBeCloseTo(0.006, 3);
        }
        // under the deck, over the under pass's lane (and its pipes): nothing between the pipes and the deck's underside
        const under = (x: number, z: number) => {
          const a = fr.along([x, z]), across = fr.across([x, z]);
          const v = (x - c.x) * u.n[0] + (z - c.z) * u.n[1];
          return a > 0 && a < f.length && Math.abs(across) < f.width / 2 - 1e-3 && Math.abs(v) <= u.w / 2 + PIPE_THICKNESS;
        };
        for (const m of s.meshes)
          for (const [x, z, y] of verts(m))
            if (under(x, z)) expect(y <= PIPE_THICKNESS + 1e-6 || y >= top - DECK_THICKNESS - 1e-6, `${m.part} at ${x.toFixed(2)}, ${z.toFixed(2)}, ${y.toFixed(3)}`).toBe(true);
        // and its pipes really pass beneath: pipe in the under lane's band, at the floor
        const pipesUnder = verts(pipe).filter(([x, z]) => under(x, z));
        expect(pipesUnder.length).toBeGreaterThan(0);
        for (const [, , y] of pipesUnder) expect(y).toBeLessThanOrEqual(PIPE_THICKNESS + 1e-6);
      }
    });

    it(`${name}: the bridge deck is drawn from the footprint, with sides you can see`, () => {
      const sides = part(s, "jumpSide");
      for (const c of b.crossings!.filter((c) => c.bridge && c.over)) {
        const f = b.features[c.bridge!.feature], fr = frameOf(f);
        // the footprint's corners are the ramps' feet
        for (const [x, z] of c.footprint!) expect(hasVert(sides, x, z, 0, 1e-3), `foot at ${x}, ${z}`).toBe(true);
        // over the crossing, the deck's sides run from its underside up to its top, along both long edges
        const a = fr.along([c.x, c.z]);
        for (const side of [-1, 1]) {
          const [x, z] = fr.at(a, (side * f.width) / 2);
          const ys = verts(sides).filter(([vx, vz]) => Math.abs(fr.across([vx, vz]) - (side * f.width) / 2) < 1e-6 && Math.abs(fr.along([vx, vz]) - a) < f.length / 2).map((v) => v[2]);
          expect(ys.some((y) => Math.abs(y - (f.height - DECK_THICKNESS)) < 1e-6), `underside at ${x.toFixed(2)}, ${z.toFixed(2)}`).toBe(true);
          expect(ys.some((y) => Math.abs(y - f.height) < 1e-6), `top edge at ${x.toFixed(2)}, ${z.toFixed(2)}`).toBe(true);
        }
      }
      // the bridge is drawn instead of the feature's ordinary jump, not as well
      const jumps = b.features.filter((f) => !bridgedFeatures(b).includes(f));
      const top = s.meshes.find((m) => m.part === "jump");
      const ordinary = jumps.reduce((n, f) => n + jumpMesh(f).top.indices.length, 0);
      expect(top?.indices.length ?? 0).toBe(ordinary);
    });
  }

  for (const name of ["unbridged-figure8", "crossover-low-figure8", "crossover-unused-figure8"]) {
    it(`${name}: a crossing nothing bridges has both passes on the floor, and no bridge`, () => {
      const doc = extra(name), b = doc.built!, s = sceneOf(doc);
      expect(b.crossings!.every((c) => !c.bridge)).toBe(true);
      for (const p of ["carpet", "line", "pipe", "startA", "startB"] as const)
        for (const [, , y] of verts(part(s, p))) expect(y, p).toBeLessThanOrEqual(PIPE_THICKNESS + 1e-6);
      // any crossover there is an ordinary ramp, as before
      const top = s.meshes.find((m) => m.part === "jump");
      expect(Array.from(top?.positions ?? [])).toEqual(b.features.flatMap((f) => Array.from(jumpMesh(f).top.positions)));
      expect(s.bridges).toEqual([]);
    });
  }

  it("swapping the over pass puts the other pass on top", () => {
    const doc = extra("crossover-figure8");
    const c0 = doc.built!.crossings![0];
    const swapped = structuredClone(doc);
    swapped.design.features![0] = { ...swapped.design.features![0], over: "second", distance: c0.distances[1] };
    const docs = { first: doc, second: bake(swapped) };
    for (const [over, d] of Object.entries(docs)) {
      const b = d.built!, c = b.crossings![0], s = sceneOf(d);
      expect(c.over).toBe(over);
      expect(s.bridges).toEqual([{ feature: 0, over }]);
      const carpet = part(s, "carpet");
      // 3 m back from the crossing, on each pass: on the ramp of the over pass, on the floor of the other
      for (const pass of [0, 1]) {
        const t = passDir(b, c.distances[pass]);
        const hs = heightsAt(carpet, [c.x - t[0] * 3, c.z - t[1] * 3]);
        const raised = Math.max(...hs) > 0.1;
        expect(raised, `pass ${pass} with ${over} over`).toBe((pass === 0) === (over === "first"));
      }
    }
  });
});

describe("the camera", () => {
  const area = { length: 22, width: 12 };
  it("starts at a 3/4 view from over the south-west corner, looking at the middle", () => {
    const p = homePose(area, 45, 16 / 9);
    expect(p.target).toEqual([0, 0, 0]);
    const [x, y, z] = p.position;
    expect(x).toBeLessThan(0); // west
    expect(z).toBeGreaterThan(0); // south (three's +z is the plan's −z)
    expect(y).toBeGreaterThan(0);
    const elev = (Math.atan2(y, Math.hypot(x, z)) * 180) / Math.PI;
    expect(elev).toBeGreaterThan(20);
    expect(elev).toBeLessThan(60);
  });

  it("fits the whole area: every corner of it is in front of the camera and inside the field of view", () => {
    for (const aspect of [16 / 9, 375 / 300, 0.6]) {
      const p = homePose(area, 45, aspect);
      for (const pose of [p, topPose(area, 45, aspect)]) {
        const [cx, cy, cz] = pose.position;
        const f = norm([pose.target[0] - cx, pose.target[1] - cy, pose.target[2] - cz]);
        const r = norm(cross(f, [0, 1, 0]).every((v) => Math.abs(v) < 1e-9) ? [1, 0, 0] : cross(f, [0, 1, 0]));
        const u = cross(r, f);
        const tv = Math.tan((45 / 2) * (Math.PI / 180));
        for (const [ax, az] of [[-11, -6], [11, -6], [11, 6], [-11, 6]]) {
          const d = [ax - cx, -cy, -az - cz];
          const depth = dot(d, f);
          expect(depth).toBeGreaterThan(0);
          expect(Math.abs(dot(d, u) / depth)).toBeLessThanOrEqual(tv);
          expect(Math.abs(dot(d, r) / depth)).toBeLessThanOrEqual(tv * aspect);
        }
      }
    }
  });

  it("the top view looks straight down with north up", () => {
    const p = topPose(area, 45, 1.5);
    expect(p.position[0]).toBeCloseTo(0);
    expect(p.position[1]).toBeGreaterThan(5);
    expect(Math.abs(p.position[2])).toBeLessThan(0.01 * p.position[1]);
    expect(p.position[2]).toBeGreaterThanOrEqual(0); // a hair to the south, so north is up on screen
  });
});

/** Triangles whose front face (counter-clockwise, three.js) points away from their vertex normals: lit as if flipped. */
function backFacing(m: MeshData): number {
  let bad = 0;
  const P = m.positions, N = m.normals;
  for (let t = 0; t < m.indices.length; t += 3) {
    const [a, b, c] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]];
    const u = [P[3 * b] - P[3 * a], P[3 * b + 1] - P[3 * a + 1], P[3 * b + 2] - P[3 * a + 2]];
    const v = [P[3 * c] - P[3 * a], P[3 * c + 1] - P[3 * a + 1], P[3 * c + 2] - P[3 * a + 2]];
    const f = cross(u, v);
    const n = [a, b, c].reduce((s, k) => [s[0] + N[3 * k], s[1] + N[3 * k + 1], s[2] + N[3 * k + 2]], [0, 0, 0]);
    if (dot(f, n) < -1e-12) bad++;
  }
  return bad;
}

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: number[]) => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return a.map((v) => v / l);
};

/**
 * A big built section by hand: a 56 × 26 m zig-zag loop (40 corners, round ones at 24 steps) with 10 jumps, its lane
 * edges and pipes offset from the racing line. Only the scene builder's load matters, not the geometry's sense.
 */
function bigLayout(): RcTrack {
  const corners: Point2[] = [];
  for (let i = 0; i < 20; i++) corners.push([-28 + (56 * i) / 19, i % 2 ? -13 : -9]);
  for (let i = 19; i >= 0; i--) corners.push([-28 + (56 * i) / 19, i % 2 ? 9 : 13]);
  const line: Point2[] = [];
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i], b = corners[(i + 1) % corners.length];
    for (let k = 0; k < 24; k++) line.push([a[0] + ((b[0] - a[0]) * k) / 24, a[1] + ((b[1] - a[1]) * k) / 24]);
  }
  const off = (d: number): Point2[] => line.map((p, i) => {
    const q = line[(i + 1) % line.length], t = norm([q[0] - p[0], 0, q[1] - p[1]]);
    return [p[0] - t[2] * d, p[1] + t[0] * d];
  });
  const built = {
    generator: "test",
    lapLength: 200,
    racingLine: line.map((p) => [p[0], p[1], 2] as [number, number, number]),
    dividers: [{ points: off(1.04), shared: false, closed: true }, { points: off(-1.04), shared: false, closed: true }],
    features: Array.from({ length: 10 }, (_, i): BuiltFeature => ({ type: "double", x: -20 + 4 * i, z: -11, heading: 0, length: 2.6, width: 1.9, height: 0.15, profile: [[0, 0], [0.55, 0.15], [0.85, 0], [1.75, 0], [2.05, 0.15], [2.6, 0]] })),
    startLine: { x: 0, z: 11, heading: 180, width: 2, distance: 0 },
    checks: [],
    footprint: { cell: 0.25, origin: [-30, -15], rows: 0, cols: 0, bbox: [-30, -15, 30, 15], rle: "" },
    lanes: { right: off(1), left: off(-1) },
    size: { length: 58, width: 28, bbox: [-29, -14, 29, 14] },
    stats: { dividerLength: 0, dividerRuns: 2, corners: 40 },
  } as Built;
  return { format: "rctrack", version: 1, id: "big", revision: 1, info: { name: "Big" }, area: { length: 60, width: 30 }, design: { points: [] }, built } as unknown as RcTrack;
}
