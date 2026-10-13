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
  Size,
} from "./types.js";

export const GENERATOR = "track-studio-engine 1.3";
export const SAMPLE = 0.05; // internal sampling (m)
export const EXPORT_STEP = 0.25; // racing line export spacing (m)
export const MERGE_GAP = 0.6; // borders closer than this (from different parts of the track) are merged...
export const MERGE_FULL = 0.2; // ...fully below this, blended in between
export const MERGE_MIN_SEP = 3.0; // ...but only if they are this far apart along the track
export const MERGE_PARALLEL = 0.9; // ...and run roughly parallel (|cos| of the angle between them)
const MERGE_K = 48; // bake.py asks the KD-tree for the 48 nearest neighbours (self included)
export const SIMPLIFY_TOL = 0.02; // divider polyline simplification tolerance (m)
export const MERGE_BLEND = 4; // shared <-> separate transitions are blended over this many samples either side (~0.4 m)
export const MIN_DIVIDER = 0.25; // divider fragments shorter than this (m) are dropped
export const BLEND_BREAK = radians(30); // blending never reaches across a border turning more than this (a corner)
export const COVERED = 0.06; // a divider end lying within this (m) of a longer divider is already drawn by it: trimmed
export const SQUARE_MAX_TURN = radians(120); // square outer corners turning more than this get a bevel, not a mitre spike:
/** cut square to the bisector at (r + width/2) / cos(60°) from the arc centre — as far out as a 120° mitre reaches
 * (r = 0: width/2 / cos 60° from the corner point) */
export const BEVEL_DIST = 1 / Math.cos(radians(60));
export const MIN_RADIUS = 0.6; // tightest racing-line radius a 1/10 buggy can follow (m)
export const MIN_WIDTH = 1.4; // narrowest sensible lane (m)
export const CORNER_MIN_TURN = radians(20); // smaller changes of direction aren't corners
/**
 * Same-direction turns joined by less straight than this (m) are one corner (hairpins, carousels). The one setting for
 * the corner count — reference/bake.py has the same constant; change both (and `pnpm rebake`) to change the rule.
 */
