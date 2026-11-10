// The 3D viewer's scene (#83), as plain mesh data: pure, no three.js, no DOM, so it's tested without WebGL. Built
// from `built` and the drawing area only, never `design` (consumers draw built). One mesh per colour, so a big layout
// is still a handful of draw calls.
//
// A crossing's bridge (#71) carries the over pass: its carpet, pipes and racing line follow the bridge's profile over
// the bridging feature's length, while the under pass stays on the floor and runs beneath the deck.
//
// In the designer (#85) the scene also has the guide's obstacles (the drawn-for venue's, never part of the layout) as
// plain blocks, and the selected item's highlight is a mesh of its own.
//
// Positions are in three.js axes: x = plan x (east), y = up, z = −plan z (three's +z is south). Normals likewise.
import { crossingCarpet, drawingArea, EYE_HEIGHT, PIPE_THICKNESS, PLAN_PALETTE, rostrumEye, type Area, type Built, type BuiltFeature, type Divider, type Obstacle, type Point2, type RcTrack, type Side } from "@track-studio/engine";

export type Part = "area" | "carpet" | "pipe" | "jump" | "jumpSide" | "startA" | "startB" | "line" | "rostrum" | "rail" | "guide" | "highlight";

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
  /** the crossings drawn with a bridge: the bridging feature and which pass is on top */
  bridges: { feature: number; over: "first" | "second" }[];
}

/** Round pipes: this many sides. */
export const PIPE_SIDES = 8;

