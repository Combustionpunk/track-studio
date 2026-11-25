// Quick and Advanced designer modes. Both edit the same .rctrack.json; Quick only hides controls: it writes a corner's
// radius (as an apex radius) and its outside shape, never per-corner widths. Neither mode removes a value a track
// already has, except where a nested corner follows the one outside it (nest.ts) and the rule wants its outside on auto.
import { cornerNumbering, pointName, type BuiltFeature, type Check, type CheckLevel, type CornerNumbering, type DesignFeature, type DesignPoint, type FeatureType, type Point2 } from "@track-studio/engine";
import { newPointBetween } from "./geometry.js";
import type { SnapMode } from "./snap.js";

export type DesignerMode = "quick" | "advanced";

/** localStorage key of the remembered mode (a local preference, like the snap mode and layers) */
export const MODE_KEY = "designer-mode";

/** The remembered mode from storage; Quick unless Advanced was chosen. Deliberately ignores the track itself. */
export function readMode(stored: string | null): DesignerMode {
  try {
    return (JSON.parse(stored ?? "") as { mode?: unknown })?.mode === "advanced" ? "advanced" : "quick";
  } catch {
    return "quick";
  }
}

/** What only Advanced mode shows */
export type AdvancedControl =
  | "radius" // wheel / field
  | "width" // Ctrl+wheel / field
  | "outer" // square / round / auto, O key (#106: in Quick too, so a corner can be shaped without changing mode)
  | "fineSnap" // Shift
  | "freeSnap" // Alt
  | "mitre" // outside-corner handles
  | "hairpin" // H key (writes a radius)
  | "fullChecks" // info checks, check codes
  | "sizing" // jump length / height / type
  | "trackSettings"; // lane width, area, rostrum, description

/** what Quick shows of the Advanced controls */
const QUICK_HAS: ReadonlySet<AdvancedControl> = new Set<AdvancedControl>(["outer"]);

export const allows = (mode: DesignerMode, control: AdvancedControl): boolean => mode === "advanced" || QUICK_HAS.has(control);

/** What the wheel over a corner changes: radius, or lane width with Ctrl/⌘; nothing in Quick (the plan zooms instead). */
export function wheelEdit(mode: DesignerMode, ev: { ctrlKey: boolean; metaKey: boolean }): "radius" | "width" | null {
  const what = ev.ctrlKey || ev.metaKey ? "width" : "radius";
  return allows(mode, what) ? what : null;
}

/** Shift = fine, Alt = free, otherwise the toolbar's mode; Quick snaps to lanes only. */
export function snapModeFor(mode: DesignerMode, ev: { shiftKey: boolean; altKey: boolean }, toolbar: SnapMode): SnapMode {
  if (mode === "quick") return "lanes";
  return ev.altKey ? "free" : ev.shiftKey ? "fine" : toolbar;
}

// ---------------------------------------------------------------------------------------------- corner edits
/** Add a corner after `after`. Quick writes x and z only, so the corner takes the defaults (radius, the design's lane width, outer auto). */
export function insertPoint(mode: DesignerMode, points: DesignPoint[], after: number, at: Point2): DesignPoint[] {
  const np: DesignPoint = mode === "quick" ? { x: at[0], z: at[1] } : newPointBetween(points[after], points[(after + 1) % points.length], at);
  return [...points.slice(0, after + 1), np, ...points.slice(after + 1)];
}

/** Move corner `i`, keeping everything else about it. */
export const movePoint = (points: DesignPoint[], i: number, q: Point2): DesignPoint[] => points.map((p, k) => (k === i ? { ...p, x: q[0], z: q[1] } : p));

export const deletePoint = (points: DesignPoint[], i: number): DesignPoint[] => points.filter((_, k) => k !== i);

// ---------------------------------------------------------------------------------------------- jumps
export const FEATURE_TYPES: FeatureType[] = ["tabletop", "double", "kicker", "stepup", "stepdown", "whoops", "bump", "crossover"];

/** The jumps Quick's palette offers; step-up, step-down and bump stay in Advanced. A crossover bridges a crossing. */
export const QUICK_JUMPS: FeatureType[] = ["tabletop", "double", "kicker", "whoops", "crossover"];

export const paletteJumps = (mode: DesignerMode): FeatureType[] => (mode === "quick" ? QUICK_JUMPS : FEATURE_TYPES);

/** Drop a jump at `distance` along the line. Type and distance only, so it takes the engine's default size. (Crossovers
 * are placed with addCrossover, crossings.ts.) */
export function addJump(features: DesignFeature[], type: FeatureType, distance: number): { features: DesignFeature[]; index: number } {
  return { features: [...features, { type, distance }], index: features.length };
}

