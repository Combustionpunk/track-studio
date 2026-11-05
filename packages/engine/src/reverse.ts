// Reverse the direction of travel (#36). Direction is the order of `design.points`, so this is a design edit, not a
// format change: re-bake afterwards and everything drawn from `built` (arrows, grid boxes, jump headings) follows.
import { arclength, racingLine } from "./bake.js";
import { pyMod } from "./num.js";
import type { Design } from "./types.js";

/**
 * The same layout driven the other way round: points `[p0, pn-1, …, p1]` (each keeps its own radius, width and
 * outer), and every jump and the start line moved along the new line so each stays in the same physical spot, wrapped
 * into [0, lapLength). Jumps keep their type, length and height, so they now face the new direction of travel.
 *
 * Distances count from the start of point 0's corner arc, which reversed is the end of that arc: a distance d becomes
 * `arc0 - d` (arc0 = the length of point 0's corner), not `lapLength - d`. Does not modify `design`.
 */
export function reverseDesign(design: Design): Design {
  const pts = design.points;
  if (pts.length < 3) return design;
  const { line, corners } = racingLine(pts, design.laneWidth ?? 2.0);
  const { s, total } = arclength(line.x, line.z);
  const arc0 = s[corners[0].str0];
  const flip = (d: number) => {
    const r = pyMod(arc0 - d, total);
    return r > total - 1e-9 ? 0 : r; // twice reversed comes back to 0, not to a hair under the lap
  };
  const out: Design = { ...design, points: [pts[0], ...pts.slice(1).reverse()], start: { ...design.start, distance: flip(design.start?.distance ?? 0) } };
  if (design.features) out.features = design.features.map((f) => ({ ...f, distance: flip(f.distance) }));
  return out;
}
