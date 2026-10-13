// Snapping for the designer, thinking in lanes and pipes rather than racing-line points.
//   Lanes (default): centre points on the lane grid — lane centres measured from both walls — so lanes sit flush against
//                    the walls and side by side; straights snap to 0°/45°/90° from their neighbour.
//   Fine (Shift):    0.25 m grid + 45° lines (the old behaviour).
//   Free (Alt):      no snapping.
// In Lanes and Fine, a straight running nearly parallel to another straight snaps to exactly (w1 + w2) / 2 from it, so
// the two lanes share one pipe (any angle, diagonals included). Outside-corner handles move a corner by its mitre.
// Pure functions: no DOM.
import { SQUARE_MAX_TURN, type Area, type DesignPoint, type Point2 } from "@track-studio/engine";
import { clampToArea, GRID, snapPoint, tooClose, type Guide } from "./geometry.js";

export type SnapMode = "lanes" | "fine" | "free";

// ------------------------------------------------------------------------------------------------ tuning
/** a straight within this angle of another counts as running beside it */
export const BESIDE_ANGLE = 7; // degrees
/** …when their centre lines are within this many average lane widths */
export const BESIDE_RANGE = 1.5;
/** neighbours' 0/45/90° lines pull a point within this distance (as in Fine) */
export const LINE_PULL = 0.35; // m
/** outside-corner handles snap to walls, hall corners and other pipes within this distance */
export const MITRE_PULL = 0.3; // m
/** a corner turning more than this gets a warning badge while dragging */
export const SHARP_TURN = 150; // degrees

export type SnapTag = "wall" | "corner" | "lane grid" | "fine grid" | "beside lane" | "0°/90°" | "45°" | "pipe" | "free";

export interface SnapResult {
  p: Point2;
  tags: SnapTag[];
  guides: Guide[];
  /** the stretch of pipe the dragged lane now shares (for a highlight) */
  shared?: Guide;
}

export interface SnapContext {
  area: Area;
  points: DesignPoint[];
  laneWidth: number;
  /** index of the point being placed */
  i: number;
  mode: SnapMode;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const EPS = 1e-9;
const widthOf = (p: DesignPoint, lw: number) => p.width ?? lw;
const sub = (a: Point2, b: Point2): Point2 => [a[0] - b[0], a[1] - b[1]];
const dot = (a: Point2, b: Point2) => a[0] * b[0] + a[1] * b[1];
const len = (a: Point2) => Math.hypot(a[0], a[1]);
const unit = (a: Point2): Point2 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};
const xz = (p: DesignPoint): Point2 => [p.x, p.z];

// ------------------------------------------------------------------------------------------------ lane grid
/**
 * Lane-centre positions across one axis of the area (extent E) for lanes of width w, measured from both walls:
 * −E/2 + w/2 + k·w and +E/2 − w/2 − k·w. A lane can sit flush against either wall even when E isn't a whole number of
 * lanes. Sorted, without duplicates.
 */
export function laneGrid(extent: number, w: number): number[] {
  const lo = -extent / 2 + w / 2, hi = extent / 2 - w / 2;
  if (hi < lo - EPS) return [0];
  const out: number[] = [];
  for (let k = 0; lo + k * w <= hi + EPS; k++) out.push(r3(lo + k * w));
  for (let k = 0; hi - k * w >= lo - EPS; k++) out.push(r3(hi - k * w));
  return [...new Set(out)].sort((a, b) => a - b);
}

const nearest = (v: number, grid: number[]) => grid.reduce((best, g) => (Math.abs(g - v) < Math.abs(best - v) ? g : best), grid[0]);

/** Grid lines for a mode: lane grid (Lanes) or 0.25 m multiples near v (Fine). */
function gridFor(mode: SnapMode, extent: number, w: number, v: number): number[] {
  if (mode === "lanes") return laneGrid(extent, w);
  const k = Math.round(v / GRID);
  return [k - 1, k, k + 1].map((m) => r3(m * GRID));
}