export const CORNER_JOIN_GAP = 3.0;
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
  /** the design point and its lane width */
  P: Point2;
  w: number;
  /** arc samples: arc0 .. arc0+m-1 (m = 0: no arc) */
  arc0: number;
  m: number;
  /** straight samples after the corner: str0 .. str0+strn-1 */
  str0: number;
  strn: number;
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
      P: [p.x, p.z],
      w: W[i],
      arc0: 0,
      m: 0,
      str0: 0,
      strn: 0,
    });
  }

  const ox: number[] = [], oz: number[] = [], ow: number[] = [], oc: number[] = [];
  for (let i = 0; i < n; i++) {
    const c = corners[i];
    c.arc0 = ox.length;
    if (c.th > 1e-6 && c.r > 0) {
      const nx = -c.a[1] * c.sign, nz = c.a[0] * c.sign;
      const cx = c.start[0] + nx * c.r, cz = c.start[1] + nz * c.r;
      const a0 = Math.atan2(c.start[1] - cz, c.start[0] - cx);
      const a1 = Math.atan2(c.end[1] - cz, c.end[0] - cx);
      const da = pyMod(a1 - a0 + Math.PI, 2 * Math.PI) - Math.PI;
      const m = Math.max(2, Math.trunc((Math.abs(da) * c.r) / SAMPLE));
      c.m = m;
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
    c.str0 = ox.length;
    c.strn = m;
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

/**
 * Corners as racers count them: every turn of more than CORNER_MIN_TURN, except that turns the same way joined by less
 * than CORNER_JOIN_GAP of racing line (a hairpin, or turn - short straight - turn) count as one.
 * A track that is one continuous same-direction turn counts as 1.
 */
export function countCorners(corners: Corner[], joinGap = CORNER_JOIN_GAP): number {
  const n = corners.length;
  const sig: number[] = [];
  corners.forEach((c, i) => { if (c.th > CORNER_MIN_TURN) sig.push(i); });
  if (sig.length < 2) return sig.length;
  const straight = corners.map((c, i) => {
    const next = corners[(i + 1) % n].start;
    return Math.hypot(next[0] - c.end[0], next[1] - c.end[1]);
  });
  const arc = corners.map((c) => c.r * c.th);
  let links = 0;
  sig.forEach((i, k) => {
    const j = sig[(k + 1) % sig.length];
    // racing line from the end of corner i to the start of corner j
    let gap = straight[i];
    for (let m = (i + 1) % n; m !== j; m = (m + 1) % n) gap += arc[m] + straight[m];
    if (corners[i].sign === corners[j].sign && gap < joinGap) links++;
  });
  return Math.max(1, sig.length - links);
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

// ------------------------------------------------------------------ borders
/** Unit normals pointing to the outside of corner c, for its incoming and outgoing straights. */
export function outerNormals(c: Corner): [Point2, Point2] {
  return [
    [c.sign * c.a[1], -c.sign * c.a[0]],
    [c.sign * c.b[1], -c.sign * c.b[0]],
  ];
}

/**
 * Outer border of a square corner: from the incoming straight's outer edge to the mitre (where the two straights' outer
 * offset lines meet), on to the outgoing straight's outer edge. Corners turning more than SQUARE_MAX_TURN are bevelled:
 * cut square to the bisector at (r + hw) * BEVEL_DIST from the arc's centre.
 */
export function squareOutline(c: Corner, hw: number): Point2[] {
  const [oa, ob] = outerNormals(c);
  const { P, a, b } = c;
  const half = c.th / 2;
  const S: Point2 = [c.start[0] + oa[0] * hw, c.start[1] + oa[1] * hw];
  const E: Point2 = [c.end[0] + ob[0] * hw, c.end[1] + ob[1] * hw];
  if (c.th <= SQUARE_MAX_TURN) {
    const t = hw * Math.tan(half);
    return [S, [P[0] + oa[0] * hw + a[0] * t, P[1] + oa[1] * hw + a[1] * t], E];
  }
  const R = c.r + hw; // the outer edge's distance from the arc centre
  const s1 = (R * BEVEL_DIST - R * Math.cos(half)) / Math.sin(half); // along each outer line from its tangent point
  return [S, [S[0] + a[0] * s1, S[1] + a[1] * s1], [E[0] - b[0] * s1, E[1] - b[1] * s1], E];
}

/**
 * m+1 points along polyline V (k = 0..m): V[0] at k=0, V[last] at k=m, and each inner vertex exactly on the sample nearest
 * its share of the length (skipped if there's no free sample for it); straight lines in between.
 */
export function spread(V: Point2[], m: number): Point2[] {
  const cum = [0];
  for (let k = 1; k < V.length; k++) cum.push(cum[k - 1] + norm(V[k][0] - V[k - 1][0], V[k][1] - V[k - 1][1]));
  const total = cum[cum.length - 1] || 1.0;
  const keys: [number, Point2][] = [[0, V[0]]];
  for (let v = 1; v < V.length - 1; v++) {
    let k = Math.floor((cum[v] / total) * m + 0.5);
    k = Math.max(k, keys[keys.length - 1][0] + 1);
    if (k <= m - (V.length - 1 - v)) keys.push([k, V[v]]);
  }
  keys.push([m, V[V.length - 1]]);
  const out: Point2[] = [];
  for (let q = 0; q + 1 < keys.length; q++) {
    const [ka, pa] = keys[q], [kb, pb] = keys[q + 1];
    for (let k = ka; k < kb; k++) {
      const f = (k - ka) / (kb - ka);
      out.push([pa[0] + (pb[0] - pa[0]) * f, pa[1] + (pb[1] - pa[1]) * f]);
    }
  }
  out.push(V[V.length - 1]);
  return out;
}

/** Lane edges at every sample, as flat arrays: right side and left side x/z. */
export interface Borders {
  rx: Float64Array;
  rz: Float64Array;
  lx: Float64Array;
  lz: Float64Array;
}

const outerStyle = (p: DesignPoint) => p.outer ?? "square";

/**
 * Both lane edges at every sample, offset by width/2 + extra. Straights: the racing line offset sideways. Corners: the
 * inner edge follows the arc (radius r - width/2) or, where that is <= 0, collapses to the apex where the two
 * straights' inner edges meet (straight samples that would pass it are held there); the outer edge follows the arc
 * ("round") or meets in a square corner ("square", the default).
 */
export function borders(line: Line, corners: Corner[], points: DesignPoint[], extra = 0.0): Borders {
  const { n, x, z } = line;
  const { lx: nx, lz: nz } = frame(x, z);
  const rx = new Float64Array(n), rz = new Float64Array(n), lx = new Float64Array(n), lz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const hw = line.width[i] / 2 + extra;
    rx[i] = x[i] - nx[i] * hw; rz[i] = z[i] - nz[i] * hw;
    lx[i] = x[i] + nx[i] * hw; lz[i] = z[i] + nz[i] * hw;
  }
  corners.forEach((c, i) => {
    if (!(c.th > 1e-6 && c.r > 0)) return;
    const { arc0: a0, m } = c;
    const e = c.str0 % n;
    const hwc = c.w / 2 + extra;
    const [ox, oz, ix, iz] = c.sign > 0 ? [rx, rz, lx, lz] : [lx, lz, rx, rz];
    if (outerStyle(points[i]) === "square") {
      spread(squareOutline(c, hwc), m).forEach((q, k) => {
        ox[(a0 + k) % n] = q[0];
        oz[(a0 + k) % n] = q[1];
      });
    }
    if (c.r - hwc <= 1e-9) {
      const [oa, ob] = outerNormals(c);
      let ux = -(oa[0] + ob[0]), uz = -(oa[1] + ob[1]);
      const ul = norm(ux, uz);
      ux /= ul; uz /= ul;
      const half = c.th / 2;
      const dq = hwc / Math.max(Math.cos(half), 0.05); // where the straights' inner edges meet
      const qx = c.P[0] + ux * dq, qz = c.P[1] + uz * dq;
      for (let k = 0; k < m; k++) {
        ix[(a0 + k) % n] = qx;
        iz[(a0 + k) % n] = qz;
      }
      const prev = corners[(i - 1 + corners.length) % corners.length];
      for (let k = 0; k < prev.strn; k++) {
        const j = (((a0 - 1 - k) % n) + n) % n;
        if ((ix[j] - qx) * c.a[0] + (iz[j] - qz) * c.a[1] <= 0) break;
        ix[j] = qx; iz[j] = qz;
      }
      for (let k = 0; k < c.strn; k++) {
        const j = (e + k) % n;
        if ((ix[j] - qx) * c.b[0] + (iz[j] - qz) * c.b[1] >= 0) break;
        ix[j] = qx; iz[j] = qz;
      }
    }
  });
  return { rx, rz, lx, lz };
}

/** For the footprint: the outer half of each square corner out to the mitre (racing-line arc + outer outline). */
export function squareCornerPolygons(line: Line, corners: Corner[], points: DesignPoint[], extra = 0.0): Point2[][] {
  const { n, x, z } = line;
  const polys: Point2[][] = [];
  corners.forEach((c, i) => {
    if (!(c.th > 1e-6 && c.r > 0) || outerStyle(points[i]) !== "square") return;
    const poly = squareOutline(c, c.w / 2 + extra);
    const e = c.str0 % n;
    poly.push([x[e], z[e]]);
    for (let k = c.m - 1; k >= 0; k--) poly.push([x[(c.arc0 + k) % n], z[(c.arc0 + k) % n]]);
    polys.push(poly);
  });
  return polys;
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

function nearestOnSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): Point2 {
  const abx = bx - ax, abz = bz - az;
  const L2 = abx * abx + abz * abz;
  const t = L2 === 0 ? 0.0 : Math.min(1.0, Math.max(0.0, ((px - ax) * abx + (pz - az) * abz) / L2));
  return [ax + abx * t, az + abz * t];
}

/** Samples where a (closed) border turns sharply: corners that blending must not reach across. */
function breaks(bx: Float64Array, bz: Float64Array, off: number, n: number): Uint8Array {
  const out = new Uint8Array(n);
  const cosB = Math.cos(BLEND_BREAK);
  for (let k = 0; k < n; k++) {
    const p = off + ((k - 1 + n) % n), q = off + k, r = off + ((k + 1) % n);
    const d0x = bx[q] - bx[p], d0z = bz[q] - bz[p], d1x = bx[r] - bx[q], d1z = bz[r] - bz[q];
    const l0 = norm(d0x, d0z), l1 = norm(d1x, d1z);
    if (l0 > 1e-9 !== l1 > 1e-9) out[k] = 1; // entering / leaving a collapsed inside apex
    else if (l0 > 1e-9 && (d0x * d1x + d0z * d1z) / (l0 * l1) < cosB) out[k] = 1;
  }
  return out;
}

/** Moving average over up to ±half samples along a closed border, not reaching past a break (a corner). */
function blend(v: Float64Array, off: number, n: number, half: number, brk: Uint8Array): Float64Array {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let lo = 0;
    while (lo < half && !brk[(i - lo + n) % n]) lo++;
    let hi = 0;
    while (hi < half && !brk[(i + hi) % n]) hi++;
    let acc = 0;
    for (let k = -lo; k <= hi; k++) acc += v[off + ((i + k + n) % n)];
    out[i] = acc / (lo + hi + 1);
  }
  return out;
}

export interface DividerResult {
  dividers: Divider[];
  /** every divider run before simplification / trimming (dense border points after merging) */
  runs: Point2[][];
  /** border points after merging: right side (n) then left side (n) */
  mergedX: Float64Array;
  mergedZ: Float64Array;
  /** how far each border point is merged with a neighbouring part of the track (0..1, after blending) */
  weight: Float64Array;
  /** the lane edges before merging: right side (n) then left side (n) */
  borderX: Float64Array;
  borderZ: Float64Array;
}

export function dividers(line: Line, corners: Corner[], points: DesignPoint[]): DividerResult {
  const { n, x, z } = line;
  const { s, total } = arclength(x, z);
  const bd = borders(line, corners, points);
  const N = 2 * n;
  // borders: right side then left side
  const bx = new Float64Array(N), bz = new Float64Array(N);
  bx.set(bd.rx, 0); bx.set(bd.lx, n);
  bz.set(bd.rz, 0); bz.set(bd.lz, n);
  const idx = (i: number) => (i < n ? i : i - n);
  // each border's own direction (central difference); none where it has collapsed to a point (an inside apex)
  const tbx = new Float64Array(N), tbz = new Float64Array(N), hasDir = new Uint8Array(N);
  for (let side = 0; side < 2; side++) {
    for (let k = 0; k < n; k++) {
      const i = side * n + k, a = side * n + ((k + 1) % n), b = side * n + ((k - 1 + n) % n);
      const dx = bx[a] - bx[b], dz = bz[a] - bz[b];
      const L = norm(dx, dz);
      if (L > 1e-9) {
        tbx[i] = dx / L; tbz[i] = dz / L; hasDir[i] = 1;
      }
    }
  }
  const grid = new PointGrid(bx, bz, MERGE_GAP);
  const dispX = new Float64Array(N), dispZ = new Float64Array(N);
  const weight = new Float64Array(N);
  const partner = new Int32Array(N).fill(-1);
  for (let i = 0; i < N; i++) {
    const px = bx[i], pz = bz[i];
    for (const { j } of grid.query(px, pz, MERGE_K, MERGE_GAP)) {
      if (j === i) continue;
      let ds = Math.abs(s[idx(i)] - s[idx(j)]);
      ds = Math.min(ds, total - ds);
      if (ds < MERGE_MIN_SEP) continue;
      // only merge borders running alongside each other (a collapsed apex goes with anything)
      if (hasDir[i] && hasDir[j] && Math.abs(tbx[i] * tbx[j] + tbz[i] * tbz[j]) < MERGE_PARALLEL) continue;
      // the partner border's nearest point (on its segments either side of j), not just its nearest sample
      const base = j < n ? 0 : n, jn = j - base;
      let q: Point2 | null = null, qd = Infinity;
      for (const o of [-1, 0]) {
        const a = base + ((((jn + o) % n) + n) % n), b = base + ((((jn + o + 1) % n) + n) % n);
        const c = nearestOnSegment(px, pz, bx[a], bz[a], bx[b], bz[b]);
        const d = norm(px - c[0], pz - c[1]);
        if (d < qd) [q, qd] = [c, d];
      }
      const w = Math.min(1, Math.max(0, (MERGE_GAP - qd) / (MERGE_GAP - MERGE_FULL)));
      dispX[i] = ((px + q![0]) / 2 - px) * w;
      dispZ[i] = ((pz + q![1]) / 2 - pz) * w;
      weight[i] = w;
      partner[i] = j;
      break;
    }
  }
  // blend in and out of shared sections, so a pipe peels away smoothly instead of kinking; corners stay sharp:
  // blending stops at them, and a corner vertex moves to where its two (moved) legs meet
  for (let side = 0; side < 2; side++) {
    const off = side * n;
    const brk = breaks(bx, bz, off, n);
    const dx = blend(dispX, off, n, MERGE_BLEND, brk), dz = blend(dispZ, off, n, MERGE_BLEND, brk), ws = blend(weight, off, n, MERGE_BLEND, brk);
    for (let k = 0; k < n; k++) {
      if (!brk[k]) continue;
      const a = (k - 1 + n) % n, b = (k + 1) % n;
      const e1x = bx[off + k] - bx[off + a], e1z = bz[off + k] - bz[off + a];
      const e2x = bx[off + b] - bx[off + k], e2z = bz[off + b] - bz[off + k];
      const den = e1x * e2z - e1z * e2x;
      if (Math.abs(den) > 1e-12) {
        const p1x = bx[off + a] + dx[a], p1z = bz[off + a] + dz[a];
        const p2x = bx[off + b] + dx[b], p2z = bz[off + b] + dz[b];
        const wx = p2x - p1x, wz = p2z - p1z;
        const t = (wx * e2z - wz * e2x) / den;
        dx[k] = p1x + e1x * t - bx[off + k];
        dz[k] = p1z + e1z * t - bz[off + k];
      }
      const nb = ws[a] >= ws[b] ? a : b;
      ws[k] = ws[nb];
      partner[off + k] = partner[off + nb];
    }
    dispX.set(dx, off); dispZ.set(dz, off); weight.set(ws, off);
  }
  const mx = new Float64Array(N), mz = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    mx[i] = bx[i] + dispX[i];
    mz[i] = bz[i] + dispZ[i];
  }
  // A fully shared divider is generated once: only by the border with the lower index
  const skip = new Uint8Array(N);
  for (let i = 0; i < N; i++) skip[i] = weight[i] > 0.99 && partner[i] >= 0 && partner[i] < i ? 1 : 0;

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
  const simplified = runs.map(({ pts, shared }) => {
    const last = pts[pts.length - 1];
    const closed = pts.length >= n && norm(pts[0][0] - last[0], pts[0][1] - last[1]) < 0.2;
    return { pts: removeLoops(rdp(pts, SIMPLIFY_TOL), closed), shared, closed };
  });
  // longest first; ends already drawn by a longer divider are trimmed, fragments dropped (order of runs kept)
  const order = simplified.map((_, k) => k).sort((p, q) => polylineLength(simplified[q].pts, simplified[q].closed) - polylineLength(simplified[p].pts, simplified[p].closed));
  const kept = new Map<number, { pts: Point2[]; shared: boolean; closed: boolean }>();
  for (const k of order) {
    let { pts } = simplified[k];
    const { shared, closed } = simplified[k];
    const others = [...kept.values()].map((o) => o.pts);
    if (!closed) pts = trimCovered(pts, others);
    if (pts.length < 2 || polylineLength(pts, closed) < MIN_DIVIDER) continue;
    kept.set(k, { pts, shared, closed });
  }
  const out: Divider[] = [...kept.entries()]
    .sort((p, q) => p[0] - q[0])
    .map(([, { pts, shared, closed }]) => ({ shared, closed, points: pts.map(([px, pz]) => [r3(px), r3(pz)] as Point2) }));
  return { dividers: out, runs: runs.map((r) => r.pts), mergedX: mx, mergedZ: mz, weight, borderX: bx, borderZ: bz };
}

