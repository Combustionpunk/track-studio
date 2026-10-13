// rctrack geometry engine: design -> built. A port of reference/bake.py; must reproduce its output (see test/).
// Pure: no DOM, no Node APIs.
import { degrees, pyFormat, pyMod, r3, radians, searchSorted } from "./num.js";
import type {
  Built,
  BuiltFeature,
  Check,
  DesignPoint,
  Divider,
  FeatureType,
  Footprint,
  Obstacle,
  Point2,
  RcTrack,
  Side,
} from "./types.js";

export const GENERATOR = "track-studio-engine 1.1";
export const SAMPLE = 0.05; // internal sampling (m)
export const EXPORT_STEP = 0.25; // racing line export spacing (m)
export const MERGE_GAP = 0.6; // borders closer than this (from different parts of the track) are merged...
export const MERGE_FULL = 0.2; // ...fully below this, blended in between
export const MERGE_MIN_SEP = 3.0; // ...but only if they are this far apart along the track
export const MERGE_PARALLEL = 0.9; // ...and run roughly parallel (|cos| of the angle between them)
const MERGE_K = 48; // bake.py asks the KD-tree for the 48 nearest neighbours (self included)
export const SIMPLIFY_TOL = 0.02; // divider polyline simplification tolerance (m)
export const MIN_RADIUS = 0.6; // tightest racing-line radius a 1/10 buggy can follow (m)
export const MIN_WIDTH = 1.4; // narrowest sensible lane (m)
export const FOOT_CELL = 0.1; // footprint raster cell (m)
export const PIPE_R = 0.04; // half the pipe thickness, added round the lanes
export const EYE_HEIGHT = 2.8;
export const ROSTRUM_SETBACK = 1.5; // rostrum distance outside the area edge (m)

/** along-track distance (m), height (m) for the default length/height; scaled to the feature's values */
export const FEATURE_PROFILES: Record<FeatureType, Point2[]> = {
  tabletop: [[0, 0], [0.7, 1], [1.5, 1], [2.2, 0]],
  double: [[0, 0], [0.55, 1], [0.85, 0], [1.75, 0], [2.05, 1], [2.6, 0]],
  kicker: [[0, 0], [0.6, 1], [0.8, 0]],
  stepup: [[0, 0], [0.6, 1], [1.6, 1], [1.6, 0.0]],
  stepdown: [[0, 0], [0.0, 1], [1.0, 1], [1.8, 0]],
  whoops: [[0, 0], [0.3, 1], [0.6, 0], [0.9, 1], [1.2, 0], [1.5, 1], [1.8, 0]],
  bump: [[0, 0], [0.25, 1], [0.5, 0]],
};
/** [length, height] */
export const FEATURE_DEFAULTS: Record<FeatureType, [number, number]> = {
  tabletop: [2.2, 0.14],
  double: [2.6, 0.15],
  kicker: [0.8, 0.12],
  stepup: [1.6, 0.12],
  stepdown: [1.8, 0.12],
  whoops: [1.8, 0.05],
  bump: [0.5, 0.04],
};

const norm = (x: number, z: number): number => Math.sqrt(x * x + z * z);

// ------------------------------------------------------------------ racing line
/** Dense samples of the racing line, every ~SAMPLE metres. curvature = 1/r, signed (+ = left). */
export interface Line {
  n: number;
  x: Float64Array;
  z: Float64Array;
  width: Float64Array;
  curvature: Float64Array;
}

export interface Corner {
  start: Point2;
  end: Point2;
  /** radius after shrinking to fit */
  r: number;
  sign: 1 | -1;
  /** unit direction in / out */
  a: Point2;
  b: Point2;
  /** turn angle (rad) */
  th: number;
}

