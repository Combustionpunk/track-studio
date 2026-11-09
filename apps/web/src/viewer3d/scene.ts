// The 3D viewer's scene (#83), as plain mesh data: pure, no three.js, no DOM, so it's tested without WebGL. Built
// from `built` and the drawing area only, never `design` (consumers draw built). One mesh per colour, so a big layout
// is still a handful of draw calls.
//
// Positions are in three.js axes: x = plan x (east), y = up, z = −plan z (three's +z is south). Normals likewise.
import { crossingCarpet, drawingArea, PIPE_THICKNESS, PLAN_PALETTE, type Area, type Built, type BuiltFeature, type Divider, type Point2, type RcTrack } from "@track-studio/engine";

export type Part = "area" | "carpet" | "pipe" | "jump" | "jumpSide" | "startA" | "startB" | "line";

export interface MeshData {
  part: Part;
  colour: string;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export interface Scene3D {
  area: Area;
  background: string;
  meshes: MeshData[];
  triangles: number;
}

/** Round pipes: this many sides. */
export const PIPE_SIDES = 8;

// heights of the flat layers, a few mm apart so they don't fight
const CARPET_Y = 0.002;
const START_Y = 0.004;
const LINE_Y = 0.006;
const LINE_WIDTH = 0.05;

const COLOUR: Record<Part, string> = {
  area: PLAN_PALETTE["plan-area"],
  carpet: PLAN_PALETTE["plan-carpet"],
  pipe: PLAN_PALETTE["plan-pipe"],
  jump: PLAN_PALETTE["plan-jump"],
  jumpSide: PLAN_PALETTE["plan-jump-edge"],
  startA: PLAN_PALETTE["plan-pipe"],
  startB: PLAN_PALETTE["plan-floor"],
  line: PLAN_PALETTE["plan-line"],
};

/** Collects one mesh. Takes plan coordinates (x, z, height) and normals (nx, up, nz). */
class Mesh {
  private pos: number[] = [];
  private nor: number[] = [];
  private idx: number[] = [];
  vert(x: number, z: number, y: number, nx = 0, ny = 1, nz = 0): number {
    this.pos.push(x, y, -z);
    this.nor.push(nx, ny, -nz);
    return this.pos.length / 3 - 1;
  }
  /** A triangle, wound so its front faces the way its normals point (the renderer lights back faces as if flipped). */
  tri(a: number, b: number, c: number) {
    const P = this.pos, N = this.nor;
    const ux = P[3 * b] - P[3 * a], uy = P[3 * b + 1] - P[3 * a + 1], uz = P[3 * b + 2] - P[3 * a + 2];
    const vx = P[3 * c] - P[3 * a], vy = P[3 * c + 1] - P[3 * a + 1], vz = P[3 * c + 2] - P[3 * a + 2];
    const [fx, fy, fz] = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    let dot = 0;
    for (const k of [a, b, c]) dot += fx * N[3 * k] + fy * N[3 * k + 1] + fz * N[3 * k + 2];
    if (dot < 0) this.idx.push(a, c, b);
    else this.idx.push(a, b, c);
  }
  quad(a: number, b: number, c: number, d: number) {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }
  /** A flat quad facing `n` (plan normal), with its own vertices. */
  face(p: [number, number, number][], n: [number, number, number]) {
    const [a, b, c, d] = p.map(([x, z, y]) => this.vert(x, z, y, ...n));
    this.quad(a, b, c, d);
  }
  done(part: Part): MeshData {
    return { part, colour: COLOUR[part], positions: new Float32Array(this.pos), normals: new Float32Array(this.nor), indices: new Uint32Array(this.idx) };
  }
}

const unit = (x: number, z: number): Point2 => {
  const l = Math.hypot(x, z);
  return l > 1e-12 ? [x / l, z / l] : [0, 0];
};

/** Consecutive repeats dropped; for a closed ring, a last point repeating the first too. */
function clean(pts: Point2[], closed: boolean): Point2[] {
  const out: Point2[] = [];
  for (const p of pts) if (!out.length || Math.hypot(p[0] - out[out.length - 1][0], p[1] - out[out.length - 1][1]) > 1e-6) out.push(p);
  if (closed && out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= 1e-6) out.pop();
  return out;
}

/**
 * At each point of a polyline: the sideways normal (left of travel) and how far to scale an offset along it so the
 * sides stay parallel to both segments (a mitre; beyond a 120° turn it's held at twice the offset, so a hairpin
 * doesn't grow a spike).
 */
function mitres(pts: Point2[], closed: boolean): { n: Point2; scale: number }[] {
  const len = pts.length;
  return pts.map((p, i) => {
    const prev = i > 0 || closed ? pts[(i - 1 + len) % len] : null;
    const next = i < len - 1 || closed ? pts[(i + 1) % len] : null;
    const tin = prev && unit(p[0] - prev[0], p[1] - prev[1]);
    const tout = next && unit(next[0] - p[0], next[1] - p[1]);
    if (tin && tout) {
      let b = unit(tin[0] + tout[0], tin[1] + tout[1]);
      if (!b[0] && !b[1]) b = tin; // a full reversal
      return { n: [-b[1], b[0]], scale: 1 / Math.max(b[0] * tin[0] + b[1] * tin[1], 0.5) };
    }
    const t = (tin ?? tout)!;
    return { n: [-t[1], t[0]], scale: 1 };
  });
}

// ------------------------------------------------------------------------------------------------------------- pipes

function addPipe(m: Mesh, d: Divider) {
  const pts = clean(d.points, d.closed);
  if (pts.length < 2) return;
  const closed = d.closed && pts.length > 2;
  const r = PIPE_THICKNESS / 2;
  const frames = mitres(pts, closed);
  const rings = pts.map((p, i) => {
    const { n, scale } = frames[i];
    return Array.from({ length: PIPE_SIDES }, (_, k) => {
      const a = (2 * Math.PI * k) / PIPE_SIDES, c = Math.cos(a), s = Math.sin(a);
      return m.vert(p[0] + n[0] * r * c * scale, p[1] + n[1] * r * c * scale, r + r * s, n[0] * c, s, n[1] * c);
    });
  });
  const segs = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < segs; i++) {
    const a = rings[i], b = rings[(i + 1) % rings.length];
    for (let k = 0; k < PIPE_SIDES; k++) {
      const k1 = (k + 1) % PIPE_SIDES;
      m.quad(a[k], b[k], b[k1], a[k1]);
    }
  }
  if (closed) return;
  // end caps, facing out along the pipe
  for (const [i, j] of [[0, 1], [pts.length - 1, pts.length - 2]]) {
    const t = unit(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
    const { n } = frames[i];
    const cap = Array.from({ length: PIPE_SIDES }, (_, k) => {
      const a = (2 * Math.PI * k) / PIPE_SIDES, c = Math.cos(a), s = Math.sin(a);
      return m.vert(pts[i][0] + n[0] * r * c, pts[i][1] + n[1] * r * c, r + r * s, t[0], 0, t[1]);
    });
    for (let k = 1; k + 1 < PIPE_SIDES; k++) m.tri(cap[0], cap[k], cap[k + 1]);
  }
}

/** Every divider run as a round pipe of PIPE_THICKNESS, lying on the floor. Shared pipes are the same pipe. */
export function pipeMesh(dividers: Divider[]): MeshData {
  const m = new Mesh();
  for (const d of dividers) addPipe(m, d);
  return m.done("pipe");
}

// ------------------------------------------------------------------------------------------------------------- jumps

function addJump(top: Mesh, sides: Mesh, f: BuiltFeature) {
  const h = (f.heading * Math.PI) / 180;
  const tx = Math.cos(h), tz = Math.sin(h), nx = -tz, nz = tx;
  const half = f.width / 2;
  const at = (along: number, across: number, y: number): [number, number, number] => [f.x + tx * (along - f.length / 2) + nx * across, f.z + tz * (along - f.length / 2) + nz * across, y];
  const profile: Point2[] = f.profile.length > 1 ? f.profile : [[0, f.height], [f.length, f.height]];
  for (let j = 0; j + 1 < profile.length; j++) {
    const [a0, h0] = profile[j], [a1, h1] = profile[j + 1];
    if (h0 <= 1e-6 && h1 <= 1e-6) continue; // flat on the floor: the carpet shows, as on the plan
    const [ua, uy] = unit(a1 - a0, h1 - h0);
    // the top: across the width, tilted with the profile
    top.face([at(a0, -half, h0), at(a1, -half, h1), at(a1, half, h1), at(a0, half, h0)], [-tx * uy, ua, -tz * uy]);
    // the sides, down to the floor
    for (const s of [-1, 1]) sides.face([at(a0, s * half, 0), at(a1, s * half, 0), at(a1, s * half, h1), at(a0, s * half, h0)], [nx * s, 0, nz * s]);
  }
  // square ends where the profile starts or stops above the floor
  const [first, last] = [profile[0], profile[profile.length - 1]];
  if (first[1] > 1e-6) sides.face([at(first[0], -half, 0), at(first[0], half, 0), at(first[0], half, first[1]), at(first[0], -half, first[1])], [-tx, 0, -tz]);
  if (last[1] > 1e-6) sides.face([at(last[0], -half, 0), at(last[0], half, 0), at(last[0], half, last[1]), at(last[0], -half, last[1])], [tx, 0, tz]);
}

/** One jump: its profile (along × height) extruded across its width, at x, z, heading. */
export function jumpMesh(f: BuiltFeature): { top: MeshData; sides: MeshData } {
  const top = new Mesh(), sides = new Mesh();
  addJump(top, sides, f);
  return { top: top.done("jump"), sides: sides.done("jumpSide") };
}

// ------------------------------------------------------------------------------------------------------------ carpet

/**
 * The even-odd fill of some rings as triangles, at height y: cut into slabs at every vertex and crossing, pair up the
 * edges across each slab left to right, and fill between each pair.
 */
function addEvenOdd(m: Mesh, rings: Point2[][], y: number) {
  type Edge = { x0: number; z0: number; x1: number; z1: number };
  const edges: Edge[] = [];
  const zs: number[] = [];
  for (const ring of rings) {
    const r = clean(ring, true);
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      zs.push(a[1]);
      if (a[1] === b[1]) continue; // level: doesn't change which side is inside
      edges.push(a[1] < b[1] ? { x0: a[0], z0: a[1], x1: b[0], z1: b[1] } : { x0: b[0], z0: b[1], x1: a[0], z1: a[1] });
    }
  }
  // where edges cross, the order across a slab changes: cut there too
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length; j++) {
      const p = edges[i], q = edges[j];
      if (p.z1 <= q.z0 || q.z1 <= p.z0) continue;
      const dx1 = p.x1 - p.x0, dz1 = p.z1 - p.z0, dx2 = q.x1 - q.x0, dz2 = q.z1 - q.z0;
      const den = dx1 * dz2 - dz1 * dx2;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((q.x0 - p.x0) * dz2 - (q.z0 - p.z0) * dx2) / den, u = ((q.x0 - p.x0) * dz1 - (q.z0 - p.z0) * dx1) / den;
      if (t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9) zs.push(p.z0 + t * dz1);
    }
  zs.sort((a, b) => a - b);
  const cuts = zs.filter((z, i) => i === 0 || z - zs[i - 1] > 1e-9);
  edges.sort((a, b) => a.z0 - b.z0);
  const xAt = (e: Edge, z: number) => e.x0 + ((e.x1 - e.x0) * (z - e.z0)) / (e.z1 - e.z0);
  let from = 0;
  for (let s = 0; s + 1 < cuts.length; s++) {
    const za = cuts[s], zb = cuts[s + 1], zm = (za + zb) / 2;
    while (from < edges.length && edges[from].z1 <= za) from++; // (edges only start later; ones ending early are skipped below)
    const across: { a: number; b: number; m: number }[] = [];
    for (let k = from; k < edges.length && edges[k].z0 < zm; k++) {
      const e = edges[k];
      if (e.z1 > zm) across.push({ a: xAt(e, za), b: xAt(e, zb), m: xAt(e, zm) });
    }
    across.sort((p, q) => p.m - q.m);
    for (let k = 0; k + 1 < across.length; k += 2) {
      const l = across[k], r = across[k + 1];
      const v = [m.vert(l.a, za, y), m.vert(r.a, za, y), m.vert(r.b, zb, y), m.vert(l.b, zb, y)];
      if (r.a - l.a > 1e-9) m.tri(v[0], v[1], v[2]);
      if (r.b - l.b > 1e-9) m.tri(v[0], v[2], v[3]);
    }
  }
}

