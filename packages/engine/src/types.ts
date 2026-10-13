// Types for the rctrack (v1.1) and rcvenue (v1) formats — see docs/rctrack-SPEC.md and reference/rctrack.schema.json.
// Units: metres. Origin at the centre of the track area, +x east, +z north. Headings in degrees, 0 = +x, CCW.

export type TrackStatus = "draft" | "submitted" | "approved" | "archived";
export type Surface = "carpet" | "astro" | "clay" | "other";
export type Side = "north" | "south" | "east" | "west";
export type FeatureType = "tabletop" | "double" | "kicker" | "stepup" | "stepdown" | "whoops" | "bump";
export type CheckLevel = "error" | "warning" | "info";
export type CheckCode =
  | "outside-area"
  | "tight-corner"
  | "narrow-lane"
  | "feature-in-corner"
  | "radius-reduced"
  | "obstacle";

/** [x, z] in metres */
export type Point2 = [number, number];

export interface VenueRef {
  id: number;
  name: string;
}

export interface DerivedFrom {
  id: string;
  revision: number;
  /** fit orientation label, e.g. "rotated 180" */
  orientation: string;
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
}

export interface DesignFeature {
  type: FeatureType;
  /** centre of the feature, metres along the racing line from point 0 */
  distance: number;
  length?: number;
  height?: number;
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
  corners: number;
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
  startLine: StartLine;
  rostrum: BuiltRostrum;
  checks: Check[];
  footprint: Footprint;
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
  venue?: VenueRef | null;
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
