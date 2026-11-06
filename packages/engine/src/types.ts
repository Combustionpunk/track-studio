// Types for the rctrack (v1.6) and rcvenue (v1.1) formats — see docs/rctrack-SPEC.md and reference/rctrack.schema.json.
// Units: metres. Origin at the centre of the track area, +x east, +z north. Headings in degrees, 0 = +x, CCW.

export type TrackStatus = "draft" | "submitted" | "approved" | "archived";
export type Surface = "carpet" | "astro" | "clay" | "other";
export type Side = "north" | "south" | "east" | "west";
export type FeatureType = "tabletop" | "double" | "kicker" | "stepup" | "stepdown" | "whoops" | "bump" | "crossover";
export type CheckLevel = "error" | "warning" | "info";
export type CheckCode =
  | "outside-area"
  | "tight-corner"
  | "narrow-lane"
  | "feature-in-corner"
  | "radius-reduced"
  | "obstacle"
  | "crossing-unbridged"
  | "crossing-angle"
  | "crossing-too-close"
  | "crossing-too-low"
  | "crossover-unused";

/** [x, z] in metres */
export type Point2 = [number, number];

export interface VenueRef {
  id: number;
  name: string;
}

/** A venue template's link to the forum: one forum venue and one of its tracks (rcvenue 1.1). */
export interface ForumVenueRef {
  id: number;
  name?: string;
  /** the forum track at that venue; templates saved before rcvenue 1.1 have none */
  trackId?: number;
  trackName?: string;
}

/** Where a track came from: a venue adaptation (with `orientation`) or someone's copy (with `author`). */
export interface DerivedFrom {
  id: string;
  revision: number;
  /** fit orientation label, e.g. "rotated 180" — venue adaptations only */
  orientation?: string;
  /** forum username of the original's author — copies */
  author?: string;
}

export interface TrackInfo {
  name: string;
  author?: string;
  created?: string;
  modified?: string;
  description?: string;
  venue?: VenueRef | null;
  status?: TrackStatus;
  surface?: Surface;
  classes?: string[];
  tags?: string[];
  /** set on tracks adapted to a venue by the fit search */
  derivedFrom?: DerivedFrom;
}

export interface Area {
  length: number;
  width: number;
}

export interface CircleObstacle {
  type: "circle";
  x: number;
  z: number;
  radius: number;
  label?: string;
}

export interface RectObstacle {
  type: "rect";
  x: number;
  z: number;
  length: number;
  width: number;
  /** degrees, counter-clockwise */
  rotation?: number;
  label?: string;
}

export type Obstacle = CircleObstacle | RectObstacle;

export interface BasedOn {
  venueTemplate: string;
  revision: number;
}

export interface DesignPoint {
  x: number;
  z: number;
  /** racing-line radius at this corner (default 1.0) */
  radius?: number;
  /** lane width at this corner; blends linearly to the next point (default design.laneWidth) */
  width?: number;
  /**
   * outside of the corner: two straight pipes meeting ("square") or following the arc ("round"); "auto" (default,
   * v1.4) is square up to a 120° turn and round beyond
   */
  outer?: "square" | "round" | "auto";
}

export interface DesignFeature {
  type: FeatureType;
  /** centre of the feature, metres along the racing line from point 0 */
  distance: number;
  /** not used by crossovers (their length is 2 × rampLength + topLength) */
  length?: number;
  height?: number;
  /** crossover (v1.6): ramp up / down along the over pass (default 2 m) */
  rampLength?: number;
  /** crossover: flat top (default: the under pass's lane, crossed at the crossing's angle, plus 1 m each side) */
  topLength?: number;
  /** crossover: which pass goes over, in driving order from the start line (default "first") */
  over?: "first" | "second";
}

export interface RostrumPlacement {
  side?: Side;
  /** metres along that side from its centre */
  offset?: number;
}

export interface Design {
  laneWidth?: number;
  points: DesignPoint[];
  features?: DesignFeature[];
  start?: { distance?: number };
  rostrum?: RostrumPlacement;
}