export function polylineLength(pts: Point2[], closed = false): number {
  let L = 0;
  for (let k = 1; k < pts.length; k++) L += norm(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
  if (closed && pts.length > 2) L += norm(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]);
  return L;
}

/** Where segments p1-p2 and p3-p4 cross (strictly inside both), else null. */
function crossing(p1: Point2, p2: Point2, p3: Point2, p4: Point2): Point2 | null {
  const d1x = p2[0] - p1[0], d1z = p2[1] - p1[1], d2x = p4[0] - p3[0], d2z = p4[1] - p3[1];
  const den = d1x * d2z - d1z * d2x;
  if (Math.abs(den) < 1e-12) return null;
  const wx = p3[0] - p1[0], wz = p3[1] - p1[1];
  const ta = (wx * d2z - wz * d2x) / den, tb = (wx * d1z - wz * d1x) / den;
  if (ta > 1e-9 && ta < 1 - 1e-9 && tb > 1e-9 && tb < 1 - 1e-9) return [p1[0] + d1x * ta, p1[1] + d1z * ta];
  return null;
}

/**
 * Cut out self-crossings. A closed divider keeps the longer of its two parts. An open one is split at the crossing into
 * head, loop and tail, and loses the shortest: a small kink loses its loop, an end poking past a junction loses that
 * stub, and the rest of the pipe stays.
 */
