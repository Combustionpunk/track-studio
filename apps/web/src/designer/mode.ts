// Quick and Advanced designer modes. Both edit the same .rctrack.json; Quick only hides controls and never writes
// per-corner radius, width or outer values (nor removes ones a track already has).
import type { Check, CheckLevel, DesignPoint, Point2, RacingLinePoint } from "@track-studio/engine";
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
  | "outer" // square / round / auto, O key
  | "fineSnap" // Shift
  | "freeSnap" // Alt
  | "mitre" // outside-corner handles
  | "hairpin" // H key (writes a radius)
  | "fullChecks" // info checks, check codes
  | "sizing" // jump length / height / type
  | "trackSettings"; // lane width, area, rostrum, description

export const allows = (mode: DesignerMode, _control: AdvancedControl): boolean => mode === "advanced";

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

// ---------------------------------------------------------------------------------------------- checks
const ORDER: Record<CheckLevel, number> = { error: 0, warning: 1, info: 2 };

/** The checks a mode lists, errors first; Quick hides info. */
export const visibleChecks = (checks: Check[], mode: DesignerMode): Check[] =>
  checks.filter((c) => mode === "advanced" || c.level !== "info").sort((a, b) => ORDER[a.level] - ORDER[b.level]);

export function checkCounts(checks: Check[]) {
  return { errors: checks.filter((c) => c.level === "error").length, warnings: checks.filter((c) => c.level === "warning").length };
}

export type ProblemMark =
  | { kind: "section"; level: CheckLevel; index: number; points: Point2[] }
  | { kind: "ring"; level: CheckLevel; index: number; x: number; z: number };

/** how far either side of the problem an error section runs, along the line */
const SECTION_HALF = 1.5; // m

/**
 * Problems to draw on the plan: an error is a section of the lane either side of where it is (a ring if it's off the
 * lane), a warning is a ring. Info is never drawn. `index` is the check's place in `checks`.
 */
export function problemMarks(checks: Check[], racingLine: RacingLinePoint[]): ProblemMark[] {
  const n = racingLine.length;
  if (!n) return [];
  const s: number[] = [0];
  for (let k = 1; k < n; k++) s.push(s[k - 1] + Math.hypot(racingLine[k][0] - racingLine[k - 1][0], racingLine[k][1] - racingLine[k - 1][1]));
  const total = s[n - 1] + Math.hypot(racingLine[0][0] - racingLine[n - 1][0], racingLine[0][1] - racingLine[n - 1][1]);
  const out: ProblemMark[] = [];
  checks.forEach((c, index) => {
    if (c.x === undefined || c.z === undefined || c.level === "info") return;
    const ring: ProblemMark = { kind: "ring", level: c.level, index, x: c.x, z: c.z };
    if (c.level === "warning") return void out.push(ring);
    let near = 0, best = Infinity;
    racingLine.forEach((p, k) => {
      const d = Math.hypot(p[0] - c.x!, p[1] - c.z!);
      if (d < best) [near, best] = [k, d];
    });
    if (best > racingLine[near][2] / 2 + 0.3) return void out.push(ring);
    const gap = (k: number) => {
      const d = Math.abs(s[k] - s[near]);
      return Math.min(d, total - d);
    };
    let a = 0, b = 0;
    while (a < n - 1 && gap((near - a - 1 + n) % n) <= SECTION_HALF) a++;
    while (b < n - 1 - a && gap((near + b + 1) % n) <= SECTION_HALF) b++;
    const points = Array.from({ length: a + b + 1 }, (_, k): Point2 => {
      const p = racingLine[(near - a + k + n) % n];
      return [p[0], p[1]];
    });
    out.push({ kind: "section", level: c.level, index, points });
  });
  return out;
}

/** a check this close to a corner point is about that corner */
const NEAR_CORNER = 3; // m

/** 1-based number of the corner a check is about, if one is close enough */
export function cornerOf(c: Check, points: DesignPoint[]): number | null {
  if (c.x === undefined || c.z === undefined) return null;
  let best: number | null = null, bestD = NEAR_CORNER;
  points.forEach((p, i) => {
    const d = Math.hypot(p.x - c.x!, p.z - c.z!);
    if (d < bestD) [best, bestD] = [i + 1, d];
  });
  return best;
}

/** What to do about an error, as a sentence. */
export function fixFor(c: Check, points: DesignPoint[]): string {
  const n = cornerOf(c, points);
  switch (c.code) {
    case "outside-area":
      return `Move ${n ? `corner ${n}` : "the track"} back inside the track area to fix it.`;
    case "obstacle":
      return `${n ? `Move corner ${n} so the track clears` : "Move the track off"} the fixed obstacle to fix it.`;
    default:
      return `${c.message.replace(/\.$/, "")}.`;
  }
}

/** Why Submit is blocked, as a plain sentence, or null when it can go. Warnings never block; errors always do. */
export function submitBlock({ dirty, pending, checks, points }: { dirty: boolean; pending: boolean; checks: Check[]; points: DesignPoint[] }): string | null {
  // errors first (from the latest bake, a moment behind while dragging): what to fix matters more than saving
  const errors = checks.filter((c) => c.level === "error");
  if (errors.length) return `Submit is waiting on ${errors.length} ${errors.length === 1 ? "error" : "errors"}. ${fixFor(errors[0], points)}`;
  if (dirty) return "Save your changes before submitting.";
  if (pending) return "Checking the track…";
  return null;
}