/** A band along a polyline, `half(i)` either side of it, at height y (the racing line; old files' carpet). */
function addRibbon(m: Mesh, pts: Point2[], closed: boolean, half: (i: number) => number, y: number) {
  const frames = mitres(pts, closed);
  const sides = pts.map((p, i) => {
    const { n, scale } = frames[i], w = half(i) * scale;
    return [m.vert(p[0] - n[0] * w, p[1] - n[1] * w, y), m.vert(p[0] + n[0] * w, p[1] + n[1] * w, y)];
  });
  const segs = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < segs; i++) {
    const a = sides[i], b = sides[(i + 1) % sides.length];
    m.quad(a[0], b[0], b[1], a[1]);
  }
}

/**
 * The carpet: the band between built.lanes' two edges (even-odd), with the squares where the track crosses itself
 * filled in, as the plan draws it. Files baked before v1.4 have no lanes: a band along the racing line at its width.
 */
export function carpetMesh(built: Built): MeshData {
  const m = new Mesh();
  if (built.lanes) addEvenOdd(m, [built.lanes.right, built.lanes.left], CARPET_Y);
  else {
    const line = clean(built.racingLine.map(([x, z]) => [x, z] as Point2), true);
    const w = built.racingLine.map((p) => p[2] / 2);
    addRibbon(m, line, true, (i) => w[Math.min(i, w.length - 1)], CARPET_Y);
  }
  for (const q of crossingCarpet(built)) {
    const [a, b, c, d] = q.map(([x, z]) => m.vert(x, z, CARPET_Y));
    m.quad(a, b, c, d);
  }
  return m.done("carpet");
}