export function removeLoops(input: Point2[], closed: boolean): Point2[] {
  let pts = input.slice();
  for (let iter = 0; iter < 100; iter++) {
    const n = pts.length, segs = closed ? n : n - 1;
    let hit: [number, number, Point2] | null = null;
    outer: for (let a = 0; a < segs; a++) {
      for (let b = a + 2; b < segs; b++) {
        if (closed && a === 0 && b === segs - 1) continue;
        const X = crossing(pts[a], pts[(a + 1) % n], pts[b], pts[(b + 1) % n]);
        if (X) {
          hit = [a, b, X];
          break outer;
        }
      }
    }
    if (!hit) break;
    const [a, b, X] = hit;
    const head = [...pts.slice(0, a + 1), X], loop = [X, ...pts.slice(a + 1, b + 1), X], tail = [X, ...pts.slice(b + 1)];
    if (closed) {
      const rest = [...pts.slice(0, a + 1), X, ...pts.slice(b + 1)];
      pts = polylineLength(loop) > polylineLength(rest, true) ? loop.slice(0, -1) : rest;
      continue;
    }
    const lh = polylineLength(head), ll = polylineLength(loop), lt = polylineLength(tail);
    if (ll <= lh && ll <= lt) pts = [...head, ...tail.slice(1)];
    else if (lh <= lt) pts = [...loop, ...tail.slice(1)];
    else pts = [...head, ...loop.slice(1)];
  }
  return tidyEnds(pts, closed);
}

