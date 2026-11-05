// Reverse direction (#36): the same layout driven the other way round. Pure: the designer makes it one undo step.
import { reverseDesign, type Design } from "@track-studio/engine";
import type { Cell } from "./lanes.js";

/**
 * The draft with its design reversed (see the engine's reverseDesign), and the squares a loop was laid through
 * reversed too, so "1 · Lay the lanes" reopens it in the new direction. While the lanes are being laid there is no
 * loop yet: the draft comes back unchanged.
 */
export function reverseDraft<D extends { design: Design; laying?: Cell[]; laid?: Cell[] }>(d: D): D {
  if (d.laying || d.design.points.length < 3) return d;
  const out = { ...d, design: reverseDesign(d.design) };
  if (d.laid?.length) out.laid = [d.laid[0], ...d.laid.slice(1).reverse()];
  return out;
}
