// The build sheet: the figures marshals lay a track out from (#17). Positions are measured from the south-west corner
// of the drawing area (drawingArea; "x m from the west wall, y m from the south wall"), not from the centre origin the format uses.
//
// Everything comes from `built` except the corner points, which `built` doesn't list: they are the design points the
// engine's own corner maths treats as corners (racingLine + the CORNER_* rules that make built.stats.corners), so the
// numbering always agrees with stats.corners. Tests check each corner's arc lies on built.racingLine.
import { CORNER_JOIN_GAP, CORNER_MIN_TURN, drawingArea, racingLine } from "./bake.js";
import type { Area, FeatureType, Point2, RcTrack } from "./types.js";

/** Distances from the west wall (x) and the south wall (z) of the track area, metres. */
export interface FromSouthWest {
  fromWest: number;
  fromSouth: number;
}

export interface SheetCornerPoint extends FromSouthWest {
  /** corner number as racers count them (1 = the first corner starting at or after design point 0) */
  number: number;
  /** "3", or "3a", "3b" for the points of one joined corner (a hairpin drawn as two points) */
  label: string;
  /** design point index */
  index: number;
  /** plan position (centre-origin axes) */
  x: number;
  z: number;
  turn: "left" | "right";
  /** turn at this point, degrees */
  angle: number;
  /** the whole corner turns 150° or more */
  hairpin: boolean;
  /** where this point's arc meets the straights (on the racing line) */
  arcStart: Point2;
  arcEnd: Point2;
}

export interface SheetJump extends FromSouthWest {
  type: FeatureType;
  x: number;
  z: number;
  length: number;
  height: number;
}

/** A crossover (v1.6), as the sheet lists it. */
export interface SheetCrossover extends FromSouthWest {
  /** 1, 2, … in driving order from the start line */
  number: number;
  /** index into design.features / built.features */
  feature: number;
  x: number;
  z: number;
  /** the pass that goes over, in driving order from the start line; null when it bridges no crossing */
  over: "first" | "second" | null;
  length: number;
  /** each ramp, along the over pass */
  ramp: number;
  /** the flat top */
  top: number;
  height: number;
}

export type Compass = "east" | "north-east" | "north" | "north-west" | "west" | "south-west" | "south" | "south-east";

export interface BuildSheet {
  area: Area;
  lapLength: number;
  /** built.stats.corners */
  corners: number;
  cornerPoints: SheetCornerPoint[];
  /** real size from the lane edges; null for tracks baked before v1.2 */
  size: { length: number; width: number } | null;
  laneWidth: { min: number; max: number };
  pipe: { length: number; runs: number };
  jumps: SheetJump[];
  crossovers: SheetCrossover[];
  start: FromSouthWest & { x: number; z: number; heading: Compass };
  direction: "clockwise" | "anticlockwise";
}

const HAIRPIN = (150 * Math.PI) / 180;
const COMPASS: Compass[] = ["east", "north-east", "north", "north-west", "west", "south-west", "south", "south-east"];

export function fromSouthWest(area: Area, x: number, z: number): FromSouthWest {
  const r = (v: number) => Math.round(v * 1e6) / 1e6; // no float dust: 4.964, not 4.9639999
  return { fromWest: r(x + area.length / 2), fromSouth: r(z + area.width / 2) };
}

/** Compass direction for a heading (degrees, 0 = east, counter-clockwise). */
export function compass(heading: number): Compass {
  return COMPASS[((Math.round(heading / 45) % 8) + 8) % 8];
}