// ------------------------------------------------------------------------------------------------ beside lanes
interface Beside {
  /** the line the dragged point goes on: through `o`, direction `d` (unit) */
  o: Point2;
  d: Point2;
  /** how far the raw point is from it */
  off: number;
  shared: Guide;
}

/**
 * Lines a dragged point could go on so that one of its straights runs exactly beside another straight of the track
 * (centre lines (w1 + w2) / 2 apart): for each straight attached to point i that's within BESIDE_ANGLE of parallel to
 * another straight, closer than BESIDE_RANGE × their average width, with overlapping extents.
 */
export function besideLines(raw: Point2, ctx: Pick<SnapContext, "points" | "laneWidth" | "i">): Beside[] {
  const { points, laneWidth: lw, i } = ctx;
  const n = points.length;
  const out: Beside[] = [];
  const cosTol = Math.cos((BESIDE_ANGLE * Math.PI) / 180);
  for (const ni of [(i - 1 + n) % n, (i + 1) % n]) {
    const nb = xz(points[ni]);
    const sDir = sub(raw, nb);
    if (len(sDir) < 0.5) continue;
    const su = unit(sDir);
    const w1 = (widthOf(points[ni], lw) + widthOf(points[i], lw)) / 2;
    for (let j = 0; j < n; j++) {
      const k = (j + 1) % n;
      // not the straights attached to the dragged point
      if (j === i || k === i) continue;
      const a = xz(points[j]), b = xz(points[k]);
      const tv = sub(b, a);
      const tl = len(tv);
      if (tl < 0.5) continue;
      const tu: Point2 = [tv[0] / tl, tv[1] / tl];
      if (Math.abs(dot(su, tu)) < cosTol) continue;
      const nrm: Point2 = [-tu[1], tu[0]];
      const side = Math.sign(dot(sub(raw, a), nrm)) || 1;
      const dist = Math.abs(dot(sub(raw, a), nrm));
      const w2 = (widthOf(points[j], lw) + widthOf(points[k], lw)) / 2;
      const target = (w1 + w2) / 2;
      if (dist > BESIDE_RANGE * target) continue;
      // the dragged straight must run alongside: its extent along the other one overlaps it
      const t0 = dot(sub(nb, a), tu), t1 = dot(sub(raw, a), tu);
      const lo = Math.max(Math.min(t0, t1), 0), hi = Math.min(Math.max(t0, t1), tl);
      if (hi - lo < 0.25) continue;
      const o: Point2 = [a[0] + nrm[0] * side * target, a[1] + nrm[1] * side * target];
      const mid = side * (w2 / 2); // the shared pipe: the other lane's edge on this side
      out.push({
        o,
        d: tu,
        off: Math.abs(dist - target),
        shared: { from: [a[0] + tu[0] * lo + nrm[0] * mid, a[1] + tu[1] * lo + nrm[1] * mid], to: [a[0] + tu[0] * hi + nrm[0] * mid, a[1] + tu[1] * hi + nrm[1] * mid] },
      });
    }
  }
  return out.sort((p, q) => p.off - q.off);
}

/** Point on line (o, d) nearest to raw, moved to where the line crosses the nearest grid line (lane or fine grid). */
function alongLine(raw: Point2, o: Point2, d: Point2, mode: SnapMode, area: Area, w: number): Point2 {
  const t = dot(sub(raw, o), d);
  const q: Point2 = [o[0] + d[0] * t, o[1] + d[1] * t];
  if (mode === "free") return q;
  const cands: Point2[] = [];
  if (Math.abs(d[0]) > 1e-6) for (const gx of gridFor(mode, area.length, w, q[0])) cands.push([gx, o[1] + (d[1] * (gx - o[0])) / d[0]]);
  if (Math.abs(d[1]) > 1e-6) for (const gz of gridFor(mode, area.width, w, q[1])) cands.push([o[0] + (d[0] * (gz - o[1])) / d[1], gz]);
  let best = q, bd = Infinity;
  for (const c of cands) {
    const dd = Math.hypot(c[0] - q[0], c[1] - q[1]);
    if (dd < bd) [best, bd] = [c, dd];
  }
  return bd <= w ? best : q;
}

