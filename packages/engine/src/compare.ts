// Compare two `built` sections geometrically (used by the reference-port tests and the CLI).
import { unrle } from "./bake.js";
import type { Built, Point2 } from "./types.js";

export interface BuiltDiff {
  lapLength: number;
  racingLineCount: [number, number];
  /** max distance between corresponding racing-line points (Infinity if the counts differ) */
  racingLineMax: number;
  racingWidthMax: number;
  dividerCount: [number, number];
  /** per matched run: max distance from either polyline to the other, point counts, flags equal */
  dividers: { maxDist: number; points: [number, number]; sameFlags: boolean }[];
  checks: [string[], string[]];
  features: { maxPos: number; maxHeading: number; otherSame: boolean };
  startLine: { pos: number; heading: number; width: number };
  rostrum: number;
  stats: { dividerLength: number; dividerRuns: [number, number]; corners: [number, number] };
  footprint: { bboxMax: number; shape: [number, number, number, number]; cellsDiffer: number | null };
}

const dist = (a: Point2, b: Point2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function pointToSegment(p: Point2, a: Point2, b: Point2): number {
  const abx = b[0] - a[0], abz = b[1] - a[1];
  const L2 = abx * abx + abz * abz;
  if (L2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * abz) / L2));
  return dist(p, [a[0] + abx * t, a[1] + abz * t]);
}

/** Max over points of `pts` of the distance to the polyline `line`. */
function directedDistance(pts: Point2[], line: Point2[], closed: boolean): number {
  const segs = closed ? line.length : line.length - 1;
  let worst = 0;
  for (const p of pts) {
    let best = line.length === 1 ? dist(p, line[0]) : Infinity;
    for (let k = 0; k < segs; k++) best = Math.min(best, pointToSegment(p, line[k], line[(k + 1) % line.length]));
    worst = Math.max(worst, best);
  }
  return worst;
}

/** Distance from a point to an open polyline. */
export function distanceToPolyline(p: Point2, line: Point2[]): number {
  return directedDistance([p], line, false);
}

/** Symmetric max distance between two polylines (Hausdorff over vertices vs segments). */
export function polylineDistance(a: Point2[], b: Point2[], closed = false): number {
  return Math.max(directedDistance(a, b, closed), directedDistance(b, a, closed));
}

const angleDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

export function compareBuilt(actual: Built, expected: Built): BuiltDiff {
  const ra = actual.racingLine, re = expected.racingLine;
  let racingLineMax = ra.length === re.length ? 0 : Infinity;
  let racingWidthMax = 0;
  if (ra.length === re.length) {
    ra.forEach((p, i) => {
      racingLineMax = Math.max(racingLineMax, dist([p[0], p[1]], [re[i][0], re[i][1]]));
      racingWidthMax = Math.max(racingWidthMax, Math.abs(p[2] - re[i][2]));
    });
  }
  const dividers = actual.dividers.slice(0, expected.dividers.length).map((d, i) => {
    const e = expected.dividers[i];
    return {
      maxDist: polylineDistance(d.points, e.points, d.closed && e.closed),
      points: [d.points.length, e.points.length] as [number, number],
      sameFlags: d.shared === e.shared && d.closed === e.closed,
    };
  });
  let maxPos = actual.features.length === expected.features.length ? 0 : Infinity;
  let maxHeading = 0;
  let otherSame = actual.features.length === expected.features.length;
  actual.features.forEach((f, i) => {
    const e = expected.features[i];
    if (!e) return;
    maxPos = Math.max(maxPos, dist([f.x, f.z], [e.x, e.z]));
    maxHeading = Math.max(maxHeading, angleDiff(f.heading, e.heading));
    otherSame &&= f.type === e.type && f.length === e.length && f.height === e.height && Math.abs(f.width - e.width) < 0.011 && JSON.stringify(f.profile) === JSON.stringify(e.profile);
  });
  const fa = actual.footprint, fe = expected.footprint;
  const sameShape = fa.rows === fe.rows && fa.cols === fe.cols && fa.origin[0] === fe.origin[0] && fa.origin[1] === fe.origin[1];
  let cellsDiffer: number | null = null;
  if (sameShape) {
    const ma = unrle(fa.rle, fa.rows * fa.cols), me = unrle(fe.rle, fe.rows * fe.cols);
    cellsDiffer = 0;
    for (let k = 0; k < ma.length; k++) if (ma[k] !== me[k]) cellsDiffer++;
  }
  return {
    lapLength: Math.abs(actual.lapLength - expected.lapLength),
    racingLineCount: [ra.length, re.length],
    racingLineMax,
    racingWidthMax,
    dividerCount: [actual.dividers.length, expected.dividers.length],
    dividers,
    checks: [actual.checks.map((c) => c.code), expected.checks.map((c) => c.code)],
    features: { maxPos, maxHeading, otherSame },
    startLine: {
      pos: dist([actual.startLine.x, actual.startLine.z], [expected.startLine.x, expected.startLine.z]),
      heading: angleDiff(actual.startLine.heading, expected.startLine.heading),
      width: Math.abs(actual.startLine.width - expected.startLine.width),
    },
    rostrum: dist([actual.rostrum.x, actual.rostrum.z], [expected.rostrum.x, expected.rostrum.z]),
    stats: {
      dividerLength: Math.abs(actual.stats.dividerLength - expected.stats.dividerLength),
      dividerRuns: [actual.stats.dividerRuns, expected.stats.dividerRuns],
      corners: [actual.stats.corners, expected.stats.corners],
    },
    footprint: {
      bboxMax: Math.max(...fa.bbox.map((v, i) => Math.abs(v - fe.bbox[i]))),
      shape: [fa.rows, fa.cols, fe.rows, fe.cols],
      cellsDiffer,
    },
  };
}
