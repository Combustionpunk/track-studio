// Designer geometry: live (main-thread) racing line and placements, pointer projection, snapping, starter loops.
// The full bake (dividers, checks, stats) runs in a worker; this is the cheap part that has to keep up with the pointer.
import {
  arclength,
  atDistance,
  bakeBuilt,
  EXPORT_STEP,
  FEATURE_DEFAULTS,
  headingDeg,
  racingLine,
  SAMPLE,
  type Area,
  type BuiltFeature,
  type Corner,
  type Design,
  type DesignFeature,
  type DesignPoint,
  type Line,
  type Obstacle,
  type Point2,
  type RcTrack,
  type StartLine,
} from "@track-studio/engine";

export const GRID = 0.25; // m
export const ANGLE_STEP = 45; // degrees
/** A point snaps to a neighbour's 0/45/90° line when it's within this distance of it (same pull at any length)… */
export const LINE_SNAP = 0.35; // m
/** …and the angle is off by no more than this (stops very short segments snapping wildly) */
export const ANGLE_TOLERANCE = 15; // degrees
export const CORNER_SNAP = 0.5; // m: within this of where both neighbours' lines meet, snap there
export const MIN_POINT_GAP = 0.3; // m between neighbouring points
export const DISTANCE_STEP = 0.05; // m, for features / start along the line
const STEP = Math.max(1, Math.trunc(EXPORT_STEP / SAMPLE));

export interface Live {
  line: Line;
  s: Float64Array;
  total: number;
  corners: Corner[];
  /** [x, z, width] every ~0.25 m, like built.racingLine */
  racing: [number, number, number][];
  features: BuiltFeature[];
  startLine: StartLine;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Racing line and placements for a design — what the engine would put in `built`, minus the expensive parts. */
export function liveGeometry(design: Design): Live {
  const { line, corners } = racingLine(design.points, design.laneWidth ?? 2.0);
  const { s, total } = arclength(line.x, line.z);
  const racing: [number, number, number][] = [];
  for (let i = 0; i < line.n; i += STEP) racing.push([line.x[i], line.z[i], line.width[i]]);
  const live = { line, s, total, corners, racing } as Live;
  live.features = (design.features ?? []).map((f) => placeFeature(live, f));
  const sd = design.start?.distance ?? 0;
  const st = atDistance(line.x, line.z, s, total, sd);
  live.startLine = { x: st.p[0], z: st.p[1], heading: headingDeg(st.t), width: line.width[st.i], distance: sd };
  return live;
}

export function placeFeature(live: Pick<Live, "line" | "s" | "total">, f: DesignFeature): BuiltFeature {
  const [L0, H0] = FEATURE_DEFAULTS[f.type];
  const { p, t, i } = atDistance(live.line.x, live.line.z, live.s, live.total, f.distance);
  return {
    type: f.type,
    x: r3(p[0]),
    z: r3(p[1]),
    heading: headingDeg(t),
    length: f.length ?? L0,
    width: r3(live.line.width[i] - 0.08),
    height: f.height ?? H0,
    profile: [],
  };
}

/** Nearest point of the racing line: distance along it, how far away, and the dense sample index. */
export function nearestOnLine(live: Pick<Live, "line" | "s" | "total">, p: Point2): { s: number; dist: number; i: number; curvature: number } {
  const { x, z, n } = live.line;
  let best = { s: 0, dist: Infinity, i: 0 };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = x[i], az = z[i], dx = x[j] - ax, dz = z[j] - az;
    const L2 = dx * dx + dz * dz;
    const t = L2 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - az) * dz) / L2)) : 0;
    const qx = ax + dx * t, qz = az + dz * t;
    const d = Math.hypot(p[0] - qx, p[1] - qz);
    if (d < best.dist) best = { s: live.s[i] + Math.sqrt(L2) * t, dist: d, i };
  }
  return { ...best, curvature: live.line.curvature[best.i] };
}

/** Round to a step without float noise (0.05 * 741 = 37.050000000000004 → 37.05). */
export const roundTo = (v: number, step: number) => Math.round(Math.round(v / step) * step * 1000) / 1000;

export const wrapDistance = (d: number, total: number) => {
  const m = d % total;
  return roundTo(m < 0 ? m + total : m, DISTANCE_STEP);
};

