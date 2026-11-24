// The venue editor's document and the edits it makes, kept pure so they can be tested without a browser. A draft is
// an rcvenue file without format/version/id/revision (the server sets those). Metres, origin at the centre of the
// track area, +x east, +z north; rotations in degrees counter-clockwise (docs/rctrack-SPEC.md).
import { obstacleLabel, type Area, type ForumVenueRef, type Obstacle, type ObstacleKind, type Point2, type RcVenue, type Side, type TimingLoop, type VenueSurface } from "@track-studio/engine";

export interface VenueDraft {
  /** venue: the forum venue and track this template is for (venues/forum.ts) */
  info: { name: string; venue?: ForumVenueRef | null; notes?: string };
  /** rcvenue 1.2 (#173): what the track is laid on; undefined: not said */
  surface?: VenueSurface;
  area: Area;
  rostrum: { side: Side; offset: number };
  /** rcvenue 1.2: the timing loop; undefined: none */
  timingLoop?: TimingLoop;
  /** obstacles, and (rcvenue 1.2) the pit area and rostrum zones, told apart by `kind` */
  obstacles: Obstacle[];
}

export const SURFACE_LABEL: Record<VenueSurface, string> = { carpet: "Carpet", astro: "Astro", dirt: "Dirt", clay: "Clay", tarmac: "Tarmac", mixed: "Mixed" };

/** The server's input limits (apps/server/src/store.ts LIMITS). */
export const MAX_AREA = 100;
export const MAX_COORD = 100;
export const MAX_OBSTACLES = 100;
const MIN_SIZE = 0.1;

export const SIDES: Side[] = ["south", "north", "east", "west"];
export const SIDE_LABEL: Record<Side, string> = { south: "South", north: "North", east: "East", west: "West" };

/** To 0.1 m, the precision the form shows. */
export const tenth = (v: number) => Math.round(v * 10) / 10 || 0;

export function blankVenue(): VenueDraft {
  return { info: { name: "", venue: null }, area: { length: 22, width: 12 }, rostrum: { side: "south", offset: 0 }, obstacles: [] };
}

export function draftFromDoc(doc: RcVenue): VenueDraft {
  return {
    info: { ...doc.info, venue: doc.info.venue ?? null },
    area: { ...doc.area },
    ...(doc.surface ? { surface: doc.surface } : {}),
    rostrum: { side: doc.rostrum?.side ?? "south", offset: doc.rostrum?.offset ?? 0 },
    ...(doc.timingLoop ? { timingLoop: { ...doc.timingLoop } } : {}),
    obstacles: (doc.obstacles ?? []).map((o) => ({ ...o })),
  };
}

/** What POST/PUT /api/venues takes. */
export function venueBody(d: VenueDraft) {
  const notes = d.info.notes?.trim();
  return {
    info: { name: d.info.name.trim(), venue: d.info.venue ?? null, ...(notes ? { notes: d.info.notes } : {}) },
    ...(d.surface ? { surface: d.surface } : {}),
    area: d.area,
    rostrum: d.rostrum,
    ...(d.timingLoop ? { timingLoop: d.timingLoop } : {}),
    obstacles: d.obstacles,
  };
}

export type Problems = Record<string, string>;

/**
 * Problems that would stop a save, keyed by field: name, length, width, forumTrack, rostrum, timingLoop, obstacle-<i>. A forum
 * link must name the track, except on a template saved before rcvenue 1.1 that keeps its forum venue
 * (`legacyVenueId`: that venue's id, when the saved revision has no track).
 */
export function draftProblems(d: VenueDraft, opts: { legacyVenueId?: number } = {}): Problems {
  const p: Problems = {};
  if (!d.info.name.trim()) p.name = "Give the venue a name.";
  else if (d.info.name.trim().length > 80) p.name = "Keep the name to 80 characters.";
  for (const k of ["length", "width"] as const) {
    const v = d.area[k], label = k === "length" ? "Length" : "Width";
    if (!Number.isFinite(v) || v <= 0) p[k] = `${label} must be more than 0 m.`;
    else if (v > MAX_AREA) p[k] = `${label} can be at most ${MAX_AREA} m.`;
  }
  if (d.info.venue && d.info.venue.trackId === undefined && d.info.venue.id !== opts.legacyVenueId) p.forumTrack = "Pick the track at this forum venue.";
  const { side, offset } = d.rostrum;
  if (!Number.isFinite(offset)) p.rostrum = "Rostrum position must be a number.";
  else if (!p.length && !p.width && Math.abs(offset) > wallHalf(d.area, side) + 1e-9) {
    p.rostrum = `The rostrum must be on its wall: 0 to ${fmtM(2 * wallHalf(d.area, side))} m from the ${cornerWord(side)} corner.`;
  }
  const loop = d.timingLoop;
  if (loop) {
    if (![loop.x, loop.z, loop.heading, loop.length].every(Number.isFinite)) p.timingLoop = "Timing loop: every field must be a number.";
    else if (!(loop.length > 0)) p.timingLoop = "Timing loop: its length must be more than 0 m.";
    else if (Math.abs(loop.x) > MAX_COORD || Math.abs(loop.z) > MAX_COORD || loop.length > MAX_AREA) p.timingLoop = `Timing loop: keep it within ${MAX_COORD} m of the centre.`;
  }
  if (d.obstacles.length > MAX_OBSTACLES) p.obstacles = `At most ${MAX_OBSTACLES} obstacles.`;
  d.obstacles.forEach((o, i) => {
    const msg = obstacleProblem(o);
    if (msg) p[`obstacle-${i}`] = msg;
  });
  return p;
}