/** Closed polyline through the corner points, each corner filleted with its radius (shrunk to fit the straights). */
export function racingLine(points: DesignPoint[], defaultWidth: number): { line: Line; corners: Corner[] } {
  const n = points.length;
  const W = points.map((p) => p.width ?? defaultWidth);
  const corners: Corner[] = [];
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];
    let ax = p.x - prev.x, az = p.z - prev.z;
    let bx = next.x - p.x, bz = next.z - p.z;
    const la = norm(ax, az), lb = norm(bx, bz);
    ax /= la; az /= la; bx /= lb; bz /= lb;
    const cross = ax * bz - az * bx;
    const th = Math.acos(Math.min(1, Math.max(-1, ax * bx + az * bz)));
    let r = p.radius ?? 1.0;
    let t = th > 1e-6 ? r * Math.tan(th / 2) : 0.0;
    const tmax = 0.5 * Math.min(la, lb);
    if (t > tmax) {
      // radius too big for the straights either side: shrink it
      t = tmax;
      r = th > 1e-6 ? t / Math.tan(th / 2) : 0.0;
    }
    corners.push({
      start: [p.x - ax * t, p.z - az * t],
      end: [p.x + bx * t, p.z + bz * t],
      r,
      sign: cross > 0 ? 1 : -1,
      a: [ax, az],
      b: [bx, bz],
      th,
    });
  }

  const ox: number[] = [], oz: number[] = [], ow: number[] = [], oc: number[] = [];
  for (let i = 0; i < n; i++) {
    const c = corners[i];
    if (c.th > 1e-6 && c.r > 0) {
      const nx = -c.a[1] * c.sign, nz = c.a[0] * c.sign;
      const cx = c.start[0] + nx * c.r, cz = c.start[1] + nz * c.r;
      const a0 = Math.atan2(c.start[1] - cz, c.start[0] - cx);
      const a1 = Math.atan2(c.end[1] - cz, c.end[0] - cx);
      const da = pyMod(a1 - a0 + Math.PI, 2 * Math.PI) - Math.PI;
      const m = Math.max(2, Math.trunc((Math.abs(da) * c.r) / SAMPLE));
      for (let k = 0; k < m; k++) {
        const ang = a0 + (da * k) / m;
        ox.push(cx + c.r * Math.cos(ang));
        oz.push(cz + c.r * Math.sin(ang));
        ow.push(W[i]);
        oc.push(c.sign / c.r);
      }
    }
    const nxt = corners[(i + 1) % n].start;
    const dx = nxt[0] - c.end[0], dz = nxt[1] - c.end[1];
    const L = norm(dx, dz);
    const m = Math.max(1, Math.trunc(L / SAMPLE));
    const w1 = W[(i + 1) % n];
    for (let k = 0; k < m; k++) {
      ox.push(c.end[0] + (dx * k) / m);
      oz.push(c.end[1] + (dz * k) / m);
      ow.push(W[i] + ((w1 - W[i]) * k) / m);
      oc.push(0.0);
    }
  }
  const line: Line = {
    n: ox.length,
    x: Float64Array.from(ox),
    z: Float64Array.from(oz),
    width: Float64Array.from(ow),
    curvature: Float64Array.from(oc),
  };
  return { line, corners };
}

/** Cumulative distance at each sample, and the closed-loop total. */
export function arclength(x: Float64Array, z: Float64Array): { s: Float64Array; total: number } {
  const n = x.length;
  const s = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    s[i] = acc;
    const j = (i + 1) % n;
    acc += norm(x[j] - x[i], z[j] - z[i]);
  }
  return { s, total: acc };
}

/** Unit tangent (central difference) and left normal at each sample. */
export function frame(x: Float64Array, z: Float64Array) {
  const n = x.length;
  const tx = new Float64Array(n), tz = new Float64Array(n);
  const lx = new Float64Array(n), lz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, k = (i - 1 + n) % n;
    const dx = x[j] - x[k], dz = z[j] - z[k];
    const L = norm(dx, dz);
    tx[i] = dx / L; tz[i] = dz / L;
    lx[i] = -tz[i]; lz[i] = tx[i];
  }
  return { tx, tz, lx, lz };
}

// ------------------------------------------------------------------ dividers
/** Uniform grid for fixed-radius neighbour queries (stands in for scipy's cKDTree). */
class PointGrid {
  private cells = new Map<number, number[]>();
  constructor(private x: Float64Array, private z: Float64Array, private size: number) {
    for (let i = 0; i < x.length; i++) {
      const key = this.key(Math.floor(x[i] / size), Math.floor(z[i] / size));
      let c = this.cells.get(key);
      if (!c) this.cells.set(key, (c = []));
      c.push(i);
    }
  }
  private key(cx: number, cz: number): number {
    return (cx + 32768) * 65536 + (cz + 32768);
  }
  /** Up to k nearest points with distance < radius (radius <= grid size), nearest first, like cKDTree.query. */
  query(px: number, pz: number, k: number, radius: number): { d: number; j: number }[] {
    const cx = Math.floor(px / this.size), cz = Math.floor(pz / this.size);
    const r2 = radius * radius;
    const found: { d2: number; j: number }[] = [];
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gz = cz - 1; gz <= cz + 1; gz++) {
        const c = this.cells.get(this.key(gx, gz));
        if (!c) continue;
        for (const j of c) {
          const dx = this.x[j] - px, dz = this.z[j] - pz;
          const d2 = dx * dx + dz * dz;
          if (d2 < r2) found.push({ d2, j });
        }
      }
    }
    found.sort((a, b) => a.d2 - b.d2 || a.j - b.j);
    return found.slice(0, k).map((f) => ({ d: Math.sqrt(f.d2), j: f.j }));
  }
}

