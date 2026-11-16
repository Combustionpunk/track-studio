// The drag loupe (#125; docs/design/phone-designer.md, mockup docs/design/phone/02-selected-point.html): while a finger
// drags a handle, a magnified circle of the plan round the point, so the finger isn't hiding what it moves. Pure (no
// DOM): where the loupe goes in the plan box, and what its readout says. PlanView draws it; the designer feeds it.
import type { Spot } from "./touch.js";

/** the loupe's circle, px across */
export const LOUPE_PX = 128;
/** how much bigger the plan is inside it than on screen */
export const LOUPE_ZOOM = 2.4;
/** the readout under the circle: its gap and height (px), so the loupe's footprint is the circle and this */
export const LOUPE_READ_PX = 32;
/** the widest readout ("x −10.25 · z −10.25 m"), px: it hangs over the circle's sides, so near a side edge it lines up
 * with the circle's edge instead of its centre */
export const LOUPE_READ_MAX_PX = 168;
/** from the finger's centre to the nearest edge of the loupe's footprint (px): clear of a 44 px fingertip */
export const LOUPE_GAP_PX = 36;
/** at least this far (px) from the plan box's edges */
export const LOUPE_MARGIN_PX = 4;

/**
 * Which layouts show the loupe. Phone only in stage 1 (#125); the Board left tablets unchanged, so turning it on there
 * later is this one switch.
 */
export const LOUPE_LAYOUTS = { phone: true, tablet: false } as const;

export type LoupeSide = "above" | "below" | "left" | "right";

export interface LoupePlace {
  /** the circle's top left in the plan box (px) */
  left: number;
  top: number;
  side: LoupeSide;
  /** how the readout lines up under the circle: centred, or flush with its left ("start") or right ("end") edge */
  read: "start" | "centre" | "end";
}

/**
 * Where the loupe goes for a finger at `finger` (px from the plan box's top left) in a `w` × `h` box: above the finger;
 * below it when there is no room above (near the top, so it never goes under the header); beside it when there is room
 * neither above nor below (a short plan); always clamped inside the box (so clear of the header and the toolbar).
 */
export function loupePlace(finger: Spot, w: number, h: number): LoupePlace {
  const p = circlePlace(finger, w, h);
  const hang = (LOUPE_READ_MAX_PX - LOUPE_PX) / 2;
  const read = p.left - hang < LOUPE_MARGIN_PX ? "start" : p.left + LOUPE_PX + hang > w - LOUPE_MARGIN_PX ? "end" : "centre";
  return { ...p, read };
}

function circlePlace(finger: Spot, w: number, h: number): Omit<LoupePlace, "read"> {
  const d = LOUPE_PX, foot = LOUPE_PX + LOUPE_READ_PX, m = LOUPE_MARGIN_PX, g = LOUPE_GAP_PX;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(Math.max(lo, hi), v));
  const centredX = clamp(finger.x - d / 2, m, w - m - d);
  const above = finger.y - g - foot;
  if (above >= m) return { left: centredX, top: above, side: "above" };
  const below = finger.y + g;
  if (below + foot <= h - m) return { left: centredX, top: below, side: "below" };
  // no room above or below: beside the finger, on the side with more room, level with it as far as the box allows
  const top = clamp(finger.y - foot / 2, m, h - m - foot);
  const right = finger.x + g;
  if (right + d <= w - m && (finger.x - g - d < m || w - finger.x >= finger.x)) return { left: right, top, side: "right" };
  return { left: clamp(finger.x - g - d, m, w - m - d), top, side: "left" };
}

/** The plan seen through the loupe: the viewBox (svg units: metres, y = -z) of a circle centred on plan point (x, z). */
export function loupeViewBox(at: readonly [number, number], pxPerMetre: number): string {
  const size = LOUPE_PX / (pxPerMetre * LOUPE_ZOOM);
  return `${at[0] - size / 2} ${-at[1] - size / 2} ${size} ${size}`;
}

const num = (v: number, digits = 2) => {
  const s = (Math.round(v * 10 ** digits) / 10 ** digits).toFixed(digits);
  return (s.startsWith("-") && Number(s) === 0 ? s.slice(1) : s).replace("-", "−");
};

/** what is being dragged, for the readout */
export type LoupeRead =
  | { kind: "point"; x: number; z: number }
  | { kind: "apex"; radius: number }
  | { kind: "along"; distance: number };

/** The readout under the loupe: a corner's position, an apex handle's radius, or a jump's or the start's distance. */
export function loupeText(r: LoupeRead): string {
  if (r.kind === "point") return `x ${num(r.x)} · z ${num(r.z)} m`;
  if (r.kind === "apex") return `Radius ${num(r.radius)} m`;
  return `${num(r.distance, 1)} m along the lap`;
}