/** A bridge's deck over the under pass: this thick, with its sides showing. */
export const DECK_THICKNESS = 0.05;

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
  rostrum: PLAN_PALETTE["plan-rostrum"],
  rail: PLAN_PALETTE["plan-pipe"],
  guide: PLAN_PALETTE["plan-obstacle"],
  highlight: PLAN_PALETTE["plan-line"],
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
  /** A box over [x0, x1] × [z0, z1] (plan), from y0 up to y1, without a bottom. */
  box(x0: number, x1: number, z0: number, z1: number, y0: number, y1: number) {
    this.face([[x0, z0, y1], [x1, z0, y1], [x1, z1, y1], [x0, z1, y1]], [0, 1, 0]);
    this.face([[x0, z0, y0], [x1, z0, y0], [x1, z0, y1], [x0, z0, y1]], [0, 0, -1]);
    this.face([[x0, z1, y0], [x1, z1, y0], [x1, z1, y1], [x0, z1, y1]], [0, 0, 1]);
    this.face([[x0, z0, y0], [x0, z1, y0], [x0, z1, y1], [x0, z0, y1]], [-1, 0, 0]);
    this.face([[x1, z0, y0], [x1, z1, y0], [x1, z1, y1], [x1, z0, y1]], [1, 0, 0]);
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

function addPipe(m: Mesh, d: Divider, bridges: Bridge[]) {
  const cleaned = clean(d.points, d.closed);
  if (cleaned.length < 2) return;
  const closed = d.closed && cleaned.length > 2;
  const { pts, y } = onBridges(bridges, cleaned, closed);
  const r = PIPE_THICKNESS / 2;
  const frames = mitres(pts, closed);
  const rings = pts.map((p, i) => {
    const { n, scale } = frames[i];
    return Array.from({ length: PIPE_SIDES }, (_, k) => {
      const a = (2 * Math.PI * k) / PIPE_SIDES, c = Math.cos(a), s = Math.sin(a);
      return m.vert(p[0] + n[0] * r * c * scale, p[1] + n[1] * r * c * scale, y[i] + r + r * s, n[0] * c, s, n[1] * c);
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
      return m.vert(pts[i][0] + n[0] * r * c, pts[i][1] + n[1] * r * c, y[i] + r + r * s, t[0], 0, t[1]);
    });
    for (let k = 1; k + 1 < PIPE_SIDES; k++) m.tri(cap[0], cap[k], cap[k + 1]);
  }
}

/**
 * Every divider run as a round pipe of PIPE_THICKNESS, lying on the floor, or on a bridge for its over pass. Shared
 * pipes are the same pipe.
 */
export function pipeMesh(dividers: Divider[], bridges: Bridge[] = []): MeshData {
  const m = new Mesh();
  for (const d of dividers) addPipe(m, d, bridges);
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

/** A band along a polyline, `half(i)` either side of it, at height `y(i)` (the racing line; old files' carpet). */
function addRibbon(m: Mesh, pts: Point2[], closed: boolean, half: (i: number) => number, y: (i: number) => number) {
  const frames = mitres(pts, closed);
  const sides = pts.map((p, i) => {
    const { n, scale } = frames[i], w = half(i) * scale;
    return [m.vert(p[0] - n[0] * w, p[1] - n[1] * w, y(i)), m.vert(p[0] + n[0] * w, p[1] + n[1] * w, y(i))];
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
 *
 * Over a bridge the over pass's carpet rides it: the bridge's lane is one more even-odd ring, which takes the over
 * pass out of the floor and leaves just the square where the under pass runs through; then the over pass's carpet
 * follows the profile on top.
 */
export function carpetMesh(built: Built, bridges: Bridge[] = bridgesOf(built)): MeshData {
  const m = new Mesh();
  if (built.lanes) addEvenOdd(m, [built.lanes.right, built.lanes.left, ...bridges.map((b) => [b.at(0, -b.lane), b.at(b.length, -b.lane), b.at(b.length, b.lane), b.at(0, b.lane)])], CARPET_Y);
  else {
    const line = clean(built.racingLine.map(([x, z]) => [x, z] as Point2), true);
    const w = built.racingLine.map((p) => p[2] / 2);
    addRibbon(m, line, true, (i) => w[Math.min(i, w.length - 1)], () => CARPET_Y);
  }
  const onBridge = new Set(bridges.flatMap((b) => b.crossings));
  crossingCarpet(built).forEach((q, i) => {
    if (onBridge.has(i)) return;
    const [a, b, c, d] = q.map(([x, z]) => m.vert(x, z, CARPET_Y));
    m.quad(a, b, c, d);
  });
  for (const b of bridges) addSlope(m, b, b.lane, CARPET_Y);
  return m.done("carpet");
}

// ----------------------------------------------------------------------------------------------- bridges (#71)

/**
 * A bridge, in its own frame: along its pass from the entry edge, across to the left. Bridges overlapping on one pass
 * are one bridge, as high as the higher of them wherever they overlap.
 */
export interface Bridge {
  at: (along: number, across: number) => Point2;
  along: (p: Point2) => number;
  across: (p: Point2) => number;
  t: Point2;
  n: Point2;
  length: number;
  /** half the deck's width (the bridging feature's), and half the over pass's lane (out to the pipes' middles) */
  half: number;
  lane: number;
  /** [along, height], from 0 to length */
  profile: Point2[];
  /** a run this close to parallel to the bridge (sine of the angle) is on the over pass; the under pass crosses it */
  parallel: number;
  /** indexes into built.crossings */
  crossings: number[];
}

function bridge(x0: number, z0: number, t: Point2, length: number, half: number, profile: Point2[], parallel: number, crossings: number[]): Bridge {
  const n: Point2 = [-t[1], t[0]];
  return {
    at: (a, c) => [x0 + t[0] * a + n[0] * c, z0 + t[1] * a + n[1] * c],
    along: ([x, z]) => (x - x0) * t[0] + (z - z0) * t[1],
    across: ([x, z]) => (x - x0) * n[0] + (z - z0) * n[1],
    t, n, length, half, lane: half + PIPE_THICKNESS / 2, profile, parallel, crossings,
  };
}

/** A profile's height at `along` (0 off either end). */
function heightOn(profile: Point2[], along: number): number {
  if (along < profile[0][0] - 1e-9 || along > profile[profile.length - 1][0] + 1e-9) return 0;
  for (let k = 0; k + 1 < profile.length; k++) {
    const [a0, h0] = profile[k], [a1, h1] = profile[k + 1];
    if (along <= a1 + 1e-9) return a1 - a0 > 1e-12 ? h0 + ((h1 - h0) * Math.min(1, Math.max(0, (along - a0) / (a1 - a0)))) : Math.max(h0, h1);
  }
  return 0;
}

/** Two bridges on one pass that overlap, as one; else null. */
function merged(a: Bridge, b: Bridge): Bridge | null {
  if (Math.abs(a.t[0] * b.t[1] - a.t[1] * b.t[0]) > 1e-3 || Math.abs(a.across(b.at(0, 0))) > 0.05) return null;
  const ends = [a.along(b.at(0, 0)), a.along(b.at(b.length, 0))];
  const lo = Math.min(0, ...ends), hi = Math.max(a.length, ...ends);
  if (Math.min(...ends) >= a.length - 1e-6 || Math.max(...ends) <= 1e-6) return null; // end to end at most
  const toB = (al: number) => b.along(a.at(al, 0));
  const stops = [...new Set([...a.profile.map((p) => p[0]), ...b.profile.map((p) => a.along(b.at(p[0], 0)))].map((v) => +v.toFixed(9)))].sort((p, q) => p - q);
  // where one bridge's ramp crosses the other's, the higher swaps over: a stop there too
  const diff = (s: number) => heightOn(a.profile, s) - heightOn(b.profile, toB(s));
  for (let k = stops.length - 2; k >= 0; k--) {
    const d0 = diff(stops[k]), d1 = diff(stops[k + 1]);
    if (d0 * d1 < 0) stops.splice(k + 1, 0, stops[k] + ((stops[k + 1] - stops[k]) * d0) / (d0 - d1));
  }
  const profile = stops.map((s): Point2 => [s - lo, Math.max(heightOn(a.profile, s), heightOn(b.profile, toB(s)))]);
  const [x0, z0] = a.at(lo, 0);
  return bridge(x0, z0, a.t, hi - lo, Math.max(a.half, b.half), profile, Math.min(a.parallel, b.parallel), [...a.crossings, ...b.crossings]);
}

/** The bridges over built.crossings: one per bridging feature, overlapping ones on one pass merged. */
export function bridgesOf(built: Built): Bridge[] {
  const byFeature = new Map<number, Bridge>();
  (built.crossings ?? []).forEach((c, i) => {
    const f = c.bridge && c.over && c.footprint ? built.features[c.bridge.feature] : undefined;
    if (!f || f.profile.length < 2) return; // (the bake always writes a profile)
    const parallel = 0.5 * Math.max(Math.sin((c.angle * Math.PI) / 180), 0.1);
    const had = byFeature.get(c.bridge!.feature);
    if (had) {
      had.crossings.push(i);
      had.parallel = Math.min(had.parallel, parallel);
      return;
    }
    const h = (f.heading * Math.PI) / 180, t: Point2 = [Math.cos(h), Math.sin(h)];
    byFeature.set(c.bridge!.feature, bridge(f.x - (t[0] * f.length) / 2, f.z - (t[1] * f.length) / 2, t, f.length, f.width / 2, f.profile, parallel, [i]));
  });
  const out = [...byFeature.values()];
  for (let joined = true; joined; ) {
    joined = false;
    for (let i = 0; i < out.length && !joined; i++)
      for (let j = i + 1; j < out.length && !joined; j++) {
        const m = merged(out[i], out[j]);
        if (m) [out[i], joined] = [m, true], out.splice(j, 1);
      }
  }
  return out;
}

/** How far a bridge lifts point p of a run heading `dir`: if it's on the bridge's pass (along it, in its lane). */
function liftAt(bridges: Bridge[], p: Point2, dir: Point2): number {
  let y = 0;
  for (const b of bridges) {
    if (Math.abs(dir[0] * b.t[1] - dir[1] * b.t[0]) > b.parallel || Math.abs(b.across(p)) > b.lane + PIPE_THICKNESS) continue;
    y = Math.max(y, heightOn(b.profile, b.along(p)));
  }
  return y;
}

/**
 * A run (racing line, pipe) with a point wherever a bridge's profile bends under it, and the height of each point:
 * the over pass's on the bridge, 0 elsewhere (the under pass crosses the bridge, so it stays on the floor).
 */
function onBridges(bridges: Bridge[], pts: Point2[], closed: boolean): { pts: Point2[]; y: number[] } {
  if (!bridges.length) return { pts, y: pts.map(() => 0) };
  const out: Point2[] = [];
  const dirs: Point2[] = []; // the direction from each point to the next
  const segs = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    out.push(a);
    if (i >= segs) break;
    const b = pts[(i + 1) % pts.length], d = unit(b[0] - a[0], b[1] - a[1]);
    dirs[out.length - 1] = d;
    const cuts: number[] = [];
    for (const br of bridges) {
      if (Math.abs(d[0] * br.t[1] - d[1] * br.t[0]) > br.parallel) continue;
      if (Math.abs(br.across(a)) > br.lane + PIPE_THICKNESS && Math.abs(br.across(b)) > br.lane + PIPE_THICKNESS) continue;
      const aa = br.along(a), ab = br.along(b);
      for (const [k] of br.profile) {
        const u = (k - aa) / (ab - aa);
        if (u > 1e-6 && u < 1 - 1e-6) cuts.push(u);
      }
    }
    for (const u of cuts.sort((p, q) => p - q)) {
      out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
      dirs[out.length - 1] = d;
    }
  }
  const y = out.map((p, k) => {
    const prev = k > 0 ? dirs[k - 1] : closed ? dirs[out.length - 1] : undefined;
    return Math.max(...[prev, dirs[k]].filter((d): d is Point2 => !!d).map((d) => liftAt(bridges, p, d)));
  });
  return { pts: out, y };
}

/** The top of a bridge, `half` either side of its middle, `lift` above its profile, tilted with it. */
function addSlope(m: Mesh, b: Bridge, half: number, lift: number) {
  for (let k = 0; k + 1 < b.profile.length; k++) {
    const [a0, h0] = b.profile[k], [a1, h1] = b.profile[k + 1];
    if (a1 - a0 < 1e-9) continue;
    const [ua, uy] = unit(a1 - a0, h1 - h0);
    const p = (a: number, c: number, h: number): [number, number, number] => [...b.at(a, c), h + lift];
    m.face([p(a0, -half, h0), p(a1, -half, h1), p(a1, half, h1), p(a0, half, h0)], [-b.t[0] * uy, ua, -b.t[1] * uy]);
  }
}

/**
 * A bridge's body: the ramps solid down to the floor, the flat top a deck DECK_THICKNESS thick with the under pass's
 * gap beneath it, and their sides. Its top is the over pass's carpet.
 */
function addBridge(m: Mesh, b: Bridge) {
  const P = b.profile;
  // a flat top is a deck (each bridge's own, where two on one pass are merged); a slope is a solid ramp
  const kind = (k: number): "none" | "ramp" | "deck" => {
    if (k < 0 || k + 1 >= P.length || P[k + 1][0] - P[k][0] < 1e-9) return "none";
    const [h0, h1] = [P[k][1], P[k + 1][1]];
    if (h0 <= 1e-6 && h1 <= 1e-6) return "none";
    return Math.abs(h1 - h0) < 1e-6 && h0 > DECK_THICKNESS ? "deck" : "ramp";
  };
  const p = (a: number, c: number, h: number): [number, number, number] => [...b.at(a, c), h];
  for (let k = 0; k + 1 < P.length; k++) {
    const [a0, h0] = P[k], [a1, h1] = P[k + 1], what = kind(k);
    if (what === "none") continue;
    const low = what === "deck" ? (h: number) => h - DECK_THICKNESS : () => 0;
    for (const s of [-1, 1]) m.face([p(a0, s * b.half, low(h0)), p(a1, s * b.half, low(h1)), p(a1, s * b.half, h1), p(a0, s * b.half, h0)], [b.n[0] * s, 0, b.n[1] * s]);
    if (what === "deck") m.face([p(a0, -b.half, low(h0)), p(a1, -b.half, low(h1)), p(a1, b.half, low(h1)), p(a0, b.half, low(h0))], [0, -1, 0]);
  }
  // the ends of each solid part, square across: where a ramp meets the deck (below the deck) or the profile stops above the floor
  for (let k = 0; k < P.length; k++) {
    const [a, h] = P[k], before = kind(k - 1), after = kind(k);
    if (h <= 1e-6 || before === after) continue;
    // the face looks towards the side that's open below it
    const [solid, open] = before === "ramp" || (before === "deck" && after === "none") ? [before, after] : [after, before];
    const facing = solid === before ? 1 : -1;
    const [y0, y1] = solid === "ramp" ? [0, open === "deck" ? h - DECK_THICKNESS : h] : [h - DECK_THICKNESS, h];
    m.face([p(a, -b.half, y0), p(a, b.half, y0), p(a, b.half, y1), p(a, -b.half, y1)], [b.t[0] * facing, 0, b.t[1] * facing]);
  }
}

// ------------------------------------------------------------------------------------------------------------- scene

/** Chequered start line: two rows of squares across the lane at built.startLine, as the plan draws it (on a bridge too). */
function addStart(a: Mesh, b: Mesh, built: Built, bridges: Bridge[]) {
  const s = built.startLine;
  if (!s) return;
  const h = (s.heading * Math.PI) / 180;
  const t: Point2 = [Math.cos(h), Math.sin(h)], n: Point2 = [-t[1], t[0]];
  const at = (u: number, v: number): [number, number, number] => {
    const p: Point2 = [s.x + t[0] * u + n[0] * v, s.z + t[1] * u + n[1] * v];
    return [p[0], p[1], START_Y + liftAt(bridges, p, t)];
  };
  const across = Math.max(4, Math.round(s.width / 0.2));
  const sq = s.width / across;
  for (let row = 0; row < 2; row++)
    for (let k = 0; k < across; k++) {
      const u0 = (row - 1) * sq, v0 = -s.width / 2 + k * sq;
      ((row + k) % 2 ? b : a).face([at(u0, v0), at(u0 + sq, v0), at(u0 + sq, v0 + sq), at(u0, v0 + sq)], [0, 1, 0]);
    }
}

/**
 * The whole layout: the area as the floor, carpet, pipes, jumps and bridges, start line and racing line; and in the
 * designer, the guide's obstacles.
 */
export function buildScene({ area, built, obstacles = [] }: { area: Area; built: Built; obstacles?: Obstacle[] }): Scene3D {
  const floor = new Mesh();
  const L = area.length / 2, W = area.width / 2;
  floor.face([[-L, -W, 0], [L, -W, 0], [L, W, 0], [-L, W, 0]], [0, 1, 0]);

  const bridges = bridgesOf(built);
  const bridging = new Set(bridges.flatMap((b) => b.crossings.map((i) => built.crossings![i].bridge!.feature)));
  const top = new Mesh(), sides = new Mesh();
  (built.features ?? []).forEach((f, i) => bridging.has(i) || addJump(top, sides, f));
  for (const b of bridges) addBridge(sides, b);

  const startA = new Mesh(), startB = new Mesh();
  addStart(startA, startB, built, bridges);

  const line = new Mesh();
  const rl = clean(built.racingLine.map(([x, z]) => [x, z] as Point2), true);
  if (rl.length > 2) {
    const { pts, y } = onBridges(bridges, rl, true);
    addRibbon(line, pts, true, () => LINE_WIDTH / 2, (i) => LINE_Y + y[i]);
  }

  const meshes = [floor.done("area"), carpetMesh(built, bridges), pipeMesh(built.dividers ?? [], bridges), top.done("jump"), sides.done("jumpSide"), startA.done("startA"), startB.done("startB"), line.done("line"), guideMesh(obstacles)].filter(
    (m) => m.indices.length > 0,
  );
  const shown = (built.crossings ?? []).flatMap((c, i) => (bridges.some((b) => b.crossings.includes(i)) ? [{ feature: c.bridge!.feature, over: c.over! }] : []));
  return { area, background: PLAN_PALETTE["plan-floor"], meshes, triangles: meshes.reduce((n, m) => n + m.indices.length / 3, 0), bridges: shown };
}

// ------------------------------------------------------------------------------------------- the designer (#85)

/** The guide's obstacles stand this high: plain blocks, clearly not part of the layout. */
export const GUIDE_HEIGHT = 1;
const CIRCLE_SIDES = 16;

/** The drawn-for venue's obstacles as plain blocks from the floor up to GUIDE_HEIGHT: circles as round posts. */
export function guideMesh(obstacles: Obstacle[]): MeshData {
  const m = new Mesh();
  for (const o of obstacles) {
    const ring: Point2[] =
      o.type === "circle"
        ? Array.from({ length: CIRCLE_SIDES }, (_, k) => [o.x + o.radius * Math.cos((2 * Math.PI * k) / CIRCLE_SIDES), o.z + o.radius * Math.sin((2 * Math.PI * k) / CIRCLE_SIDES)])
        : rectRing(o.x, o.z, ((o.rotation ?? 0) * Math.PI) / 180, o.length / 2, o.width / 2);
    addPrism(m, ring, 0, GUIDE_HEIGHT);
  }
  return m.done("guide");
}

/** A rectangle's corners, counter-clockwise: `half` along `angle` (radians from +x) and `across` to its left. */
function rectRing(x: number, z: number, angle: number, half: number, across: number): Point2[] {
  const t: Point2 = [Math.cos(angle), Math.sin(angle)], n: Point2 = [-t[1], t[0]];
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, c]) => [x + t[0] * half * a + n[0] * across * c, z + t[1] * half * a + n[1] * across * c]);
}

/** A convex ring (counter-clockwise) stood up from y0 to y1: its sides and a top. */
function addPrism(m: Mesh, ring: Point2[], y0: number, y1: number) {
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k], b = ring[(k + 1) % ring.length];
    const [ux, uz] = unit(b[0] - a[0], b[1] - a[1]);
    m.face([[a[0], a[1], y0], [b[0], b[1], y0], [b[0], b[1], y1], [a[0], a[1], y1]], [uz, 0, -ux]);
  }
  const top = ring.map(([x, z]) => m.vert(x, z, y1));
  for (let k = 1; k + 1 < top.length; k++) m.tri(top[0], top[k], top[k + 1]);
}