// ------------------------------------------------------------------------------------------------ centre points
/** Neighbour lines (0/45/90°) from `n` within LINE_PULL of raw: the angle (degrees), or null. */
function angleTo(n: Point2, raw: Point2): number | null {
  const v = sub(raw, n);
  const l = len(v);
  if (l < 0.3) return null;
  const a = (Math.atan2(v[1], v[0]) * 180) / Math.PI;
  const s = Math.round(a / 45) * 45;
  const off = Math.abs(l * Math.sin(((a - s) * Math.PI) / 180));
  return off <= LINE_PULL && Math.abs(a - s) <= 15 ? s : null;
}

function wallTags(p: Point2, area: Area, w: number, tags: SnapTag[]) {
  const atX = Math.abs(Math.abs(p[0]) - (area.length / 2 - w / 2)) < 1e-6;
  const atZ = Math.abs(Math.abs(p[1]) - (area.width / 2 - w / 2)) < 1e-6;
  if (atX && atZ) tags.unshift("corner");
  else if (atX || atZ) tags.unshift("wall");
}

/** Where a dragged corner (centre) point goes, and what it snapped to. */
export function snapCentre(raw: Point2, ctx: SnapContext): SnapResult {
  const { area, points, laneWidth: lw, i, mode } = ctx;
  const n = points.length;
  const me = points[i];
  const w = widthOf(me, lw);
  const prev = xz(points[(i - 1 + n) % n]), next = xz(points[(i + 1) % n]);
  const finish = (p: Point2, tags: SnapTag[], guides: Guide[], shared?: Guide): SnapResult => {
    // to the micrometre (beside-lane positions on diagonals involve √2), the millimetre when that close to one
    const t: Point2 = [tidy(p[0]), tidy(p[1])];
    const q = clampToArea(t, area, w / 2);
    wallTags(q, area, w, tags);
    return { p: q, tags, guides: q[0] === t[0] && q[1] === t[1] ? guides : [], shared };
  };
  if (mode === "free") return finish(raw, ["free"], []);

  // 1. beside another lane (wins over the grid)
  const [bs] = besideLines(raw, ctx);
  if (bs) {
    const q = alongLine(raw, bs.o, bs.d, mode, area, w);
    if (!tooClose(q, prev, next)) return finish(q, ["beside lane"], [], bs.shared);
  }

  // 2. Fine: the 0.25 m grid + 45° lines, as before
  if (mode === "fine") {
    const s = snapPoint(raw, prev, next, false);
    const onLine = s.guides.length > 0;
    return finish(s.p, [onLine ? "45°" : "fine grid"], s.guides);
  }

  // 3. Lanes: the lane grid, with the straight into the point at 0/45/90° from its neighbour
  const gx = laneGrid(area.length, w), gz = laneGrid(area.width, w);
  const lines = [prev, next].map((nb) => ({ nb, a: angleTo(nb, raw) })).filter((l): l is { nb: Point2; a: number } => l.a !== null);
  let best: { p: Point2; tags: SnapTag[]; guides: Guide[] } | null = null;
  if (lines.length === 2 && lines[0].a % 180 !== lines[1].a % 180) {
    // both neighbours' lines: where they cross (e.g. a square corner between them)
    const [l1, l2] = lines;
    const d1: Point2 = [Math.cos((l1.a * Math.PI) / 180), Math.sin((l1.a * Math.PI) / 180)];
    const d2: Point2 = [Math.cos((l2.a * Math.PI) / 180), Math.sin((l2.a * Math.PI) / 180)];
    const den = d1[0] * d2[1] - d1[1] * d2[0];
    const w0 = sub(l2.nb, l1.nb);
    const t = (w0[0] * d2[1] - w0[1] * d2[0]) / den;
    const x: Point2 = [l1.nb[0] + d1[0] * t, l1.nb[1] + d1[1] * t];
    if (Math.hypot(x[0] - raw[0], x[1] - raw[1]) <= LINE_PULL * 1.5 && !tooClose(x, prev, next)) {
      return finish(x, [l1.a % 90 === 0 && l2.a % 90 === 0 ? "0°/90°" : "45°"], [{ from: l1.nb, to: x }, { from: l2.nb, to: x }]);
    }
  }
  for (const { nb, a } of lines) {
    const d: Point2 = [Math.cos((a * Math.PI) / 180), Math.sin((a * Math.PI) / 180)];
    const q = alongLine(raw, nb, [r3(d[0]) === 0 ? 0 : d[0], r3(d[1]) === 0 ? 0 : d[1]], "lanes", area, w);
    const dist = Math.hypot(q[0] - raw[0], q[1] - raw[1]);
    if (!best || dist < Math.hypot(best.p[0] - raw[0], best.p[1] - raw[1])) best = { p: q, tags: [a % 90 === 0 ? "0°/90°" : "45°", "lane grid"], guides: [{ from: nb, to: q }] };
  }
  if (best && !tooClose(best.p, prev, next)) return finish(best.p, best.tags, best.guides);
  return finish([nearest(raw[0], gx), nearest(raw[1], gz)], ["lane grid"], []);
}