export interface DividerResult {
  dividers: Divider[];
  /** each divider run before simplification, same order as `dividers` */
  runs: Point2[][];
  /** border points after merging: right side (n) then left side (n) */
  mergedX: Float64Array;
  mergedZ: Float64Array;
  weight: Float64Array;
}

export function dividers(line: Line): DividerResult {
  const { n, x, z } = line;
  const { s, total } = arclength(x, z);
  const { tx, tz, lx, lz } = frame(x, z);
  // borders: right side then left side
  const bx = new Float64Array(2 * n), bz = new Float64Array(2 * n);
  for (let i = 0; i < n; i++) {
    const hw = line.width[i] / 2;
    bx[i] = x[i] - lx[i] * hw; bz[i] = z[i] - lz[i] * hw;
    bx[n + i] = x[i] + lx[i] * hw; bz[n + i] = z[i] + lz[i] * hw;
  }
  const idx = (i: number) => (i < n ? i : i - n);
  const grid = new PointGrid(bx, bz, MERGE_GAP);
  const mx = Float64Array.from(bx), mz = Float64Array.from(bz);
  const weight = new Float64Array(2 * n);
  const partner = new Int32Array(2 * n).fill(-1);
  for (let i = 0; i < 2 * n; i++) {
    const px = bx[i], pz = bz[i];
    for (const { d, j } of grid.query(px, pz, MERGE_K, MERGE_GAP)) {
      if (j === i) continue;
      let ds = Math.abs(s[idx(i)] - s[idx(j)]);
      ds = Math.min(ds, total - ds);
      if (ds < MERGE_MIN_SEP) continue;
      // only merge borders running alongside each other
      if (Math.abs(tx[idx(i)] * tx[idx(j)] + tz[idx(i)] * tz[idx(j)]) < MERGE_PARALLEL) continue;
      const w = Math.min(1, Math.max(0, (MERGE_GAP - d) / (MERGE_GAP - MERGE_FULL)));
      mx[i] = px + ((bx[i] + bx[j]) / 2 - px) * w;
      mz[i] = pz + ((bz[i] + bz[j]) / 2 - pz) * w;
      weight[i] = w;
      partner[i] = j;
      break;
    }
  }
  // A fully shared divider is generated once: only by the border with the lower index
  const skip = new Uint8Array(2 * n);
  for (let i = 0; i < 2 * n; i++) skip[i] = weight[i] > 0.99 && partner[i] >= 0 && partner[i] < i ? 1 : 0;

  const runs: { pts: Point2[]; shared: boolean }[] = [];
  for (const side of [0, 1]) {
    const off = side * n;
    let nSkip = 0, firstSkip = -1;
    for (let i = 0; i < n; i++) if (skip[off + i]) { nSkip++; if (firstSkip < 0) firstSkip = i; }
    // rotate so a run doesn't start in the middle
    const start = nSkip > 0 && nSkip < n ? firstSkip : 0;
    let cur: Point2[] = [];
    let sharedCount = 0;
    for (let k = 0; k <= n; k++) {
      const i = (start + k) % n;
      if (k < n && !skip[off + i]) {
        cur.push([mx[off + i], mz[off + i]]);
        if (weight[off + i] > 0.99) sharedCount++;
      } else if (cur.length) {
        if (cur.length > 1) runs.push({ pts: cur, shared: sharedCount / cur.length > 0.5 });
        cur = [];
        sharedCount = 0;
      }
    }
  }
  const out: Divider[] = runs.map(({ pts, shared }) => {
    const last = pts[pts.length - 1];
    const closed = pts.length >= n && norm(pts[0][0] - last[0], pts[0][1] - last[1]) < 0.2;
    const simp = rdp(pts, SIMPLIFY_TOL);
    return { shared, closed, points: simp.map(([px, pz]) => [r3(px), r3(pz)] as Point2) };
  });
  return { dividers: out, runs: runs.map((r) => r.pts), mergedX: mx, mergedZ: mz, weight };
}