/** What's selected in the designer, to highlight in 3D. A corner is given by its point (from the design). */
export type Highlight = { kind: "feature"; i: number } | { kind: "point"; at: Point2 } | { kind: "start" } | null;

/** The highlight stands this far out round a jump and this far over its top. */
const HIGHLIGHT_MARGIN = 0.12;
/** A corner's highlight: a post this wide and high on the corner's point. */
const POST: [number, number] = [0.3, 1.2];

/**
 * The selected item as a box round it, drawn see-through over the layout: a jump's footprint up over its top, a post
 * on a corner's point, or a low box across the lane at the start line. Null when there's nothing (yet) to show.
 */
export function highlightMesh(built: Built, h: Highlight): MeshData | null {
  if (!h) return null;
  const m = new Mesh();
  if (h.kind === "feature") {
    const f = built.features?.[h.i];
    if (!f) return null;
    const top = Math.max(f.height, ...f.profile.map((p) => p[1]));
    addPrism(m, rectRing(f.x, f.z, (f.heading * Math.PI) / 180, f.length / 2 + HIGHLIGHT_MARGIN, f.width / 2 + HIGHLIGHT_MARGIN), 0, top + HIGHLIGHT_MARGIN);
  } else if (h.kind === "point") {
    addPrism(m, rectRing(h.at[0], h.at[1], 0, POST[0] / 2, POST[0] / 2), 0, POST[1]);
  } else {
    const s = built.startLine;
    if (!s) return null;
    addPrism(m, rectRing(s.x, s.z, (s.heading * Math.PI) / 180, 0.3, s.width / 2 + HIGHLIGHT_MARGIN), 0, 0.25);
  }
  return m.done("highlight");
}