// ------------------------------------------------------------------------------------------------ outside corners
interface CornerGeom {
  P: Point2;
  /** outward bisector (unit) */
  u: Point2;
  th: number;
  hw: number;
}

function cornerGeom(points: DesignPoint[], i: number, lw: number, P = xz(points[i])): CornerGeom | null {
  const n = points.length;
  const a = unit(sub(P, xz(points[(i - 1 + n) % n]))), b = unit(sub(xz(points[(i + 1) % n]), P));
  const cross = a[0] * b[1] - a[1] * b[0];
  const th = Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
  if (th < 1e-3) return null;
  const sign = cross > 0 ? 1 : -1;
  const oa: Point2 = [sign * a[1], -sign * a[0]], ob: Point2 = [sign * b[1], -sign * b[0]];
  return { P, u: unit([oa[0] + ob[0], oa[1] + ob[1]]), th, hw: widthOf(points[i], lw) / 2 };
}

/** Does corner i draw a square outside corner with a single mitre (square / auto ≤ 120°)? */
export function hasMitre(points: DesignPoint[], i: number, lw: number): boolean {
  const g = cornerGeom(points, i, lw);
  if (!g) return false;
  const style = points[i].outer ?? "auto";
  return style !== "round" && g.th <= SQUARE_MAX_TURN;
}

/** The outside corner of the pipes at point i: where the two straights' outer lane edges meet. */
export function mitrePoint(points: DesignPoint[], i: number, lw: number, P?: Point2): Point2 | null {
  const g = cornerGeom(points, i, lw, P);
  if (!g) return null;
  const d = g.hw / Math.cos(g.th / 2);
  return [g.P[0] + g.u[0] * d, g.P[1] + g.u[1] * d];
}

/** Where point i must go for its mitre to land on `target` (its neighbours stay put). */
export function placeByMitre(points: DesignPoint[], i: number, target: Point2, lw: number): Point2 {
  let P = xz(points[i]);
  for (let k = 0; k < 50; k++) {
    const m = mitrePoint(points, i, lw, P);
    if (!m) break;
    const next: Point2 = [P[0] + (target[0] - m[0]), P[1] + (target[1] - m[1])];
    if (Math.hypot(next[0] - P[0], next[1] - P[1]) < 1e-10) {
      P = next;
      break;
    }
    P = next;
  }
  return P;
}

/** Lines of other straights' lane edges (each straight's centre line offset ±w/2), for the mitre handle to snap to. */
function edgeLines(points: DesignPoint[], i: number, lw: number): { o: Point2; d: Point2 }[] {
  const n = points.length;
  const out: { o: Point2; d: Point2 }[] = [];
  for (let j = 0; j < n; j++) {
    const k = (j + 1) % n;
    if (j === i || k === i) continue;
    const a = xz(points[j]), b = xz(points[k]);
    if (len(sub(b, a)) < 0.5) continue;
    const d = unit(sub(b, a));
    const hw = (widthOf(points[j], lw) + widthOf(points[k], lw)) / 4;
    for (const s of [-1, 1]) out.push({ o: [a[0] - d[1] * hw * s, a[1] + d[0] * hw * s], d });
  }
  return out;
}