export function buildSheet(doc: Pick<RcTrack, "area" | "design" | "built">): BuildSheet {
  const b = doc.built;
  if (!b) throw new Error("buildSheet: the track has no built section; bake it first");
  const area = drawingArea(doc);

  const widths = b.racingLine.map((p) => p[2]);
  // shoelace over the racing line: positive is anticlockwise (+x east, +z north)
  let twice = 0;
  b.racingLine.forEach((p, i) => {
    const q = b.racingLine[(i + 1) % b.racingLine.length];
    twice += p[0] * q[1] - q[0] * p[1];
  });

  return {
    area: { length: area.length, width: area.width },
    lapLength: b.lapLength,
    corners: b.stats.corners,
    cornerPoints: cornerPoints(doc),
    size: b.size ? { length: b.size.length, width: b.size.width } : null,
    laneWidth: { min: Math.min(...widths), max: Math.max(...widths) },
    pipe: { length: b.stats.dividerLength, runs: b.stats.dividerRuns },
    jumps: b.features.map((f) => ({ type: f.type, x: f.x, z: f.z, length: f.length, height: f.height, ...fromSouthWest(area, f.x, f.z) })),
    crossovers: crossovers(doc, area),
    start: { x: b.startLine.x, z: b.startLine.z, heading: compass(b.startLine.heading), ...fromSouthWest(area, b.startLine.x, b.startLine.z) },
    direction: twice < 0 ? "clockwise" : "anticlockwise",
  };
}

/** The crossovers, in driving order from the start line, each with the pass it puts over (from built.crossings). */
function crossovers(doc: Pick<RcTrack, "design" | "built">, area: Area): SheetCrossover[] {
  const b = doc.built!;
  const start = doc.design.start?.distance ?? 0;
  const lap = b.lapLength || 1;
  const order = (d: number) => (((d - start) % lap) + lap) % lap;
  const design = doc.design.features ?? [];
  // where each one stands: on the over pass of the crossing it bridges, else at its own distance
  const at = (i: number) => {
    const c = b.crossings?.find((k) => k.bridge?.feature === i);
    return c?.over ? c.distances[c.over === "first" ? 0 : 1] : design[i]?.distance ?? 0;
  };
  return b.features
    .flatMap((f, i) => (f.type === "crossover" ? [{ f, i }] : []))
    .sort((p, q) => order(at(p.i)) - order(at(q.i)))
    .map(({ f, i }, k) => {
      const ramp = f.profile[1]?.[0] ?? 0;
      return {
        number: k + 1,
        feature: i,
        x: f.x,
        z: f.z,
        ...fromSouthWest(area, f.x, f.z),
        over: b.crossings?.find((c) => c.bridge?.feature === i)?.over ?? null,
        length: f.length,
        ramp,
        top: Math.round(((f.profile[2]?.[0] ?? ramp) - ramp) * 1000) / 1000,
        height: f.height,
      };
    });
}

/**
 * Corner points grouped into corners the way countCorners (bake.ts) counts them: every turn of more than
 * CORNER_MIN_TURN, turns the same way joined by less than CORNER_JOIN_GAP of racing line making one corner.
 */
function cornerPoints(doc: Pick<RcTrack, "area" | "design" | "built">): SheetCornerPoint[] {
  const pts = doc.design.points;
  if (pts.length < 3) return [];
  const corners = racingLine(pts, doc.design.laneWidth ?? 2.0).corners;
  const n = corners.length;
  const sig = corners.flatMap((c, i) => (c.th > CORNER_MIN_TURN ? [i] : []));
  if (!sig.length) return [];
  const straight = corners.map((c, i) => {
    const next = corners[(i + 1) % n].start;
    return Math.hypot(next[0] - c.end[0], next[1] - c.end[1]);
  });
  const arc = corners.map((c) => c.r * c.th);
  // joined[k]: sig[k] and the next significant point make one corner
  const joined = sig.map((i, k) => {
    const j = sig[(k + 1) % sig.length];
    if (sig.length < 2) return false;
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

  return groups.flatMap((g, gi) => {
    const hairpin = g.reduce((t, i) => t + corners[i].th, 0) >= HAIRPIN;
    return g.map((i, k): SheetCornerPoint => {
      const c = corners[i];
      return {
        number: gi + 1,
        label: g.length > 1 ? `${gi + 1}${String.fromCharCode(97 + (k % 26))}` : String(gi + 1),
        index: i,
        x: c.P[0],
        z: c.P[1],
        ...fromSouthWest(drawingArea(doc), c.P[0], c.P[1]),
        turn: c.sign > 0 ? "left" : "right",
        angle: (c.th * 180) / Math.PI,
        hairpin,
        arcStart: c.start,
        arcEnd: c.end,
      };
    });
  });
}
