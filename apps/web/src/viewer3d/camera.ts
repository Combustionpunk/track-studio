// Where the 3D viewer's camera stands (#83): pure, so it's tested without WebGL. Positions in three.js axes (x east,
// y up, z south).
import type { Area } from "@track-studio/engine";

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
