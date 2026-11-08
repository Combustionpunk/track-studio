// Nested corners (#106): where two lanes run either side of one pipe round a corner, the two corner points turn round
// the same centre, one lane apart. Shaping the outer corner shapes the inner one with it, so the shared pipe stays one
// curve: the inner lane's outside edge is the outer lane's inside edge. The link is read from the geometry alone and is
// never stored; it applies when a corner is shaped, in Quick and Advanced alike. Pure (no DOM).
import type { DesignPoint } from "@track-studio/engine";
import { MERGE_GAP, SQUARE_MAX_TURN } from "@track-studio/engine";
import { apexOf, widthAt } from "./shape.js";

/** Two corners round one shared pipe: `inner` sits `d` metres (lane centre to lane centre) inside `outer`. */
export interface Nest {
  outer: number;
  inner: number;
  d: number;
}

/** two corners turning within this of each other, with their bisectors within this, turn round one centre */
const ANGLE_TOL = 0.01; // rad
/** the inner corner point may sit this far off the outer corner's inside bisector */
const ALIGN_TOL = 0.05; // m
/** lanes may overlap by this and still be two lanes sharing a pipe (the bake's own allowance is of that order) */
const OVERLAP_PLAY = 0.05; // m

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Every pair of corners whose pipes are shared: the same turn, the same inside bisector, the inner corner point on the
 * outer's bisector one lane spacing in (their straights `d` apart, with the lanes' edges touching or closer than the gap
 * the bake merges pipes across). A lane two lanes away is further than that, so three stacked lanes are two nests.
 */
export function findNests(points: DesignPoint[], laneWidth: number): Nest[] {
  const apex = points.map((_, i) => apexOf(points, i, laneWidth));
  const out: Nest[] = [];
  for (let i = 0; i < points.length; i++) {
    const o = apex[i];
    if (!o) continue;
    for (let j = 0; j < points.length; j++) {
      const n = apex[j];
      if (j === i || !n) continue;
      if (Math.abs(o.th - n.th) > ANGLE_TOL) continue;
      if (Math.acos(Math.min(1, Math.max(-1, o.b[0] * n.b[0] + o.b[1] * n.b[1]))) > ANGLE_TOL) continue;
      const dx = n.P[0] - o.P[0], dz = n.P[1] - o.P[1];
      const along = dx * o.b[0] + dz * o.b[1];
      if (along <= 0) continue; // j is outside i, not inside: the pair is found from j
      const perp = Math.hypot(dx - o.b[0] * along, dz - o.b[1] * along);
      if (perp > ALIGN_TOL) continue;
      const d = along * Math.cos(o.th / 2); // the straights' spacing, centre line to centre line
      const gap = d - (o.w + n.w) / 2; // between the lanes' edges: a pipe's worth, or a little play
      if (gap < -OVERLAP_PLAY || gap >= MERGE_GAP) continue;
      out.push({ outer: i, inner: j, d: r3(d) });
      break;
    }
  }
  return out;
}

/** the corner nested inside corner i, if any */
export const innerOf = (nests: Nest[], i: number): number | null => nests.find((n) => n.outer === i)?.inner ?? null;

/** the corner nested outside corner i, if any */
export const outerOf = (nests: Nest[], i: number): number | null => nests.find((n) => n.inner === i)?.outer ?? null;

/** the corners linked to corner i, to highlight while it's edited: the one inside it and the one outside it */
export const linkedTo = (nests: Nest[], i: number): number[] => [innerOf(nests, i), outerOf(nests, i)].filter((k): k is number => k !== null);

const resolveOuter = (outer: DesignPoint["outer"], th: number): "square" | "round" => (outer === "square" || outer === "round" ? outer : th <= SQUARE_MAX_TURN ? "square" : "round");

/**
 * What the inner corner should be for the shared pipe to be one curve: the same centre as the outer corner's arc, so
 * r_in = r_out − d, and a round outside, which then runs along the outer lane's inside edge. The inner corner can't go
 * below a hairpin (apex 0, r = w/2): clamped there, its outside is whichever of auto (a mitre) and round sits nearer the
 * outer lane's inside edge at the apex. A hairpin inside a hairpin fits exactly with its mitre, as step 1 lays it.
 */
export function followValue(points: DesignPoint[], nest: Nest, laneWidth: number): { radius: number; outer: "round" | undefined } {
  const o = points[nest.outer], p = points[nest.inner];
  const wo = widthAt(o, laneWidth), wi = widthAt(p, laneWidth);
  const ro = o.radius ?? 1;
  const exact = r3(ro - nest.d);
  if (exact >= wi / 2) return { radius: exact, outer: "round" };
  const th = apexOf(points, nest.inner, laneWidth)?.th ?? Math.PI / 2;
  const cos = Math.cos(th / 2);
  // distances along the shared inside bisector from the outer corner point
  const edge = ro >= wo / 2 ? ro / cos - (ro - wo / 2) : wo / 2 / cos; // the outer lane's inside edge (or its collapsed apex)
  const round = (nest.d + wi / 2) / cos - wi; // the inner lane's round outside edge at a hairpin
  const mitre = (nest.d - wi / 2) / cos; // its mitre
  const auto = th <= SQUARE_MAX_TURN ? mitre : round;
  return { radius: r3(wi / 2), outer: Math.abs(auto - edge) <= Math.abs(round - edge) ? undefined : "round" };
}

/** Does the inner corner follow the outer one now? (its radius and its outside, as the outside resolves) */
export function follows(points: DesignPoint[], nest: Nest, laneWidth: number): boolean {
  const want = followValue(points, nest, laneWidth);
  const p = points[nest.inner];
  const th = apexOf(points, nest.inner, laneWidth)?.th ?? Math.PI / 2;
  return Math.abs((p.radius ?? 1) - want.radius) <= 0.005 && resolveOuter(p.outer, th) === resolveOuter(want.outer, th);
}

function applyFollow(points: DesignPoint[], nest: Nest, laneWidth: number): DesignPoint[] {
  const want = followValue(points, nest, laneWidth);
  return points.map((p, k) => {
    if (k !== nest.inner) return p;
    const { outer: _o, ...rest } = p;
    return want.outer ? { ...rest, radius: want.radius, outer: want.outer } : { ...rest, radius: want.radius };
  });
}

/**
 * After corner i's radius changed: the corner inside it follows, then the one inside that, and so on. Returns the same
 * array when nothing is nested inside i.
 */
export function followNest(points: DesignPoint[], i: number, laneWidth: number): DesignPoint[] {
  const nests = findNests(points, laneWidth);
  let pts = points;
  const seen = new Set([i]);
  for (let cur = i; ; ) {
    const nest = nests.find((n) => n.outer === cur);
    if (!nest || seen.has(nest.inner)) return pts;
    pts = applyFollow(pts, nest, laneWidth);
    seen.add(nest.inner);
    cur = nest.inner;
  }
}

/** "Match corner N": re-link corner j to the one outside it, and the corners inside j to it. Unchanged when j has no outer. */
export function matchNest(points: DesignPoint[], j: number, laneWidth: number): DesignPoint[] {
  const nest = findNests(points, laneWidth).find((n) => n.inner === j);
  if (!nest) return points;
  return followNest(applyFollow(points, nest, laneWidth), j, laneWidth);
}
