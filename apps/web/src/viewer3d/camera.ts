// Where the 3D viewer's camera stands (#83, the rostrum view #84): pure, so it's tested without WebGL. Positions in
// three.js axes (x east, y up, z south).
import { rostrumEye, type Area, type Side } from "@track-studio/engine";

export interface Pose {
  position: [number, number, number];
  target: [number, number, number];
}

/** Degrees above the floor of the starting 3/4 view. */
const HOME_ELEVATION = 35;
/** Room left around the area, as a share of the view. */
const MARGIN = 1.08;

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V): V => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** The nearest distance along `dir` (from the middle of the area) where its four corners fit in the view. */
function fitDistance(area: Area, dir: V, fovDeg: number, aspect: number): number {
  const tv = Math.tan((fovDeg * Math.PI) / 360) / MARGIN, th = tv * aspect;
  const f: V = [-dir[0], -dir[1], -dir[2]];
  const side = cross(f, [0, 1, 0]);
  const r = norm(Math.hypot(...side) < 1e-9 ? [1, 0, 0] : side);
  const u = cross(r, f);
  const L = area.length / 2, W = area.width / 2;
  const corners: V[] = [[-L, 0, -W], [L, 0, -W], [L, 0, W], [-L, 0, W]];
  const fits = (d: number) =>
    corners.every((c) => {
      const v = sub(c, [dir[0] * d, dir[1] * d, dir[2] * d]);
      const depth = dot(v, f);
      return depth > 0 && Math.abs(dot(v, u)) <= tv * depth && Math.abs(dot(v, r)) <= th * depth;
    });
  let lo = 0.1, hi = 10 * (Math.hypot(area.length, area.width) + 1);
  while (!fits(hi)) hi *= 2;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** The starting view: 3/4 from over the south-west corner, the whole area in view. */
export function homePose(area: Area, fovDeg: number, aspect: number): Pose {
  const e = (HOME_ELEVATION * Math.PI) / 180, s = Math.SQRT1_2;
  const dir = norm([-Math.cos(e) * s, Math.sin(e), Math.cos(e) * s]);
  const d = fitDistance(area, dir, fovDeg, aspect);
  return { position: [dir[0] * d, dir[1] * d, dir[2] * d], target: [0, 0, 0] };
}

/** Straight down on the area, north up (a hair to the south, so the orbit controls know which way is up). */
export function topPose(area: Area, fovDeg: number, aspect: number): Pose {
  const dir = norm([0, 1, 0.001]);
  const d = fitDistance(area, dir, fovDeg, aspect);
  return { position: [dir[0] * d, dir[1] * d, dir[2] * d], target: [0, 0, 0] };
}

// ------------------------------------------------------------------ rostrum view (#84)
/** Field of view at the rostrum (degrees, vertical): a little wider than the orbit view's, like a person's. */
export const ROSTRUM_FOV = 60;
/** Zoom narrows the field of view down to this, and widens it up to FOV_MAX. */
export const FOV_MIN = 12;
export const FOV_MAX = 75;
const PITCH_LIMIT = 85;

/** Which way the head turns at the rostrum, in degrees: yaw as plan headings (0 = east, counter-clockwise towards
 * north), pitch up from level, and the field of view. */
export interface Head {
  yaw: number;
  pitch: number;
  fov: number;
}

const DEG = Math.PI / 180;

/** Standing at the rostrum on `side`, looking at the middle of the area. */
export function rostrumHead(area: Area, side: Side): Head {
  const e = rostrumEye(area, side);
  return { yaw: Math.atan2(-e.z, -e.x) / DEG, pitch: Math.atan2(-e.eyeHeight, Math.hypot(e.x, e.z)) / DEG, fov: ROSTRUM_FOV };
}

/** The camera at the rostrum on `side` (where rostrumEye puts the eyes), looking where `head` turns. */
export function headPose(area: Area, side: Side, head: Head): Pose {
  const e = rostrumEye(area, side);
  const y = head.yaw * DEG, p = head.pitch * DEG;
  const position: V = [e.x, e.eyeHeight, -e.z];
  return { position, target: [e.x + Math.cos(p) * Math.cos(y), e.eyeHeight + Math.sin(p), -e.z - Math.cos(p) * Math.sin(y)] };
}

/** The rostrum view's starting pose: the eyes on `side`, looking at the middle of the area. */
export const rostrumPose = (area: Area, side: Side): Pose => headPose(area, side, rostrumHead(area, side));

/** Turn the head by `dYaw` (degrees, counter-clockwise: to the left) and `dPitch` (up); it can't look past straight up
 * or down. */
export function turnHead(h: Head, dYaw: number, dPitch: number): Head {
  const yaw = ((((h.yaw + dYaw + 180) % 360) + 360) % 360) - 180;
  return { ...h, yaw, pitch: Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, h.pitch + dPitch)) };
}

/** Zoom: the field of view times `k` (under 1 narrows it, i.e. zooms in), within FOV_MIN..FOV_MAX. */
export const zoomHead = (h: Head, k: number): Head => ({ ...h, fov: Math.max(FOV_MIN, Math.min(FOV_MAX, h.fov * k)) });