/** Slide jump `i` along the line, keeping everything else about it. */
export const moveJump = (features: DesignFeature[], i: number, distance: number): DesignFeature[] =>
  features.map((f, k) => (k === i ? { ...f, distance } : f));

export const deleteJump = (features: DesignFeature[], i: number): DesignFeature[] => features.filter((_, k) => k !== i);

/** a feature-in-corner check this close to a jump is about that jump (the bake puts it at the jump's centre) */
const ON_JUMP = 0.25; // m

/**
 * The jumps that are on or land into a corner, from the bake's feature-in-corner checks: index -> the check's level.
 * rctrack 1.8: info for a jump (a technical section), a warning for a crossover (its ramps need straight track).
 */
export function jumpsInCorner(checks: Check[], features: Pick<BuiltFeature, "x" | "z">[]): Map<number, CheckLevel> {
  const out = new Map<number, CheckLevel>();
  for (const c of checks) {
    if (c.code !== "feature-in-corner" || c.x === undefined || c.z === undefined) continue;
    // a crossover's warning wins over a jump's note that happens to sit as close
    features.forEach((f, i) => Math.hypot(f.x - c.x!, f.z - c.z!) < ON_JUMP && out.get(i) !== "warning" && out.set(i, c.level));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- checks
const ORDER: Record<CheckLevel, number> = { error: 0, warning: 1, info: 2 };

/** The checks a mode lists, errors first; Quick hides info. */
export const visibleChecks = (checks: Check[], mode: DesignerMode): Check[] =>
  checks.filter((c) => mode === "advanced" || c.level !== "info").sort((a, b) => ORDER[a.level] - ORDER[b.level]);

export function checkCounts(checks: Check[]) {
  return { errors: checks.filter((c) => c.level === "error").length, warnings: checks.filter((c) => c.level === "warning").length };
}

/** a check this close to a corner point is about that corner */
const NEAR_CORNER = 3; // m

/** The design point (index) a check is about, if one is close enough */
export function pointOf(c: Check, points: DesignPoint[]): number | null {
  if (c.x === undefined || c.z === undefined) return null;
  let best: number | null = null, bestD = NEAR_CORNER;
  points.forEach((p, i) => {
    const d = Math.hypot(p.x - c.x!, p.z - c.z!);
    if (d < bestD) [best, bestD] = [i, d];
  });
  return best;
}

// ---------------------------------------------------------------------------------------------- corner names (#176)
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A design point's name as a heading or title, by the engine's one corner numbering (the build sheet's): "Corner 5a"
 * ("Corner point 5a" in Advanced, where the points are the thing being edited), or just "Point" for a point that turns
 * too little to be a corner: it has no number and no name.
 */
export const pointHeading = (n: CornerNumbering, i: number, view: DesignerMode = "quick"): string => cap(pointName(n, i, view === "quick" ? "corner" : "corner point"));

/** A design point's name inside a sentence: "corner 5a", or "the point" for one that isn't a corner. */
export const pointRef = (n: CornerNumbering, i: number): string => (n.labels[i] ? "" : "the ") + pointName(n, i);

/** What to do about an error, as a sentence. */
export function fixFor(c: Check, points: DesignPoint[], laneWidth = 2.0): string {
  const i = pointOf(c, points);
  // a point that isn't a corner has no name to give: the sentence is then about the track
  const names = i === null ? null : cornerNumbering(points, laneWidth);
  const name = i !== null && names!.labels[i] ? pointRef(names!, i) : null;
  switch (c.code) {
    case "outside-area":
      return `Move ${name ?? "the track"} back inside the track area to fix it.`;
    case "obstacle":
      return `${name ? `Move ${name} so the track clears` : "Move the track off"} the fixed obstacle to fix it.`;
    case "crossing-unbridged":
      return "Add a crossover (or a long tabletop) where the track crosses itself to fix it.";
    default:
      return `${c.message.replace(/\.$/, "")}.`;
  }
}

/** Why Submit is blocked, as a plain sentence, or null when it can go. Warnings never block; errors always do. */
export function submitBlock({ dirty, pending, checks, points, laneWidth }: { dirty: boolean; pending: boolean; checks: Check[]; points: DesignPoint[]; laneWidth?: number }): string | null {
  // errors first (from the latest bake, a moment behind while dragging): what to fix matters more than saving
  const errors = checks.filter((c) => c.level === "error");
  if (errors.length) return `Submit is waiting on ${errors.length} ${errors.length === 1 ? "error" : "errors"}. ${fixFor(errors[0], points, laneWidth)}`;
  if (dirty) return "Save your changes before submitting.";
  if (pending) return "Checking the track…";
  return null;
}