/** Snap a dragged outside-corner handle: hall corners, walls, other pipes' corners and lane-edge lines. */
export function snapMitre(raw: Point2, ctx: SnapContext): SnapResult {
  const { area, points, laneWidth: lw, i, mode } = ctx;
  if (mode === "free") return { p: raw, tags: ["free"], guides: [] };
  const X = area.length / 2, Z = area.width / 2;
  const nearWallX = [-X, X].find((x) => Math.abs(raw[0] - x) <= MITRE_PULL);
  const nearWallZ = [-Z, Z].find((z) => Math.abs(raw[1] - z) <= MITRE_PULL);
  if (nearWallX !== undefined && nearWallZ !== undefined) return { p: [nearWallX, nearWallZ], tags: ["corner"], guides: [] };
  // other pipes' corners
  for (let j = 0; j < points.length; j++) {
    if (j === i || !hasMitre(points, j, lw)) continue;
    const m = mitrePoint(points, j, lw)!;
    if (Math.hypot(m[0] - raw[0], m[1] - raw[1]) <= MITRE_PULL) return { p: [r3(m[0]), r3(m[1])], tags: ["pipe"], guides: [] };
  }
  let p: Point2 = [raw[0], raw[1]];
  const tags: SnapTag[] = [];
  if (nearWallX !== undefined) [p, tags[0]] = [[nearWallX, p[1]], "wall"];
  else if (nearWallZ !== undefined) [p, tags[0]] = [[p[0], nearWallZ], "wall"];
  // other lanes' edges: put the pipe corner on another pipe's line
  if (!tags.length) {
    for (const { o, d } of edgeLines(points, i, lw)) {
      const t = dot(sub(raw, o), d);
      const q: Point2 = [o[0] + d[0] * t, o[1] + d[1] * t];
      if (Math.hypot(q[0] - raw[0], q[1] - raw[1]) <= MITRE_PULL) {
        p = q;
        tags.push("pipe");
        break;
      }
    }
  }
  if (!tags.length && mode === "fine") {
    p = [Math.round(raw[0] / GRID) * GRID, Math.round(raw[1] / GRID) * GRID];
    tags.push("fine grid");
  }
  return { p: [r3(p[0]), r3(p[1])], tags: tags.length ? tags : ["free"], guides: [] };
}

// ------------------------------------------------------------------------------------------------ helpers
/**
 * H: turn corner i into a hairpin. The corner point stays; a second point goes one lane width to the inside of the turn,
 * so the track turns 180° round the end of a divider. Both get radius w/2 (the divider ends in a point).
 */
export function makeHairpin(points: DesignPoint[], i: number, lw: number): DesignPoint[] | null {
  const n = points.length;
  const P = xz(points[i]);
  const a = unit(sub(P, xz(points[(i - 1 + n) % n]))), b = unit(sub(xz(points[(i + 1) % n]), P));
  const cross = a[0] * b[1] - a[1] * b[0];
  if (Math.abs(cross) < 1e-9 && dot(a, b) > 0) return null; // a straight: no side to turn to
  const side = cross >= 0 ? 1 : -1; // left turn: the second point goes to the left of the incoming straight
  const w = widthOf(points[i], lw);
  const Q: Point2 = [r3(P[0] - a[1] * side * w), r3(P[1] + a[0] * side * w)];
  const nextP = xz(points[(i + 1) % n]);
  if (Math.hypot(Q[0] - nextP[0], Q[1] - nextP[1]) < 0.3) return null;
  const p1: DesignPoint = { ...points[i], radius: w / 2 };
  const p2: DesignPoint = { ...points[i], x: Q[0], z: Q[1], radius: w / 2 };
  return [...points.slice(0, i), p1, p2, ...points.slice(i + 1)];
}