/** Ramer–Douglas–Peucker, same split rule and distance formula as bake.py's rdp(). */
export function rdp(pts: Point2[], tol: number): Point2[] {
  const out: Point2[] = [];
  const rec = (lo: number, hi: number) => {
    // emits pts[lo..hi] simplified, excluding pts[hi]
    if (hi - lo + 1 < 3) {
      for (let k = lo; k < hi; k++) out.push(pts[k]);
      return;
    }
    const a = pts[lo], b = pts[hi];
    const abx = b[0] - a[0], abz = b[1] - a[1];
    const L = norm(abx, abz);
    let best = -1, bestD = -Infinity;
    for (let k = lo; k <= hi; k++) {
      const p = pts[k];
      const d = L < 1e-9 ? norm(p[0] - a[0], p[1] - a[1]) : Math.abs(abx * (p[1] - a[1]) - abz * (p[0] - a[0])) / L;
      if (d > bestD) { bestD = d; best = k; }
    }
    if (bestD > tol) {
      rec(lo, best);
      rec(best, hi);
    } else {
      out.push(a);
    }
  };
  if (pts.length < 3) return pts.slice();
  rec(0, pts.length - 1);
  out.push(pts[pts.length - 1]);
  return out;
}

// ------------------------------------------------------------------ features, start, checks
/** Position, unit direction and segment index at distance d along the line. */
export function atDistance(x: Float64Array, z: Float64Array, s: Float64Array, total: number, d: number) {
  d = pyMod(d, total);
  const i = searchSorted(s, d, "right") - 1;
  const j = (i + 1) % x.length;
  const segx = x[j] - x[i], segz = z[j] - z[i];
  const L = norm(segx, segz) || 1.0;
  const f = (d - s[i]) / L;
  return { p: [x[i] + segx * f, z[i] + segz * f] as Point2, t: [segx / L, segz / L] as Point2, i };
}

export function headingDeg(t: Point2): number {
  return r3(pyMod(degrees(Math.atan2(t[1], t[0])) + 360, 360));
}

// ------------------------------------------------------------------ footprint
/** Row-major boolean raster: mask[r * cols + c], cell centres at origin + (index + 0.5) * cell. */
export interface Raster {
  rows: number;
  cols: number;
  origin: Point2;
  mask: Uint8Array;
}

/** Raster of the area covered by lanes (plus pipe thickness `extra`). */
export function laneMask(
  line: Line,
  cell = FOOT_CELL,
  frameOf?: { origin: Point2; rows: number; cols: number },
  extra = PIPE_R,
): Raster {
  const { n, x, z } = line;
  const hw = new Float64Array(n);
  for (let i = 0; i < n; i++) hw[i] = line.width[i] / 2 + extra;
  let origin: Point2, rows: number, cols: number;
  if (!frameOf) {
    let minx = Infinity, minz = Infinity, maxx = -Infinity, maxz = -Infinity, hwmax = -Infinity;
    for (let i = 0; i < n; i++) {
      minx = Math.min(minx, x[i]); maxx = Math.max(maxx, x[i]);
      minz = Math.min(minz, z[i]); maxz = Math.max(maxz, z[i]);
      hwmax = Math.max(hwmax, hw[i]);
    }
    origin = [minx - hwmax - cell, minz - hwmax - cell];
    const hi: Point2 = [maxx + hwmax + cell, maxz + hwmax + cell];
    rows = Math.ceil((hi[1] - origin[1]) / cell);
    cols = Math.ceil((hi[0] - origin[0]) / cell);
  } else {
    ({ origin, rows, cols } = frameOf);
  }
  const mask = new Uint8Array(rows * cols);
  for (let i = 0; i < n; i += 2) {
    const px = x[i], pz = z[i], r = hw[i];
    const c0 = Math.max(Math.trunc((px - r - origin[0]) / cell), 0);
    const c1 = Math.min(Math.trunc((px + r - origin[0]) / cell) + 1, cols);
    const r0 = Math.max(Math.trunc((pz - r - origin[1]) / cell), 0);
    const r1 = Math.min(Math.trunc((pz + r - origin[1]) / cell) + 1, rows);
    if (c0 >= c1 || r0 >= r1) continue;
    const rr = r * r;
    for (let row = r0; row < r1; row++) {
      const dz = origin[1] + (row + 0.5) * cell - pz;
      for (let col = c0; col < c1; col++) {
        const dx = origin[0] + (col + 0.5) * cell - px;
        if (dx * dx + dz * dz <= rr) mask[row * cols + col] = 1;
      }
    }
  }
  return { rows, cols, origin, mask };
}