/** Drop repeated points, and short end segments that double back (> 120°) at a junction. */
export function tidyEnds(pts: Point2[], closed: boolean): Point2[] {
  let out: Point2[] = [pts[0]];
  for (const p of pts.slice(1)) {
    const q = out[out.length - 1];
    if (norm(p[0] - q[0], p[1] - q[1]) > 1e-6) out.push(p);
  }
  if (closed) return out;
  const cos120 = Math.cos(radians(120));
  const doublesBack = (a: Point2, b: Point2, c: Point2) => {
    const ux = b[0] - a[0], uz = b[1] - a[1], vx = c[0] - b[0], vz = c[1] - b[1];
    const lu = norm(ux, uz), lv = norm(vx, vz);
    return lv < MIN_DIVIDER && lu > 1e-9 && (ux * vx + uz * vz) / (lu * lv) < cos120;
  };
  while (out.length >= 3 && doublesBack(out[out.length - 3], out[out.length - 2], out[out.length - 1])) out = out.slice(0, -1);
  while (out.length >= 3 && doublesBack(out[2], out[1], out[0])) out = out.slice(1);
  return out;
}

function distToPolyline(p: Point2, line: Point2[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const q = nearestOnSegment(p[0], p[1], line[i][0], line[i][1], line[i + 1][0], line[i + 1][1]);
    best = Math.min(best, norm(p[0] - q[0], p[1] - q[1]));
  }
  return best;
}

