// Quick mode step 2, "Shape it": move corners anywhere, cut each one back by its apex radius (the inside edge the car
// clips), add and delete corners. Writes only x, z and radius on points. Pure (no DOM).
import type { Area, Corner, DesignPoint, Point2 } from "@track-studio/engine";
import { clampToArea, insertionFor, tooClose } from "./geometry.js";
import { laneGrid } from "./lanes.js";

/** largest apex radius the handle and the field allow */
export const APEX_MAX = 9; // m
/** a dragged corner snaps to a lane line this close to it */
export const LANE_SNAP = 0.2; // m
/** with nothing selected, a tap this many lane widths from the racing line goes into that part of the track */
export const NEAR_TRACK = 1.5;
/** a corner turning less than this has no apex to cut back */
export const MIN_TURN = 1e-3; // rad
/** the engine raises radius-reduced when the radius it could fit is more than this below the one asked for (#37) */
export const REDUCED = 0.01; // m

export const QUICK_SIZES = [
  { label: "Hairpin", apex: 0 },
  { label: "Tight", apex: 0.6 },
  { label: "Medium", apex: 1.8 },
  { label: "Sweeper", apex: 4.0 },
] as const;

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const widthAt = (p: DesignPoint, laneWidth: number) => p.width ?? laneWidth;

// ---------------------------------------------------------------------------------------------- the apex
/** A corner's shape for its apex handle: the point, the unit inside bisector, the turn (rad), its lane width. */
export interface Apex {
  P: Point2;
  b: Point2;
  th: number;
  w: number;
}

/** The corner at point i, or null where the line runs straight through it. */
export function apexOf(points: DesignPoint[], i: number, laneWidth: number): Apex | null {
  const n = points.length;
  const p = points[i], prev = points[(i - 1 + n) % n], next = points[(i + 1) % n];
  const a = unit([p.x - prev.x, p.z - prev.z]), c = unit([next.x - p.x, next.z - p.z]);
  if (!a || !c) return null;
  const th = Math.acos(clamp(a[0] * c[0] + a[1] * c[1], -1, 1));
  // the inside of the turn is where the direction is turning to; past ~180° there's no sensible inside
  const b = unit([c[0] - a[0], c[1] - a[1]]);
  if (th < MIN_TURN || th > Math.PI - MIN_TURN || !b) return null;
  return { P: [p.x, p.z], b, th, w: widthAt(p, laneWidth) };
}

/** How far the middle of the inside edge is from the corner point, along the inside bisector, for radius r. */
export const handleDistance = (r: number, th: number, w: number) => r / Math.cos(th / 2) - r + w / 2;

/** The apex handle: the middle of the corner's inside edge, P + b · (r / cos(θ/2) − r + w/2). */
export function handlePoint(a: Apex, r: number): Point2 {
  const d = handleDistance(r, a.th, a.w);
  return [a.P[0] + a.b[0] * d, a.P[1] + a.b[1] * d];
}

/** Distance from the corner point along the inside bisector to where the pointer is. */
export const alongBisector = (a: Apex, q: Point2) => (q[0] - a.P[0]) * a.b[0] + (q[1] - a.P[1]) * a.b[1];

/** The radius for the handle dragged to distance d: r = (d − w/2) / (1/cos(θ/2) − 1), apex r − w/2 kept in 0…APEX_MAX. */
export function radiusFromDrag(d: number, th: number, w: number): number {
  const r = (d - w / 2) / (1 / Math.cos(th / 2) - 1);
  return radiusForApex(Number.isFinite(r) ? r - w / 2 : APEX_MAX, w);
}

/** r = apex + w/2, the apex kept in 0…APEX_MAX (to the centimetre). */
export const radiusForApex = (apex: number, w: number) => r3(Math.round(clamp(apex, 0, APEX_MAX) * 100) / 100 + w / 2);

/** The apex radius a point asks for (never below 0: a radius under w/2 still clips the corner point's apex). */
export const apexRadius = (p: DesignPoint, laneWidth: number) => Math.max(0, r3((p.radius ?? 1) - widthAt(p, laneWidth) / 2));

/** Set corner i's apex radius: only its radius changes. */
export function setApex(points: DesignPoint[], i: number, apex: number, laneWidth: number): DesignPoint[] {
  return points.map((p, k) => (k === i ? { ...p, radius: radiusForApex(apex, widthAt(p, laneWidth)) } : p));
}