/** Raster of the fixed obstacles on the given grid. */
export function obstacleMask(obstacles: Obstacle[] | undefined, origin: Point2, rows: number, cols: number, cell = FOOT_CELL): Uint8Array {
  const m = new Uint8Array(rows * cols);
  for (const o of obstacles ?? []) {
    const a = radians(o.type === "rect" ? o.rotation ?? 0 : 0);
    const ca = Math.cos(a), sa = Math.sin(a);
    for (let row = 0; row < rows; row++) {
      const cz = origin[1] + (row + 0.5) * cell;
      for (let col = 0; col < cols; col++) {
        const cx = origin[0] + (col + 0.5) * cell;
        let hit: boolean;
        if (o.type === "circle") {
          hit = (cx - o.x) ** 2 + (cz - o.z) ** 2 <= o.radius ** 2;
        } else {
          const dx = cx - o.x, dz = cz - o.z;
          const u = dx * ca + dz * sa, v = -dx * sa + dz * ca;
          hit = Math.abs(u) <= o.length / 2 && Math.abs(v) <= o.width / 2;
        }
        if (hit) m[row * cols + col] = 1;
      }
    }
  }
  return m;
}

/** Row-major run lengths of a mask: alternating, starting with an (often empty) run of 0s. */
export function rle(mask: Uint8Array): string {
  const runs: number[] = [];
  let cur = 0, count = 0;
  for (const v of mask) {
    if (v === cur) count++;
    else { runs.push(count); cur = v; count = 1; }
  }
  runs.push(count);
  return runs.join(" ");
}

/** Inverse of rle(). */
export function unrle(s: string, size: number): Uint8Array {
  const m = new Uint8Array(size);
  let pos = 0, v = 0;
  for (const tok of s.split(" ")) {
    const k = Number(tok);
    if (v) m.fill(1, pos, pos + k);
    pos += k;
    v ^= 1;
  }
  return m;
}

