// The plan's highlight in the designer: a point it centres on and marks. A check shown from the list, or the start line
// from its button (#177). The start line's lasts only while it is selected, and neither outlasts the mode or the 2D view
// it was made in, so the plan isn't left zoomed on something that is no longer picked.
import type { Point2 } from "@track-studio/engine";
import type { Selection } from "./Designer.js";
import type { DesignerMode } from "./mode.js";

export interface PlanMark {
  at: Point2;
  /** what asked for it: a check from the checks list, or the Start line button */
  of: "check" | "start";
  /** the mode it was made in */
  mode: DesignerMode;
}

/** The point the plan shows, if any: the start line's mark only while the start line is selected; either only in the
 * mode it was made in. */
export function shownMark(mark: PlanMark | null, sel: Selection, mode: DesignerMode): Point2 | null {
  if (!mark || mark.mode !== mode) return null;
  if (mark.of === "start" && sel?.kind !== "start") return null;
  return mark.at;
}