/** Did the engine have to cut the radius down to fit the straights? (the radius-reduced rule, rctrack 1.5) */
export const isReduced = (p: DesignPoint, c: Pick<Corner, "r" | "th">) => c.th > MIN_TURN && Math.abs(c.r - (p.radius ?? 1)) > REDUCED;

/** "90° left": the turn in whole degrees and which way (counter-clockwise on the plan is left). */
export function turnLabel(points: DesignPoint[], i: number): string {
  const n = points.length;
  const p = points[i], prev = points[(i - 1 + n) % n], next = points[(i + 1) % n];
  const ax = p.x - prev.x, az = p.z - prev.z, bx = next.x - p.x, bz = next.z - p.z;
  const deg = Math.round((Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz)) * 180) / Math.PI);
  if (deg === 0) return "straight on";
  return `${deg}° ${ax * bz - az * bx > 0 ? "left" : "right"}`;
}

// ---------------------------------------------------------------------------------------------- moving
/** The lane lines: through the centres of step 1's lane-width squares, from the area's south-west corner. */
export function laneLines(area: Area, laneWidth: number): { x: number[]; z: number[] } {
  const g = laneGrid(area, [], laneWidth);
  const at = (o: number, k: number) => r3(o + (k + 0.5) * g.size);
  return { x: Array.from({ length: g.cols }, (_, k) => at(g.origin[0], k)), z: Array.from({ length: g.rows }, (_, k) => at(g.origin[1], k)) };
}

/** Where a corner goes: inside the area, and on a lane line in x and/or z when that's within LANE_SNAP (unless free). */
export function placeCorner(raw: Point2, area: Area, laneWidth: number, free: boolean): { p: Point2; snapped: boolean } {
  let [x, z] = clampToArea(raw, area, 0);
  let snapped = false;
  if (!free) {
    const lines = laneLines(area, laneWidth);
    const near = (v: number, ls: number[]) => ls.find((l) => Math.abs(l - v) <= LANE_SNAP);
    const sx = near(x, lines.x), sz = near(z, lines.z);
    if (sx !== undefined) [x, snapped] = [sx, true];
    if (sz !== undefined) [z, snapped] = [sz, true];
  }
  return { p: [r3(x), r3(z)], snapped };
}

// ---------------------------------------------------------------------------------------------- adding and deleting
/** A new corner: x and z, with an apex radius of 0 like the corners step 1 lays. */
const newCorner = (at: Point2, laneWidth: number): DesignPoint => ({ x: at[0], z: at[1], radius: r3(laneWidth / 2) });

/** Add a corner straight after corner i; null if it would sit on top of a neighbour. */
export function insertAfter(points: DesignPoint[], i: number, at: Point2, laneWidth: number): { points: DesignPoint[]; index: number } | null {
  const n = points.length;
  const a = points[i], b = points[(i + 1) % n];
  if (tooClose(at, [a.x, a.z], [b.x, b.z])) return null;
  return { points: [...points.slice(0, i + 1), newCorner(at, laneWidth), ...points.slice(i + 1)], index: i + 1 };
}

/**
 * A tap with nothing selected: within NEAR_TRACK lane widths of the racing line it goes into that part of the track
 * (after the start of the nearest straight between corner points); further away, null.
 */
export function insertNearTrack(points: DesignPoint[], at: Point2, distToLine: number, laneWidth: number): { points: DesignPoint[]; index: number } | null {
  if (distToLine > NEAR_TRACK * laneWidth) return null;
  return insertAfter(points, insertionFor(points, at).after, at, laneWidth);
}

/** fewest corners a loop keeps */
export const MIN_CORNERS = 3;

/** Delete corner i, so its neighbours' straights join; null if the loop would drop below MIN_CORNERS. */
export const deleteCorner = (points: DesignPoint[], i: number): DesignPoint[] | null => (points.length <= MIN_CORNERS ? null : points.filter((_, k) => k !== i));

// ---------------------------------------------------------------------------------------------- helpers
function unit(v: Point2): Point2 | null {
  const l = Math.hypot(v[0], v[1]);
  return l > 1e-9 ? [v[0] / l, v[1] / l] : null;
}