/** Turn of corner i in degrees (for the sharp-turn badge). */
export function turnDegrees(points: DesignPoint[], i: number): number {
  const n = points.length;
  const P = xz(points[i]);
  const a = unit(sub(P, xz(points[(i - 1 + n) % n]))), b = unit(sub(xz(points[(i + 1) % n]), P));
  return (Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * 180) / Math.PI;
}

/** Where a click on the straight after point `after` inserts a point, snapped along the straight for the mode. */
export function snapInsertion(at: Point2, points: DesignPoint[], after: number, mode: SnapMode, area: Area, lw: number): Point2 {
  const a = xz(points[after]), b = xz(points[(after + 1) % points.length]);
  if (mode === "free" || len(sub(b, a)) < 1e-9) return [r3(at[0]), r3(at[1])];
  const w = (widthOf(points[after], lw) + widthOf(points[(after + 1) % points.length], lw)) / 2;
  const q = alongLine(at, a, unit(sub(b, a)), mode, area, w);
  // stay on the straight
  const t = dot(sub(q, a), unit(sub(b, a))), L = len(sub(b, a));
  return t > 0.3 && t < L - 0.3 ? [r3(q[0]), r3(q[1])] : [r3(at[0]), r3(at[1])];
}

// ------------------------------------------------------------------------------------------------ pinned corners
/** Corners whose pipes sit exactly in a corner of the hall (within 1 mm): index -> that hall corner. */
export function pinnedCorners(points: DesignPoint[], area: Area, lw: number, except = -1): Map<number, Point2> {
  const out = new Map<number, Point2>();
  const X = area.length / 2, Z = area.width / 2;
  points.forEach((_, j) => {
    if (j === except || !hasMitre(points, j, lw)) return;
    const m = mitrePoint(points, j, lw);
    if (!m) return;
    const c: Point2 = [Math.sign(m[0]) * X, Math.sign(m[1]) * Z];
    if (Math.hypot(m[0] - c[0], m[1] - c[1]) <= 1e-3) out.set(j, c);
  });
  return out;
}

/** a pinned corner follows its neighbours by at most this much; beyond, it stays where it was */
export const PIN_FOLLOW = 0.5; // m

/**
 * Keep pinned corners in their hall corners while other points move: re-solve each from its mitre (a few passes, as
 * moving one changes its neighbours' angles). A corner only follows while it stays square and within PIN_FOLLOW of where
 * it started (`origin`, the points at the start of the drag) — a neighbour pulled far away doesn't drag it along.
 */
export function keepPinned(points: DesignPoint[], pinned: Map<number, Point2>, lw: number, origin: DesignPoint[] = points): DesignPoint[] {
  let pts = points;
  for (let pass = 0; pass < 50; pass++) {
    let moved = 0;
    for (const [j, c] of pinned) {
      const q = placeByMitre(pts, j, c, lw);
      const o = origin[j];
      const trial = pts.map((p, k) => (k === j ? { ...p, x: q[0], z: q[1] } : p));
      const ok = Number.isFinite(q[0]) && Number.isFinite(q[1]) && Math.hypot(q[0] - o.x, q[1] - o.z) <= PIN_FOLLOW && hasMitre(trial, j, lw);
      const target: Point2 = ok ? q : [o.x, o.z];
      moved = Math.max(moved, Math.hypot(target[0] - pts[j].x, target[1] - pts[j].z));
      pts = pts.map((p, k) => (k === j ? { ...p, x: target[0], z: target[1] } : p));
    }
    if (moved < 1e-10) break;
  }
  return pts.map((p, j) => (pinned.has(j) ? { ...p, x: tidy(p.x), z: tidy(p.z) } : p));
}

/** A solved coordinate: to the micrometre, and onto the millimetre when it's that close to one. */
export function tidy(v: number): number {
  const mm = Math.round(v * 1000) / 1000;
  return Math.abs(v - mm) < 1e-5 ? mm : Math.round(v * 1e6) / 1e6;
}
