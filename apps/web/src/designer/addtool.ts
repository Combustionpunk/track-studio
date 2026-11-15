// The "Add point" tool (#114): adding a corner point is a deliberate tool, so a stray click or drag can't add one.
// While it's off, a press on the track grabs a corner point or pans; while it's on, a click (or a tap) adds one where
// it did before. It stays on until it's turned off (the button again, A or Esc), so Quick can still tap round.
import type { DesignPoint, Point2 } from "@track-studio/engine";
import { tooClose } from "./geometry.js";
import { insertPoint, type DesignerMode } from "./mode.js";
import { insertAfter } from "./shape.js";

export type ToolKind = "select" | "add" | "feature";
type SelKind = "point" | "feature" | "start" | null;

/**
 * What a press on the track does. `nearPoint`: a corner point is within grabbing reach; `onCorner`: the press is on a
 * curve of the racing line (Advanced grabs the nearest point there). "pass" lets the press through, so a drag pans.
 */
export function lanePress(o: { tool: ToolKind; view: DesignerMode; nearPoint: boolean; onCorner: boolean; selKind: SelKind }): "feature" | "grab" | "release" | "add" | "pass" {
  if (o.tool === "feature") return "feature";
  if (o.view === "quick") {
    if (o.nearPoint) return "grab";
    // with a jump or the start line selected, a press on the track lets it go
    if (o.selKind && o.selKind !== "point") return "release";
    return o.tool === "add" ? "add" : "pass";
  }
  if (o.onCorner || o.nearPoint) return "grab";
  return o.tool === "add" ? "add" : "pass";
}

/** What a click or tap on the floor does: Quick adds a corner there only while the tool is on. */
export function floorTap(o: { tool: ToolKind; view: DesignerMode; laying: boolean; selKind: SelKind }): "add" | "deselect" {
  return !o.laying && o.view === "quick" && o.tool === "add" && (o.selKind === null || o.selKind === "point") ? "add" : "deselect";
}

/** A (no Ctrl, Cmd or Alt) toggles the tool */
export const addKey = (e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }) => (e.key === "a" || e.key === "A") && !e.ctrlKey && !e.metaKey && !e.altKey;

/** N / P while the tool is on: the next or previous corner round the loop (from nothing selected: the first or last) */
export const stepCorner = (n: number, i: number | null, dir: 1 | -1): number => (i === null ? (dir === 1 ? 0 : n - 1) : (i + dir + n) % n);

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Enter while the tool is on: a point halfway along the straight after corner i, the way a click there adds one in each
 * mode (Quick: a corner with an apex radius of 0; Advanced: between its neighbours). Null if there's no room.
 */
export function keyInsert(view: DesignerMode, points: DesignPoint[], i: number, laneWidth: number): { points: DesignPoint[]; index: number } | null {
  const n = points.length;
  if (!(i >= 0 && i < n)) return null;
  const a = points[i], b = points[(i + 1) % n];
  const at: Point2 = [r3((a.x + b.x) / 2), r3((a.z + b.z) / 2)];
  if (view === "quick") return insertAfter(points, i, at, laneWidth);
  if (tooClose(at, [a.x, a.z], [b.x, b.z])) return null;
  return { points: insertPoint(view, points, i, at), index: i + 1 };
}

/**
 * The hint over the plan in step 2, when no jump is armed. `sel`: the selected corner, if any. `tablet`: a finger (tap,
 * not click). `phone`: the phone layout (#122), where Select stops adding and pinch (or the wheel) zooms.
 */
export function shapeHint(o: { advanced: boolean; tablet: boolean; phone?: boolean; adding: boolean; sel: number | null }): string {
  if (o.phone) {
    const [Verb, verb] = o.tablet ? ["Tap", "tap"] : ["Click", "click"];
    if (o.adding) {
      if (o.advanced) return `${Verb} a straight to add a point there. ${Verb} Select to stop.`;
      return o.sel === null ? `${Verb} the track or the floor to add a corner. ${Verb} Select to stop.` : `${Verb} the floor to add a corner after ${o.sel + 1}. ${Verb} Select to stop.`;
    }
    const zoom = o.tablet ? "Pinch to zoom in." : "Scroll to zoom in.";
    if (o.advanced) return `${zoom} Drag a corner point to move it; to add one, ${verb} Add point, then a straight.`;
    return `${zoom} ${Verb} a corner to select it, drag it to move it, or drag its inside handle to cut it back.`;
  }
  if (o.adding) {
    if (o.tablet) return o.sel === null ? "Tap the track or the floor to add a corner. Tap Add point again to stop." : `Tap the floor to add a corner after ${o.sel + 1}. Tap Add point again to stop.`;
    if (o.advanced) return "Click a straight to add a point there. Esc or A to stop.";
    return o.sel === null ? "Click the track or the floor to add a corner. Esc or A to stop." : `Click the track or the floor to add a corner after ${o.sel + 1}. Esc or A to stop.`;
  }
  if (o.advanced) return "Drag a corner to move it. To add one, press Add point (A), then click a straight.";
  if (o.tablet) return "Drag a corner, or its inside handle to cut it back. Hold a corner for its panel; tap Add point to add one.";
  return "Drag a corner, or its inside handle to cut it back. To add one, press Add point (A).";
}