/** The jump whose footprint has plan point p in it (the smallest, if they overlap), or null. */
export function featureAt(built: Built, p: Point2): number | null {
  let best: number | null = null, bestArea = Infinity;
  (built.features ?? []).forEach((f, i) => {
    const h = (f.heading * Math.PI) / 180, dx = p[0] - f.x, dz = p[1] - f.z;
    const along = dx * Math.cos(h) + dz * Math.sin(h), across = -dx * Math.sin(h) + dz * Math.cos(h);
    if (Math.abs(along) > f.length / 2 + 1e-6 || Math.abs(across) > f.width / 2 + 1e-6 || f.length * f.width >= bestArea) return;
    [best, bestArea] = [i, f.length * f.width];
  });
  return best;
}

/** Whether two meshes are the same, data and colour (a new bake leaves most of them as they were). */
export function sameMesh(a: MeshData, b: MeshData): boolean {
  const eq = (x: ArrayLike<number>, y: ArrayLike<number>) => {
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  };
  return a.part === b.part && a.colour === b.colour && eq(a.indices, b.indices) && eq(a.positions, b.positions) && eq(a.normals, b.normals);
}

// ------------------------------------------------------------------ rostrum (#84)
/** The rostrum's deck: this far up, so a driver's eyes (1.7 m over it) are at EYE_HEIGHT. */
export const DECK_HEIGHT = EYE_HEIGHT - 1.7;
/** The rail along its front, this high over the deck. */
export const RAIL_HEIGHT = 1.0;
/** Deck size, along × across its side (as the plan draws a venue's rostrum). */
const DECK: [number, number] = [5, 1.2];
const RAIL_BAR = 0.05;
const RAIL_POSTS = 5;