function obstacleProblem(o: Obstacle): string | null {
  if (!Number.isFinite(o.x) || !Number.isFinite(o.z)) return "Position must be a number.";
  if (Math.abs(o.x) > MAX_COORD || Math.abs(o.z) > MAX_COORD) return `Position must be within ${MAX_COORD} m of the centre.`;
  if (o.type === "circle") return Number.isFinite(o.radius) && o.radius > 0 ? null : "Radius must be more than 0 m.";
  if (!(Number.isFinite(o.length) && o.length > 0 && Number.isFinite(o.width) && o.width > 0)) return "Length and width must be more than 0 m.";
  if (o.rotation !== undefined && !Number.isFinite(o.rotation)) return "Rotation must be a number.";
  return null;
}

// ------------------------------------------------------------------ rostrum
/** Half the length of the rostrum's wall: how far the offset can go each way. */
const wallHalf = (area: Area, side: Side) => (side === "north" || side === "south" ? area.length : area.width) / 2;

/** The corner the form measures the rostrum from: west on the north/south walls, south on the east/west walls. */
export const cornerWord = (side: Side) => (side === "north" || side === "south" ? "west" : "south");

/** Rounding that only removes floating-point noise, so a typed value comes back exactly as typed. */
const clean = (v: number) => Math.round(v * 1e6) / 1e6 || 0;
const fmtM = (v: number) => String(clean(v));

/** Offset from the wall's centre → metres from the wall's corner (cornerWord), and back. */
export const toCorner = (area: Area, side: Side, offset: number) => clean(offset + wallHalf(area, side));
export const fromCorner = (area: Area, side: Side, fromCornerM: number) => clean(fromCornerM - wallHalf(area, side));

/** The rostrum's offset for a pointer at `p` while it is dragged along its wall. */
export function rostrumOffsetAt(area: Area, side: Side, p: Point2): number {
  const h = wallHalf(area, side);
  const along = side === "north" || side === "south" ? p[0] : p[1];
  return tenth(Math.min(h, Math.max(-h, along)));
}

export function setRostrumSide(area: Area, r: VenueDraft["rostrum"], side: Side): VenueDraft["rostrum"] {
  return { side, offset: Math.abs(r.offset) <= wallHalf(area, side) ? r.offset : 0 };
}

// ------------------------------------------------------------------ obstacles
export const obstacleName = obstacleLabel;

/** rcvenue 1.2: what the kind picker offers; "" is a plain obstacle */
export const KIND_LABEL: Record<"" | ObstacleKind, string> = { "": "Obstacle", pits: "Pit area", rostrum: "Rostrum" };

/** The obstacle as another kind (or a plain obstacle): the label follows when it was the old kind's default. */
export function setKind(o: Obstacle, kind: ObstacleKind | undefined): Obstacle {
  const { kind: _old, ...rest } = o;
  const next = (kind ? { ...rest, kind } : rest) as Obstacle;
  return o.label && o.label !== obstacleLabel({ ...o, label: undefined }) ? next : { ...next, label: obstacleLabel({ ...next, label: undefined }) };
}

/** rcvenue 1.2: a pit area or a rostrum zone, a rectangle in the middle to drag into place. */
export function addZone(d: VenueDraft, kind: ObstacleKind): VenueDraft {
  const o: Obstacle = kind === "pits" ? { type: "rect", kind, x: 0, z: 0, length: 4, width: 1, rotation: 0, label: "Pits" } : { type: "rect", kind, x: 0, z: 0, length: 3, width: 0.8, rotation: 0, label: "Rostrum" };
  return { ...d, obstacles: [...d.obstacles, o] };
}

// ------------------------------------------------------------------ timing loop (rcvenue 1.2)
/** A timing loop 1 m in from the south wall, 3 m long, the track running east over it: a start to drag into place. */
export function addTimingLoop(d: VenueDraft): VenueDraft {
  return { ...d, timingLoop: { x: 0, z: tenth(-d.area.width / 2 + 1), heading: 0, length: 3 } };
}