// ------------------------------------------------------------------ bake
/** Compute the `built` section from `design` (and area/obstacles). */
export function bakeBuilt(doc: RcTrack): Built {
  const design = doc.design, area = doc.area;
  const W0 = design.laneWidth ?? 2.0;
  const { line, corners } = racingLine(design.points, W0);
  const { x, z } = line;
  const { s, total } = arclength(x, z);
  const divs = dividers(line).dividers;
  const checks: Check[] = [];

  // racing line export, ~EXPORT_STEP spacing
  const step = Math.max(1, Math.trunc(EXPORT_STEP / SAMPLE));
  const racing: Built["racingLine"] = [];
  for (let i = 0; i < line.n; i += step) racing.push([r3(x[i]), r3(z[i]), r3(line.width[i])]);

  // features
  const feats: BuiltFeature[] = [];
  for (const f of design.features ?? []) {
    const typ = f.type;
    const [L0, H0] = FEATURE_DEFAULTS[typ];
    const length = f.length ?? L0, height = f.height ?? H0;
    const { p, t, i } = atDistance(x, z, s, total, f.distance);
    const prof = FEATURE_PROFILES[typ];
    const last = prof[prof.length - 1][0];
    const profile = prof.map(([a, h]) => [r3(last ? (a / last) * length : 0), r3(h * height)] as Point2);
    const width = line.width[i] - 0.08;
    feats.push({ type: typ, x: r3(p[0]), z: r3(p[1]), heading: headingDeg(t), length: r3(length), width: r3(width), height: r3(height), profile });
    // check: jump on or landing into a corner
    const i0 = searchSorted(s, pyMod(f.distance - length / 2, total));
    const i1 = searchSorted(s, pyMod(f.distance + length / 2 + 1.0, total));
    let maxCurv = -Infinity;
    for (let k = i0; k < i1; k++) maxCurv = Math.max(maxCurv, Math.abs(line.curvature[k % line.n]));
    if (i1 > i0 && maxCurv > 0) {
      checks.push({ level: "warning", code: "feature-in-corner", x: r3(p[0]), z: r3(p[1]), message: `${typ} at ${pyFormat(f.distance, 1)} m is on or lands into a corner` });
    }
  }

  // start line
  const sd = design.start?.distance ?? 0.0;
  const st = atDistance(x, z, s, total, sd);
  const startLine = { x: r3(st.p[0]), z: r3(st.p[1]), heading: headingDeg(st.t), width: r3(line.width[st.i]), distance: r3(sd) };

  // rostrum
  const side: Side = design.rostrum?.side ?? "south";
  const off = design.rostrum?.offset ?? 0.0;
  const L = area.length, Wd = area.width;
  const pos: Record<Side, Point2> = {
    north: [off, Wd / 2 + ROSTRUM_SETBACK],
    south: [off, -Wd / 2 - ROSTRUM_SETBACK],
    east: [L / 2 + ROSTRUM_SETBACK, off],
    west: [-L / 2 - ROSTRUM_SETBACK, off],
  };
  const rostrum = { side, x: r3(pos[side][0]), z: r3(pos[side][1]), eyeHeight: EYE_HEIGHT };

  // checks: area, radius, width
  const { lx, lz } = frame(x, z);
  outer: for (const sgn of [-1, 1]) {
    for (let i = 0; i < line.n; i++) {
      const hw = line.width[i] / 2;
      const bx = sgn < 0 ? x[i] - lx[i] * hw : x[i] + lx[i] * hw;
      const bz = sgn < 0 ? z[i] - lz[i] * hw : z[i] + lz[i] * hw;
      if (Math.abs(bx) > L / 2 + 0.01 || Math.abs(bz) > Wd / 2 + 0.01) {
        checks.push({ level: "error", code: "outside-area", x: r3(bx), z: r3(bz), message: "Track goes outside the venue's track area" });
        break outer;
      }
    }
  }
  corners.forEach((c, i) => {
    const p = design.points[i];
    if (c.th > 1e-3 && c.r > 0 && c.r < MIN_RADIUS) {
      checks.push({ level: "warning", code: "tight-corner", x: r3(p.x), z: r3(p.z), message: `Corner radius ${pyFormat(c.r, 2)} m is tighter than a buggy can turn (${MIN_RADIUS} m)` });
    }
    if (c.th > 1e-3 && Math.abs(c.r - (p.radius ?? 1.0)) > 0.01) {
      checks.push({ level: "info", code: "radius-reduced", x: r3(p.x), z: r3(p.z), message: `Corner radius reduced to ${pyFormat(c.r, 2)} m to fit the straights either side` });
    }
  });
  let minWidth = Infinity;
  for (const w of line.width) minWidth = Math.min(minWidth, w);
  if (minWidth < MIN_WIDTH) {
    checks.push({ level: "warning", code: "narrow-lane", message: `Lane narrower than ${MIN_WIDTH} m` });
  }

  // footprint + obstacles
  const fp = laneMask(line);
  if (doc.obstacles?.length) {
    const om = obstacleMask(doc.obstacles, fp.origin, fp.rows, fp.cols);
    const hit = fp.mask.findIndex((v, k) => v === 1 && om[k] === 1);
    if (hit >= 0) {
      const row = Math.floor(hit / fp.cols), col = hit % fp.cols;
      checks.push({ level: "error", code: "obstacle", x: r3(fp.origin[0] + (col + 0.5) * FOOT_CELL), z: r3(fp.origin[1] + (row + 0.5) * FOOT_CELL), message: "Track overlaps a fixed obstacle" });
    }
  }
  const footprint: Footprint = {
    cell: FOOT_CELL,
    origin: [r3(fp.origin[0]), r3(fp.origin[1])],
    rows: fp.rows,
    cols: fp.cols,
    bbox: [r3(fp.origin[0]), r3(fp.origin[1]), r3(fp.origin[0] + fp.cols * FOOT_CELL), r3(fp.origin[1] + fp.rows * FOOT_CELL)],
    rle: rle(fp.mask),
  };

  let pipe = 0;
  for (const d of divs) {
    let run = 0;
    for (let k = 1; k < d.points.length; k++) run += Math.hypot(d.points[k][0] - d.points[k - 1][0], d.points[k][1] - d.points[k - 1][1]);
    pipe += run;
  }
  const turn20 = radians(20);
  return {
    generator: GENERATOR,
    lapLength: r3(total),
    racingLine: racing,
    dividers: divs,
    features: feats,
    startLine,
    rostrum,
    checks,
    footprint,
    stats: { dividerLength: r3(pipe), dividerRuns: divs.length, corners: corners.filter((c) => c.th > turn20).length },
  };
}

/** Returns a copy of the track with a fresh `built` section. Does not modify `doc`. */
export function bake(doc: RcTrack): RcTrack {
  return { ...doc, built: bakeBuilt(doc) };
}
