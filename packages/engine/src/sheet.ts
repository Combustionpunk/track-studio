// The build sheet: the figures marshals lay a track out from (#17). Positions are measured from the south-west corner
// of the drawing area (drawingArea; "x m from the west wall, y m from the south wall"), not from the centre origin the format uses.
//
// Everything comes from `built` except the corner points, which `built` doesn't list: they are the design points the
// engine's own corner maths treats as corners, numbered by numberCorners (numbering.ts: the CORNER_* rules that make
// built.stats.corners, and the numbering the designer shows), so the numbering always agrees with stats.corners. Tests check each corner's arc lies on built.racingLine.
import { drawingArea, racingLine } from "./bake.js";
import { numberCorners } from "./numbering.js";
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

/** A marshal point (v1.11), as the sheet lists it: in fill order. */
export interface SheetMarshal extends FromSouthWest {
  number: number;
  x: number;
  z: number;
  /** where it stands, for people: "outside corner 3 (hairpin), by the double", "beside the straight after corner 2" */
  where: string;
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
  /** marshal points (v1.11) by number, the fill order; [] when there are none */
  marshals: SheetMarshal[];
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
    marshals: marshals(doc, area),
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

const JUMP_NAME: Record<FeatureType, string> = {
  tabletop: "tabletop", double: "double", kicker: "kicker", stepup: "step-up", stepdown: "step-down", whoops: "whoops", bump: "bump", crossover: "crossover",
};
/** a cone this close (m, along the lap) to a corner's arc stands by that corner */
const BY_CORNER = 1.0;
/** a cone within this (m, along the lap) of a jump's ends stands by it */
const BY_JUMP = 2.0;

/**
 * The marshal points in fill order (by number; cones sharing a number in placement order), each with where it stands:
 * on the track, inside or outside the corner it stands by (within BY_CORNER of its arc along the lap), else beside the
 * straight after the corner before it, plus the jump it stands by. From built.marshals (lap distance and side) and the
 * corner numbering of cornerPoints; lap distances of the corners and jumps are measured on built.racingLine.
 */
function marshals(doc: Pick<RcTrack, "area" | "design" | "built">, area: Area): SheetMarshal[] {
  const b = doc.built!;
  const cones = b.marshals ?? [];
  if (!cones.length) return [];
  const lap = b.lapLength || 1;
  const line = b.racingLine;
  const s: number[] = [0];
  for (let k = 1; k < line.length; k++) s.push(s[k - 1] + Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]));
  const lapAt = (x: number, z: number) => {
    let best = 0;
    for (let k = 1; k < line.length; k++) if (Math.hypot(line[k][0] - x, line[k][1] - z) < Math.hypot(line[best][0] - x, line[best][1] - z)) best = k;
    return s[best];
  };
  const fwd = (from: number, to: number) => (((to - from) % lap) + lap) % lap; // along the lap, from -> to
  // each corner (racers' numbering): its lap span from the first point's arc start to the last point's arc end
  const groups = new Map<number, { start: number; end: number; turn: "left" | "right"; hairpin: boolean }>();
  for (const c of cornerPoints(doc)) {
    const g = groups.get(c.number);
    if (!g) groups.set(c.number, { start: lapAt(...c.arcStart), end: lapAt(...c.arcEnd), turn: c.turn, hairpin: c.hairpin });
    else g.end = lapAt(...c.arcEnd);
  }
  const corners = [...groups.entries()].map(([number, g]) => ({ number, ...g }));
  const jumps = (doc.design.features ?? []).map((f, i) => ({ name: JUMP_NAME[f.type], at: lapAt(b.features[i]?.x ?? 0, b.features[i]?.z ?? 0), half: (b.features[i]?.length ?? 0) / 2 }));

  const where = (m: (typeof cones)[number]): string => {
    if (m.gap === 0) return "on the track";
    let place = "beside the track";
    const by = corners.find((c) => fwd(c.start, m.distance) <= fwd(c.start, c.end) + BY_CORNER || fwd(m.distance, c.start) <= BY_CORNER);
    if (by) place = `${m.side === by.turn ? "inside" : "outside"} corner ${by.number}${by.hairpin ? " (hairpin)" : ""}`;
    else if (corners.length) {
      const before = corners.reduce((best, c) => (fwd(c.end, m.distance) < fwd(best.end, m.distance) ? c : best));
      place = `beside the straight after corner ${before.number}`;
    }
    const jump = jumps.find((j) => Math.min(fwd(j.at, m.distance), fwd(m.distance, j.at)) <= j.half + BY_JUMP);
    return jump ? `${place}, by the ${jump.name}` : place;
  };
  return cones
    .map((m, i) => ({ m, i }))
    .sort((p, q) => p.m.number - q.m.number || p.i - q.i)
    .map(({ m }) => ({ number: m.number, x: m.x, z: m.z, ...fromSouthWest(area, m.x, m.z), where: where(m) }));
}

/** Corner points grouped and labelled by the one corner numbering (numbering.ts, #176) that counts stats.corners. */
function cornerPoints(doc: Pick<RcTrack, "area" | "design" | "built">): SheetCornerPoint[] {
  const pts = doc.design.points;
  if (pts.length < 3) return [];
  const corners = racingLine(pts, doc.design.laneWidth ?? 2.0).corners;
  const { groups, labels } = numberCorners(corners);

  return groups.flatMap((g, gi) => {
    const hairpin = g.reduce((t, i) => t + corners[i].th, 0) >= HAIRPIN;
    return g.map((i): SheetCornerPoint => {
      const c = corners[i];
      return {
        number: gi + 1,
        label: labels[i]!,
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
