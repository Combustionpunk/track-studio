// Touch on the plan (#16): pinch and two-finger pan, and the rule that a two-finger gesture never paints or moves
// anything. Pure (no DOM): PlanView and the designer keep the pointers, this does the sums.
import { pan, zoomAt, type View } from "./plan.js";

/** how long a finger stays on a corner, without moving, to select it and open its panel */
export const LONG_PRESS_MS = 500;
/** a finger wobbles: this far (px) before a touch press becomes a drag */
export const TAP_SLOP_PX = 8;
/** a mouse press becomes a drag after this many pixels */
const MOUSE_SLOP_PX = 3;

export const slopFor = (pointerType: string) => (pointerType === "mouse" ? MOUSE_SLOP_PX : TAP_SLOP_PX);

export interface Spot {
  x: number;
  y: number;
}

/**
 * The view after two fingers move from `before` to `after` (box pixels): the plan point between the fingers stays
 * between them, so spreading zooms and moving together pans.
 */
export function pinchView(v: View, before: [Spot, Spot], after: [Spot, Spot], w: number, h: number, min: number, max: number): View {
  const [a0, b0] = before, [a1, b1] = after;
  const d0 = Math.hypot(a0.x - b0.x, a0.y - b0.y), d1 = Math.hypot(a1.x - b1.x, a1.y - b1.y);
  if (d0 < 1) return v;
  const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 }, m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
  return zoomAt(pan(v, m1.x - m0.x, m1.y - m0.y), d1 / d0, m1.x, m1.y, w, h, min, max);
}

/**
 * The fingers on the plan. Once a second finger lands it's a two-finger gesture until every finger is up, so the
 * finger left behind after a pinch doesn't start painting or dragging.
 */
export class Fingers {
  private ids = new Set<number>();
  private two = false;

  /** A finger lands. True when it's the second, which starts a two-finger gesture. */
  press(id: number): boolean {
    this.ids.add(id);
    if (this.ids.size === 2 && !this.two) return (this.two = true);
    return false;
  }

  lift(id: number) {
    if (!this.ids.delete(id)) return;
    if (this.ids.size === 0) this.two = false;
  }

  get count() {
    return this.ids.size;
  }

  /** a two-finger gesture is going on (or its last finger is still down) */
  get multi() {
    return this.two;
  }
}