// ------------------------------------------------------------------------------------------------------------- scene

/** Chequered start line: two rows of squares across the lane at built.startLine, as the plan draws it. */
function addStart(a: Mesh, b: Mesh, built: Built) {
  const s = built.startLine;
  if (!s) return;
  const h = (s.heading * Math.PI) / 180;
  const t: Point2 = [Math.cos(h), Math.sin(h)], n: Point2 = [-t[1], t[0]];
  const at = (u: number, v: number): [number, number, number] => [s.x + t[0] * u + n[0] * v, s.z + t[1] * u + n[1] * v, START_Y];
  const across = Math.max(4, Math.round(s.width / 0.2));
  const sq = s.width / across;
  for (let row = 0; row < 2; row++)
    for (let k = 0; k < across; k++) {
      const u0 = (row - 1) * sq, v0 = -s.width / 2 + k * sq;
      ((row + k) % 2 ? b : a).face([at(u0, v0), at(u0 + sq, v0), at(u0 + sq, v0 + sq), at(u0, v0 + sq)], [0, 1, 0]);
    }
}

/** The whole layout: the area as the floor, carpet, pipes, jumps, start line and racing line. */
export function buildScene({ area, built }: { area: Area; built: Built }): Scene3D {
  const floor = new Mesh();
  const L = area.length / 2, W = area.width / 2;
  floor.face([[-L, -W, 0], [L, -W, 0], [L, W, 0], [-L, W, 0]], [0, 1, 0]);

  const top = new Mesh(), sides = new Mesh();
  for (const f of built.features ?? []) addJump(top, sides, f);

  const startA = new Mesh(), startB = new Mesh();
  addStart(startA, startB, built);

  const line = new Mesh();
  const rl = clean(built.racingLine.map(([x, z]) => [x, z] as Point2), true);
  if (rl.length > 2) addRibbon(line, rl, true, () => LINE_WIDTH / 2, LINE_Y);

  const meshes = [floor.done("area"), carpetMesh(built), pipeMesh(built.dividers ?? []), top.done("jump"), sides.done("jumpSide"), startA.done("startA"), startB.done("startB"), line.done("line")].filter(
    (m) => m.indices.length > 0,
  );
  return { area, background: PLAN_PALETTE["plan-floor"], meshes, triangles: meshes.reduce((n, m) => n + m.indices.length / 3, 0) };
}

/** The scene for a layout file: its drawing area and built section (never its design). */
export function sceneFromDoc(doc: Pick<RcTrack, "area" | "built">): Scene3D {
  const built = doc.built;
  if (!built) throw new Error("This layout has no built section to draw.");
  return buildScene({ area: drawingArea(doc), built });
}