export const moveTimingLoop = (l: TimingLoop, p: Point2): TimingLoop => ({ ...l, x: tenth(p[0]), z: tenth(p[1]) });

/** The loop turned so the track runs from its centre towards `p`, in 15° steps. */
export function turnTimingLoop(l: TimingLoop, p: Point2): TimingLoop {
  const deg = (Math.atan2(p[1] - l.z, p[0] - l.x) * 180) / Math.PI;
  return { ...l, heading: ((Math.round(deg / 15) * 15) % 360 + 360) % 360 };
}

/** Where the loop's turn handle sits: 1 m ahead of its centre, the way the track runs. */
export function loopHandle(l: TimingLoop): Point2 {
  const a = (l.heading * Math.PI) / 180;
  return [l.x + Math.cos(a), l.z + Math.sin(a)];
}

/** The loop's ends, square to its heading. */
export function loopEnds(l: TimingLoop): [Point2, Point2] {
  const a = (l.heading * Math.PI) / 180, h = l.length / 2;
  return [[l.x + Math.sin(a) * h, l.z - Math.cos(a) * h], [l.x - Math.sin(a) * h, l.z + Math.cos(a) * h]];
}

export function addObstacle(d: VenueDraft, type: Obstacle["type"]): VenueDraft {
  const n = d.obstacles.length + 1;
  const o: Obstacle =
    type === "circle"
      ? { type: "circle", x: 0, z: 0, radius: 0.5, label: `Obstacle ${n}` }
      : { type: "rect", x: 0, z: 0, length: 2, width: 1, rotation: 0, label: `Keep-out area ${n}` };
  return { ...d, obstacles: [...d.obstacles, o] };
}

const rotate = ([x, z]: Point2, deg: number): Point2 => {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [x * c - z * s, x * s + z * c];
};

/** A rectangle's corners in plan coordinates. */
export function rectCorners(o: Extract<Obstacle, { type: "rect" }>): Point2[] {
  return ([[1, 1], [-1, 1], [-1, -1], [1, -1]] as const).map(([a, b]) => {
    const [dx, dz] = rotate([(a * o.length) / 2, (b * o.width) / 2], o.rotation ?? 0);
    return [o.x + dx, o.z + dz];
  });
}

const EPS = 1e-6;

/** Does any part of the obstacle stick out of the track area? */
export function obstacleOutside(area: Area, o: Obstacle): boolean {
  const hx = area.length / 2 + EPS, hz = area.width / 2 + EPS;
  if (o.type === "circle") return Math.abs(o.x) + o.radius > hx || Math.abs(o.z) + o.radius > hz;
  return rectCorners(o).some(([x, z]) => Math.abs(x) > hx || Math.abs(z) > hz);
}

/** Indexes of the obstacles that stick out of the area. */
export const outsideObstacles = (d: VenueDraft) => d.obstacles.flatMap((o, i) => (obstacleProblem(o) === null && obstacleOutside(d.area, o) ? [i] : []));

export const moveObstacle = <O extends Obstacle>(o: O, p: Point2): O => ({ ...o, x: tenth(p[0]), z: tenth(p[1]) });

/** Where the resize handle sits: a circle's east edge, a rectangle's (turned) north-east corner. */
export function resizeHandle(o: Obstacle): Point2 {
  if (o.type === "circle") return [o.x + o.radius, o.z];
  const [dx, dz] = rotate([o.length / 2, o.width / 2], o.rotation ?? 0);
  return [o.x + dx, o.z + dz];
}

/** The obstacle resized so its handle is at `p` (centre and rotation stay). */
export function resizeObstacle<O extends Obstacle>(o: O, p: Point2): O {
  if (o.type === "circle") return { ...o, radius: Math.max(MIN_SIZE, tenth(Math.hypot(p[0] - o.x, p[1] - o.z))) };
  const [lx, lz] = rotate([p[0] - o.x, p[1] - o.z], -(o.rotation ?? 0));
  return { ...o, length: Math.max(MIN_SIZE, tenth(2 * Math.abs(lx))), width: Math.max(MIN_SIZE, tenth(2 * Math.abs(lz))) };
}

/** "Circle · x 9.0 m · z 2.0 m · radius 0.5 m" */
export function obstacleSummary(o: Obstacle): string {
  const m = (v: number) => `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)} m`;
  const at = `x ${m(o.x)} · z ${m(o.z)}`;
  if (o.type === "circle") return `Circle · ${at} · radius ${m(o.radius)}`;
  return `Rectangle · ${at} · ${o.length.toFixed(1)} × ${o.width.toFixed(1)} m${o.rotation ? ` · turned ${o.rotation}°` : ""}`;
}
