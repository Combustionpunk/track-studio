// Geometry for drawing plans. SVG user units are metres with y = -z (north up), so a plan point (x, z) is drawn at
// (x, -z). Everything is drawn from `built` (never recomputed from `design`).
import { rostrumPosition, type Area, type Built, type BuiltFeature, type Point2, type Side } from "@track-studio/engine";

export const MARGIN = 2.5; // m around the area (room for the rostrum)

export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** View: centre (svg units) and scale (px per metre). */
export interface View {
  cx: number;
  cy: number;
  s: number;
}

export function areaBounds(area: Area, margin = MARGIN): Bounds {
  return { x0: -area.length / 2 - margin, y0: -area.width / 2 - margin, x1: area.length / 2 + margin, y1: area.width / 2 + margin };
}

/** View that shows `b` whole in a w × h px box. */
export function fitView(b: Bounds, w: number, h: number): View {
  const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
  const s = Math.max(1e-3, Math.min(w / bw, h / bh));
  return { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, s };
}

export function viewBox(v: View, w: number, h: number): string {
  return `${v.cx - w / 2 / v.s} ${v.cy - h / 2 / v.s} ${w / v.s} ${h / v.s}`;
}

/** Zoom by `factor` keeping the point under (px, py) — pixels from the box's top left — where it is. */
export function zoomAt(v: View, factor: number, px: number, py: number, w: number, h: number, min: number, max: number): View {
  const s = Math.min(max, Math.max(min, v.s * factor));
  const mx = v.cx + (px - w / 2) / v.s, my = v.cy + (py - h / 2) / v.s;
  return { cx: mx - (px - w / 2) / s, cy: my - (py - h / 2) / s, s };
}

export const pan = (v: View, dxPx: number, dyPx: number): View => ({ ...v, cx: v.cx - dxPx / v.s, cy: v.cy - dyPx / v.s });

/** Plan coordinates (x, z) of a box pixel. */
export function toPlan(v: View, px: number, py: number, w: number, h: number): Point2 {
  return [v.cx + (px - w / 2) / v.s, -(v.cy + (py - h / 2) / v.s)];
}

export const pt = (x: number, z: number) => `${x},${-z}`;
export const pts = (p: ArrayLike<number>[]) => Array.from(p, (q) => pt(q[0], q[1])).join(" ");

/** Lane surface as one segment per racing-line step, each as wide as the lane there (widths blend between points). */
export function laneSegments(racingLine: Built["racingLine"]) {
  const n = racingLine.length;
  return racingLine.map((p, i) => {
    const q = racingLine[(i + 1) % n];
    return { x1: p[0], y1: -p[1], x2: q[0], y2: -q[1], w: (p[2] + q[2]) / 2 };
  });
}

/**
 * Lane surface as a few polylines: consecutive steps with (nearly) the same lane width share one polyline, drawn with
 * stroke-width = lane width. Much cheaper to redraw than one element per step (the designer redraws while dragging).
 */
export function laneRuns(racingLine: Built["racingLine"]): { points: string; w: number }[] {
  const n = racingLine.length;
  if (n < 2) return [];
  const q = (w: number) => Math.round(w * 50) / 50; // 2 cm steps
  const runs: { pts: string[]; w: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = racingLine[i], b = racingLine[(i + 1) % n];
    const w = q((a[2] + b[2]) / 2);
    const last = runs[runs.length - 1];
    if (last && last.w === w) last.pts.push(`${b[0]},${-b[1]}`);
    else runs.push({ pts: [`${a[0]},${-a[1]}`, `${b[0]},${-b[1]}`], w });
  }
  return runs.map((r) => ({ points: r.pts.join(" "), w: r.w }));
}

/** Arrows along the racing line every `every` metres: position and angle (degrees, svg space). */
export function arrowsAlong(racingLine: Built["racingLine"], every = 8) {
  const out: { x: number; y: number; angle: number }[] = [];
  let acc = every / 2;
  for (let i = 0; i < racingLine.length; i++) {
    const p = racingLine[i], q = racingLine[(i + 1) % racingLine.length];
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    acc += d;
    if (acc >= every) {
      acc = 0;
      out.push({ x: (p[0] + q[0]) / 2, y: -(p[1] + q[1]) / 2, angle: (Math.atan2(-(q[1] - p[1]), q[0] - p[0]) * 180) / Math.PI });
    }
  }
  return out;
}

/** Corners of a feature's footprint (plan coordinates). */
export function featureCorners(f: Pick<BuiltFeature, "x" | "z" | "heading" | "length" | "width">): Point2[] {
  const h = (f.heading * Math.PI) / 180;
  const tx = Math.cos(h), tz = Math.sin(h), nx = -tz, nz = tx;
  return ([[1, 1], [1, -1], [-1, -1], [-1, 1]] as const).map(([sl, sw]) => [
    f.x + (tx * sl * f.length) / 2 + (nx * sw * f.width) / 2,
    f.z + (tz * sl * f.length) / 2 + (nz * sw * f.width) / 2,
  ]);
}

/** Where the rostrum stands for a side/offset (as the engine places it). */
export function rostrumPos(area: Area, side: Side = "south", offset = 0): Point2 {
  return rostrumPosition(area, side, offset);
}

export const FEATURE_COLOUR: Record<string, string> = {
  tabletop: "#ffb347",
  double: "#5ec8ff",
  kicker: "#ffe066",
  stepup: "#c9a0ff",
  stepdown: "#c9a0ff",
  whoops: "#9be38f",
  bump: "#f7a1c4",
};

export const CHECK_COLOUR: Record<string, string> = { error: "#ff4d4d", warning: "#ffb000", info: "#7fb2ff" };

// transformBuilt / rostrumPosition live in the engine (the server draws fit thumbnails with them too)
export { transformBuilt } from "@track-studio/engine";
