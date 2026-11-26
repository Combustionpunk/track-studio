// One corner numbering for everything that names a corner (#176): the designer's dots, titles and panels, the build
// sheet, its marshal-point wording and the Corners figure. Design points are grouped into corners the way countCorners
// (bake.ts) counts them (built.stats.corners): every turn of more than CORNER_MIN_TURN is a corner point, and turns the
// same way joined by less than CORNER_JOIN_GAP of racing line (a hairpin drawn as two points) make one corner, whose
// points are lettered: 5a, 5b. A point that turns CORNER_MIN_TURN or less isn't a corner: it has no number and no
// name of its own, only the designer's plain word for a point.
import { CORNER_JOIN_GAP, CORNER_MIN_TURN, racingLine, type Corner } from "./bake.js";
import type { DesignPoint } from "./types.js";

export interface CornerNumbering {
  /** per design point: "5", or "5a", "5b" for the points of one joined corner; null for a point that isn't a corner */
  labels: (string | null)[];
  /** per design point: its corner's number (1-based), or null */
  numbers: (number | null)[];
  /** the corners in numbering order, each its design point indices in lap order */
  groups: number[][];
}

/** Corner numbering from the racing line's corners (racingLine(points).corners, one per design point). */
export function numberCorners(corners: Corner[]): CornerNumbering {
  const n = corners.length;
  const labels: (string | null)[] = Array(n).fill(null);
  const numbers: (number | null)[] = Array(n).fill(null);
  const sig = corners.flatMap((c, i) => (c.th > CORNER_MIN_TURN ? [i] : []));
  if (!sig.length) return { labels, numbers, groups: [] };
  const straight = corners.map((c, i) => {
    const next = corners[(i + 1) % n].start;
    return Math.hypot(next[0] - c.end[0], next[1] - c.end[1]);
  });
  const arc = corners.map((c) => c.r * c.th);
  // joined[k]: sig[k] and the next significant point make one corner
  const joined = sig.map((i, k) => {
    if (sig.length < 2) return false;
    const j = sig[(k + 1) % sig.length];
    let gap = straight[i];
    for (let m = (i + 1) % n; m !== j; m = (m + 1) % n) gap += arc[m] + straight[m];
    return corners[i].sign === corners[j].sign && gap < CORNER_JOIN_GAP;
  });

  // groups of consecutive joined points; start at the first point that isn't joined from the one before it
  const groups: number[][] = [];
  const first = joined.findIndex((_, k) => !joined[(k - 1 + sig.length) % sig.length]);
  if (first < 0) groups.push([...sig]); // one continuous turn
  else
    for (let s = 0; s < sig.length; s++) {
      const k = (first + s) % sig.length;
      if (s === 0 || !joined[(k - 1 + sig.length) % sig.length]) groups.push([]);
      groups[groups.length - 1].push(sig[k]);
    }
  // corner 1 is the first that starts at or after design point 0 (a corner wrapping round point 0 comes last)
  groups.sort((a, c) => a[0] - c[0]);
  const wraps = groups.findIndex((g) => g.some((i, k) => k > 0 && i < g[k - 1]));
  if (wraps >= 0) groups.push(...groups.splice(wraps, 1));

  groups.forEach((g, gi) =>
    g.forEach((i, k) => {
      numbers[i] = gi + 1;
      labels[i] = g.length > 1 ? `${gi + 1}${String.fromCharCode(97 + (k % 26))}` : String(gi + 1);
    }),
  );
  return { labels, numbers, groups };
}

/** Corner numbering of a design's points (fewer than 3 points: none are corners). */
export function cornerNumbering(points: DesignPoint[], laneWidth = 2.0): CornerNumbering {
  if (points.length < 3) return { labels: points.map(() => null), numbers: points.map(() => null), groups: [] };
  return numberCorners(racingLine(points, laneWidth).corners);
}

/**
 * A design point's name in a sentence, lower case: "corner 5a" (noun "corner point": "corner point 5a"). A point that
 * isn't a corner has no name: it is just "point".
 */
export function pointName(numbering: CornerNumbering, i: number, noun = "corner"): string {
  const label = numbering.labels[i];
  return label !== null && label !== undefined ? `${noun} ${label}` : "point";
}