/** Wheel steps → new corner radius: ~10% per step (fine when tight, quick for sweepers), at least 5 cm. */
export function wheelRadius(r: number, steps: number, step = 0.05, range: [number, number] = [0, 15]): number {
  let v = r;
  for (let k = 0; k < Math.abs(steps); k++) {
    const next = steps > 0 ? Math.max(v + step, v * 1.1) : Math.min(v - step, v / 1.1);
    v = roundTo(next, step);
  }
  return Math.min(range[1], Math.max(range[0], v));
}

// ---------------------------------------------------------------------------------------------- snapping
export interface Guide {
  from: Point2;
  to: Point2;
}

export interface SnapResult {
  p: Point2;
  guides: Guide[];
}

const snap = (v: number, step = GRID) => Math.round(v / step) * step;
const deg = (r: number) => (r * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;

/** The 45° direction (degrees) from `n` towards `p`, if `p` is within LINE_SNAP of that line (and ANGLE_TOLERANCE). */
function snappedAngle(n: Point2, p: Point2): number | null {
  const dx = p[0] - n[0], dz = p[1] - n[1];
  const len = Math.hypot(dx, dz);
  if (len < MIN_POINT_GAP) return null;
  const a = deg(Math.atan2(dz, dx));
  const s = Math.round(a / ANGLE_STEP) * ANGLE_STEP;
  const off = Math.abs(len * Math.sin(rad(a - s))); // distance from the line
  return off <= LINE_SNAP && Math.abs(a - s) <= ANGLE_TOLERANCE ? s : null;
}

/** Point on the line through `n` at `angle` nearest to `p`, moved to a grid step along the line. */
function onRay(n: Point2, angle: number, p: Point2): Point2 {
  const a = ((angle % 360) + 360) % 360;
  // straight across / up: on the neighbour's line, the free coordinate on the (absolute) grid
  if (a === 0 || a === 180) return [snap(p[0]), n[1]];
  if (a === 90 || a === 270) return [n[0], snap(p[1])];
  // diagonal: x and z move together, whole grid steps (each step is GRID·√2 along the line)
  const ux = Math.cos(rad(a)), uz = Math.sin(rad(a));
  const t = (p[0] - n[0]) * ux + (p[1] - n[1]) * uz;
  const k = Math.round(t / (GRID * Math.SQRT2));
  return [n[0] + Math.sign(ux) * k * GRID, n[1] + Math.sign(uz) * k * GRID];
}

/** Intersection of the lines through a (angle aDeg) and b (angle bDeg), or null if parallel. */
function intersect(a: Point2, aDeg: number, b: Point2, bDeg: number): Point2 | null {
  const ax = Math.cos(rad(aDeg)), az = Math.sin(rad(aDeg));
  const bx = Math.cos(rad(bDeg)), bz = Math.sin(rad(bDeg));
  const den = ax * bz - az * bx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((b[0] - a[0]) * bz - (b[1] - a[1]) * bx) / den;
  return [a[0] + ax * t, a[1] + az * t];
}

/**
 * Where a dragged point goes: on the 25 cm grid, and on a 45° line from a neighbouring point when it's close to one
 * (or where both neighbours' 45° lines cross). `free` (Shift) skips snapping. Guides show which lines it snapped to.
 */
export function snapPoint(raw: Point2, prev: Point2, next: Point2, free = false): SnapResult {
  if (free) return { p: [r3(raw[0]), r3(raw[1])], guides: [] }; // free, to the millimetre
  const ap = snappedAngle(prev, raw), an = snappedAngle(next, raw);
  if (ap !== null && an !== null) {
    const x = intersect(prev, ap, next, an);
    if (x && Math.hypot(x[0] - raw[0], x[1] - raw[1]) <= CORNER_SNAP) {
      return { p: [r3(x[0]), r3(x[1])], guides: [{ from: prev, to: x }, { from: next, to: x }] };
    }
  }
  // the neighbour whose 45° line is closest wins
  const options: { n: Point2; a: number }[] = [];
  if (ap !== null) options.push({ n: prev, a: ap });
  if (an !== null) options.push({ n: next, a: an });
  let best: SnapResult | null = null, bestD = Infinity;
  for (const o of options) {
    const q = onRay(o.n, o.a, raw);
    const d = Math.hypot(q[0] - raw[0], q[1] - raw[1]);
    if (d < bestD) {
      bestD = d;
      best = { p: [r3(q[0]), r3(q[1])], guides: [{ from: o.n, to: q }] };
    }
  }
  return best ?? { p: [r3(snap(raw[0])), r3(snap(raw[1]))], guides: [] };
}

/**
 * Keep a corner point inside the area: exactly width/2 from an edge at most, so its lane (and, with a square outer
 * corner, the corner itself) can reach the edge — and the area's corner — but not go past it.
 */
export function clampToArea(p: Point2, area: Area, halfWidth: number): Point2 {
  const bx = Math.max(0, r3(area.length / 2 - halfWidth));
  const bz = Math.max(0, r3(area.width / 2 - halfWidth));
  return [Math.max(-bx, Math.min(bx, p[0])), Math.max(-bz, Math.min(bz, p[1]))];
}

/** Too close to a neighbour (the engine can't make a corner out of two points in the same place)? */
export function tooClose(p: Point2, prev: Point2, next: Point2): boolean {
  return Math.hypot(p[0] - prev[0], p[1] - prev[1]) < MIN_POINT_GAP || Math.hypot(p[0] - next[0], p[1] - next[1]) < MIN_POINT_GAP;
}

/** Where a click on a straight inserts a point: after index `after`, at the projection onto that straight. */
export function insertionFor(points: DesignPoint[], p: Point2): { after: number; at: Point2 } {
  let best = { after: 0, at: [p[0], p[1]] as Point2, d: Infinity };
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length];
    const dx = b.x - a.x, dz = b.z - a.z;
    const L2 = dx * dx + dz * dz;
    const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a.x) * dx + (p[1] - a.z) * dz) / L2)) : 0;
    const q: Point2 = [a.x + dx * t, a.z + dz * t];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < best.d) best = { after: i, at: q, d };
  });
  // on an axis-aligned straight, put the new point on the grid (it stays on the straight)
  const a = points[best.after], b = points[(best.after + 1) % points.length];
  let at = best.at;
  if (Math.abs(a.z - b.z) < 1e-9) at = [snap(at[0]), a.z];
  else if (Math.abs(a.x - b.x) < 1e-9) at = [a.x, snap(at[1])];
  return { after: best.after, at: [r3(at[0]), r3(at[1])] };
}