/**
 * Drop end vertices of an open divider while the next one in also lies on another divider (within COVERED): that
 * stretch is drawn already; the end left over touches the other pipe.
 */
export function trimCovered(input: Point2[], others: Point2[][]): Point2[] {
  const covered = (p: Point2) => others.some((o) => distToPolyline(p, o) <= COVERED);
  let pts = input;
  while (pts.length > 2 && covered(pts[0]) && covered(pts[1])) pts = pts.slice(1);
  while (pts.length > 2 && covered(pts[pts.length - 1]) && covered(pts[pts.length - 2])) pts = pts.slice(0, -1);
  if (pts.length === 2 && covered(pts[0]) && covered(pts[1])) return [];
  return pts;
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

/**
 * Raster of the area covered by lanes (plus pipe thickness `extra`): discs along the racing line, plus the outer half of
 * every square corner out to its mitre.
 */
export function laneMask(
  line: Line,
  corners: Corner[],
  points: DesignPoint[],
  cell = FOOT_CELL,
  frameOf?: { origin: Point2; rows: number; cols: number },
  extra = PIPE_R,
): Raster {
  const { n, x, z } = line;
  const hw = new Float64Array(n);
  for (let i = 0; i < n; i++) hw[i] = line.width[i] / 2 + extra;
  const polys = squareCornerPolygons(line, corners, points, extra);
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
    for (const poly of polys) {
      for (const [px, pz] of poly) {
        origin = [Math.min(origin[0], px - cell), Math.min(origin[1], pz - cell)];
        hi[0] = Math.max(hi[0], px + cell); hi[1] = Math.max(hi[1], pz + cell);
      }
    }
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
  for (const poly of polys) {
    let lox = Infinity, loz = Infinity, hix = -Infinity, hiz = -Infinity;
    for (const [px, pz] of poly) {
      lox = Math.min(lox, px); hix = Math.max(hix, px);
      loz = Math.min(loz, pz); hiz = Math.max(hiz, pz);
    }
    const c0 = Math.max(Math.trunc((lox - origin[0]) / cell), 0), c1 = Math.min(Math.trunc((hix - origin[0]) / cell) + 1, cols);
    const r0 = Math.max(Math.trunc((loz - origin[1]) / cell), 0), r1 = Math.min(Math.trunc((hiz - origin[1]) / cell) + 1, rows);
    for (let row = r0; row < r1; row++) {
      const cz = origin[1] + (row + 0.5) * cell;
      for (let col = c0; col < c1; col++) {
        const cx = origin[0] + (col + 0.5) * cell;
        if (insidePolygon(cx, cz, poly)) mask[row * cols + col] = 1;
      }
    }
  }
  return { rows, cols, origin, mask };
}

/** Even-odd point-in-polygon (same expression as bake.py's inside_polygon). */
export function insidePolygon(px: number, pz: number, poly: Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
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
export interface BakeOptions {
  /** override CORNER_JOIN_GAP (m), e.g. to try a different corner rule */
  cornerJoinGap?: number;
}

/** Where the rostrum stands: ROSTRUM_SETBACK outside the middle of a side, moved `offset` metres along it. */
export function rostrumPosition(area: { length: number; width: number }, side: Side = "south", offset = 0): Point2 {
  const L = area.length, Wd = area.width;
  const pos: Record<Side, Point2> = {
    north: [offset, Wd / 2 + ROSTRUM_SETBACK],
    south: [offset, -Wd / 2 - ROSTRUM_SETBACK],
    east: [L / 2 + ROSTRUM_SETBACK, offset],
    west: [-L / 2 - ROSTRUM_SETBACK, offset],
  };
  return pos[side];
}

export function bakeBuilt(doc: RcTrack, opts: BakeOptions = {}): Built {
  const design = doc.design, area = doc.area;
  const W0 = design.laneWidth ?? 2.0;
  const { line, corners } = racingLine(design.points, W0);
  const { x, z } = line;
  const { s, total } = arclength(x, z);
  const divs = dividers(line, corners, design.points).dividers;
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
  const pos = rostrumPosition(area, side, off);
  const rostrum = { side, x: r3(pos[0]), z: r3(pos[1]), eyeHeight: EYE_HEIGHT };

  // checks: area, radius, width — on the lane edges
  const edges = borders(line, corners, design.points);
  const sides: [Float64Array, Float64Array][] = [
    [edges.rx, edges.rz],
    [edges.lx, edges.lz],
  ];
  outer: for (const [ex, ez] of sides) {
    for (let i = 0; i < line.n; i++) {
      if (Math.abs(ex[i]) > L / 2 + 0.01 || Math.abs(ez[i]) > Wd / 2 + 0.01) {
        checks.push({ level: "error", code: "outside-area", x: r3(ex[i]), z: r3(ez[i]), message: "Track goes outside the venue's track area" });
        break outer;
      }
    }
  }
  // real size of the track: lane edges (no pipe padding; the footprint keeps that for fit checks)
  let exMin = Infinity, ezMin = Infinity, exMax = -Infinity, ezMax = -Infinity;
  for (const [ex, ez] of sides) {
    for (let i = 0; i < line.n; i++) {
      exMin = Math.min(exMin, ex[i]); exMax = Math.max(exMax, ex[i]);
      ezMin = Math.min(ezMin, ez[i]); ezMax = Math.max(ezMax, ez[i]);
    }
  }
  const size: Size = { length: r3(exMax - exMin), width: r3(ezMax - ezMin), bbox: [r3(exMin), r3(ezMin), r3(exMax), r3(ezMax)] };

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
  const fp = laneMask(line, corners, design.points);
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
    size,
    stats: { dividerLength: r3(pipe), dividerRuns: divs.length, corners: countCorners(corners, opts.cornerJoinGap) },
  };
}

/** Returns a copy of the track with a fresh `built` section. Does not modify `doc`. */
export function bake(doc: RcTrack, opts: BakeOptions = {}): RcTrack {
  return { ...doc, built: bakeBuilt(doc, opts) };
}