/**
 * A simple rostrum where rostrumEye puts the drivers on `side` (a layout has none: this is the viewer's, so the orbit
 * view shows where the rostrum view stands): a deck centred on the spot and a rail along its front, facing the area.
 */
export function rostrumMeshes(area: Area, side: Side): MeshData[] {
  const e = rostrumEye(area, side);
  const ns = side === "north" || side === "south";
  const out = side === "north" || side === "east" ? 1 : -1; // away from the area, along the side's axis
  const [along, across] = [DECK[0] / 2, DECK[1] / 2];
  // a box given as [along0, along1] × [out0, out1] (out: across the side, away from the area, from the eyes)
  const box = (m: Mesh, a0: number, a1: number, o0: number, o1: number, y0: number, y1: number) => {
    const [c0, c1] = [out * o0, out * o1].sort((a, b) => a - b);
    if (ns) m.box(e.x + a0, e.x + a1, e.z + c0, e.z + c1, y0, y1);
    else m.box(e.x + c0, e.x + c1, e.z + a0, e.z + a1, y0, y1);
  };
  const deck = new Mesh(), rail = new Mesh();
  box(deck, -along, along, -across, across, 0, DECK_HEIGHT);
  const front = -across, b = RAIL_BAR / 2, top = DECK_HEIGHT + RAIL_HEIGHT;
  box(rail, -along, along, front, front + RAIL_BAR, top - RAIL_BAR, top);
  for (let k = 0; k < RAIL_POSTS; k++) {
    const a = -along + b + ((2 * along - RAIL_BAR) * k) / (RAIL_POSTS - 1);
    box(rail, a - b, a + b, front, front + RAIL_BAR, DECK_HEIGHT, top - RAIL_BAR);
  }
  return [deck.done("rostrum"), rail.done("rail")];
}

/** The scene for a layout file: its drawing area and built section (never its design). */
export function sceneFromDoc(doc: Pick<RcTrack, "area" | "built">): Scene3D {
  const built = doc.built;
  if (!built) throw new Error("This layout has no built section to draw.");
  return buildScene({ area: drawingArea(doc), built });
}
