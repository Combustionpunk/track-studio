// The venue editor's document and the edits it makes, kept pure so they can be tested without a browser. A draft is
// an rcvenue file without format/version/id/revision (the server sets those). Metres, origin at the centre of the
// track area, +x east, +z north; rotations in degrees counter-clockwise (docs/rctrack-SPEC.md).
import type { Area, ForumVenueRef, Obstacle, Point2, RcVenue, Side } from "@track-studio/engine";

export interface VenueDraft {
  /** venue: the forum venue and track this template is for (venues/forum.ts) */
  info: { name: string; venue?: ForumVenueRef | null; notes?: string };
  area: Area;
  rostrum: { side: Side; offset: number };
  obstacles: Obstacle[];
}

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
    rostrum: { side: doc.rostrum?.side ?? "south", offset: doc.rostrum?.offset ?? 0 },
    obstacles: (doc.obstacles ?? []).map((o) => ({ ...o })),
  };
}

/** What POST/PUT /api/venues takes. */
export function venueBody(d: VenueDraft) {
  const notes = d.info.notes?.trim();
  return {
    info: { name: d.info.name.trim(), venue: d.info.venue ?? null, ...(notes ? { notes: d.info.notes } : {}) },
    area: d.area,
    rostrum: d.rostrum,
    obstacles: d.obstacles,
  };
}

export type Problems = Record<string, string>;

/**
 * Problems that would stop a save, keyed by field: name, length, width, forumTrack, rostrum, obstacle-<i>. A forum
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
export const obstacleName = (o: Obstacle) => o.label || (o.type === "circle" ? "Obstacle" : "Keep-out area");

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