/** New point between two others: lane width blended if they have their own widths. */
export function newPointBetween(a: DesignPoint, b: DesignPoint, at: Point2): DesignPoint {
  const p: DesignPoint = { x: at[0], z: at[1], radius: 1 };
  if (a.width !== undefined && b.width !== undefined) p.width = Math.round(((a.width + b.width) / 2) * 20) / 20;
  return p;
}

// ---------------------------------------------------------------------------------------------- starting loop
/**
 * A simple loop to reshape: a rounded rectangle just inside the area, shrunk until it clears the obstacles and stays
 * in the area (checked with the engine).
 */
export function starterLoop(area: Area, obstacles: Obstacle[] = [], laneWidth = 2): DesignPoint[] {
  const doc = (points: DesignPoint[]): RcTrack => ({
    format: "rctrack",
    version: 1,
    id: "starter",
    revision: 1,
    info: { name: "starter" },
    area,
    obstacles,
    design: { laneWidth, points },
  });
  let fallback: DesignPoint[] | null = null;
  for (let inset = laneWidth / 2 + 0.5; inset < Math.min(area.length, area.width) / 2; inset += 0.5) {
    const hx = Math.floor((area.length / 2 - inset) / GRID) * GRID, hz = Math.floor((area.width / 2 - inset) / GRID) * GRID;
    if (hx < 1 || hz < 1) break;
    const r = Math.max(1, Math.min(2.5, hz / 2));
    const points: DesignPoint[] = [
      { x: -hx, z: -hz, radius: r },
      { x: hx, z: -hz, radius: r },
      { x: hx, z: hz, radius: r },
      { x: -hx, z: hz, radius: r },
    ];
    fallback ??= points;
    const errors = bakeBuilt(doc(points)).checks.filter((c) => c.level === "error");
    if (!errors.length) return points;
  }
  return fallback ?? [{ x: -2, z: -1, radius: 1 }, { x: 2, z: -1, radius: 1 }, { x: 2, z: 1, radius: 1 }, { x: -2, z: 1, radius: 1 }];
}

/** A starting design: the starter loop, with the start line in the middle of its first straight. */
export function starterDesign(area: Area, obstacles: Obstacle[] = [], laneWidth = 2): Design {
  const points = starterLoop(area, obstacles, laneWidth);
  const { corners } = racingLine(points, laneWidth);
  const c0 = corners[0], c1 = corners[1];
  const straight = Math.hypot(c1.start[0] - c0.end[0], c1.start[1] - c0.end[1]);
  const distance = Math.round((c0.r * c0.th + straight / 2) / GRID) * GRID;
  return { laneWidth, points, features: [], start: { distance } };
}