/** [x, z, laneWidth] */
export type RacingLinePoint = [number, number, number];

export interface Divider {
  points: Point2[];
  /** true where one pipe separates two parts of the track */
  shared: boolean;
  closed: boolean;
}

export interface BuiltFeature {
  type: FeatureType;
  x: number;
  z: number;
  heading: number;
  length: number;
  width: number;
  height: number;
  /** [along, height] pairs, along = 0 at the entry edge */
  profile: Point2[];
}

export interface StartLine {
  x: number;
  z: number;
  heading: number;
  width: number;
  distance: number;
}

export interface BuiltRostrum {
  side: Side;
  x: number;
  z: number;
  eyeHeight: number;
}

/** Where the racing line crosses itself (v1.6). */
export interface Crossing {
  x: number;
  z: number;
  /** lap distances (m from point 0) of the first and second pass, in driving order from the start line */
  distances: [number, number];
  /** degrees between the two passes, 0..90 (90 = square) */
  angle: number;
  /** the pass that goes over the bridge; null when unbridged */
  over: "first" | "second" | null;
  /** the feature that bridges it: index into design.features / built.features */
  bridge: { type: "crossover" | "tabletop"; feature: number } | null;
  /** the bridge's outline [[x, z] × 4], for drawing; null when unbridged */
  footprint: Point2[] | null;
}

export interface Check {
  level: CheckLevel;
  code: CheckCode;
  message: string;
  x?: number;
  z?: number;
}

export interface Stats {
  dividerLength: number;
  dividerRuns: number;
  /** corners as racers count them: same-direction turns joined by < 3 m of racing line are one corner (v1.2) */
  corners: number;
}

/** Both lane edges as closed rings [[x, z], …], before divider merging: fill the band between them for the carpet (v1.4). */
export interface Lanes {
  right: Point2[];
  left: Point2[];
}

/** Real size from the lane edges, no pipe padding (v1.2). */
export interface Size {
  /** extent along x (m) */
  length: number;
  /** extent along z (m) */
  width: number;
  /** [xmin, zmin, xmax, zmax] */
  bbox: [number, number, number, number];
}

export interface Footprint {
  cell: number;
  origin: Point2;
  rows: number;
  cols: number;
  /** [xmin, zmin, xmax, zmax] */
  bbox: [number, number, number, number];
  /** row-major run lengths of the covered mask, alternating, starting with an empty run */
  rle: string;
}

export interface Built {
  generator: string;
  lapLength: number;
  racingLine: RacingLinePoint[];
  dividers: Divider[];
  features: BuiltFeature[];
  /** v1.6: present only when the track crosses itself */
  crossings?: Crossing[];
  startLine: StartLine;
  rostrum: BuiltRostrum;
  checks: Check[];
  footprint: Footprint;
  /** absent in files baked before v1.4 */
  lanes?: Lanes;
  /** absent in files baked before v1.2 */
  size?: Size;
  stats: Stats;
}

export interface RcTrack {
  format: "rctrack";
  version: 1;
  id: string;
  revision: number;
  info: TrackInfo;
  area: Area;
  basedOn?: BasedOn | null;
  obstacles?: Obstacle[];
  design: Design;
  built?: Built;
}

export interface VenueInfo {
  name: string;
  venue?: ForumVenueRef | null;
  notes?: string;
}

export interface RcVenue {
  format: "rcvenue";
  version: 1;
  id: string;
  revision: number;
  info: VenueInfo;
  area: Area;
  rostrum?: RostrumPlacement;
  obstacles?: Obstacle[];
}

/** One way a track fits a venue (see fit.ts). */
export interface FitResult {
  orientation: string;
  /** degrees CCW, applied after mirroring */
  rotation: number;
  /** x -> -x before rotating */
  mirror: boolean;
  /** [dx, dz] metres, applied after rotating */
  shift: [number, number];
  /** spare [length, width] in metres around the lanes */
  spare: [number, number];
}
