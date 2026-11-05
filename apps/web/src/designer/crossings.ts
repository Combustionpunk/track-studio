// Crossovers in the designer (#51): placing one on a crossing, swapping which pass goes over, turning a tabletop too
// low to drive under into a crossover, the hints on crossing checks, and keeping each bridge on its pass when the start
// line moves (the passes are named first / second in driving order from the start line).
import { bridgeCrossings, findCrossings, type BuiltFeature, type Check, type Crossing, type Design, type DesignFeature, type FeatureType, type Point2 } from "@track-studio/engine";
import type { Live } from "./geometry.js";

/** a crossover dropped this close to a crossing (m, on the plan) snaps onto it */
export const CROSSING_SNAP = 2.5;

type Pass = "first" | "second";
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const pyMod = (a: number, n: number) => ((a % n) + n) % n;
/** distance between two lap distances, either way round */
const gap = (a: number, b: number, total: number) => {
  const d = pyMod(a - b, total);
  return Math.min(d, total - d);
};

/** The crossing nearest a lap distance (by either pass), within `within` metres along the line. */
function crossingFor(crossings: Pick<Crossing, "distances">[], distance: number, total: number, within = Infinity) {
  let best: { c: Pick<Crossing, "distances">; pass: 0 | 1; d: number } | null = null;
  for (const c of crossings)
    for (const pass of [0, 1] as const) {
      const d = gap(c.distances[pass], distance, total);
      if (d <= within && (!best || d < best.d)) best = { c, pass, d };
    }
  return best;
}

/**
 * Drop a crossover. Near a crossing it snaps onto it, over the pass that was clicked (`s`, metres along the line);
 * anywhere else it stays at `s`. Writes type, distance and over only (over always, so it can't change by default).
 */
export function addCrossover(features: DesignFeature[], crossings: Pick<Crossing, "x" | "z" | "distances">[], at: Point2, s: number, total: number): { features: DesignFeature[]; index: number } {
  const near = crossings.filter((c) => Math.hypot(c.x - at[0], c.z - at[1]) <= CROSSING_SNAP).sort((a, b) => Math.hypot(a.x - at[0], a.z - at[1]) - Math.hypot(b.x - at[0], b.z - at[1]))[0];
  let f: DesignFeature = { type: "crossover", distance: r3(pyMod(s, total)), over: "first" };
  if (near) {
    const pass = gap(near.distances[1], s, total) < gap(near.distances[0], s, total) ? 1 : 0;
    f = { type: "crossover", distance: near.distances[pass], over: pass ? "second" : "first" };
  }
  return { features: [...features, f], index: features.length };
}

/** The other pass goes over: `over` flips, and the crossover moves onto that pass's side of its crossing. */
export function swapOver(features: DesignFeature[], i: number, crossings: Pick<Crossing, "distances">[], total: number): DesignFeature[] {
  const f = features[i];
  const over: Pass = f.over === "second" ? "first" : "second";
  const hit = crossingFor(crossings, f.distance, total);
  const distance = hit ? hit.c.distances[over === "first" ? 0 : 1] : f.distance;
  return features.map((g, k) => (k === i ? { ...g, distance, over } : g));
}

/** A tabletop becomes a crossover: same place, over the pass it was on, at the crossover's own size. */
export function makeCrossover(features: DesignFeature[], i: number, crossings: Pick<Crossing, "distances">[], total: number): DesignFeature[] {
  const f = features[i];
  const hit = crossingFor(crossings, f.distance, total);
  const over: Pass = hit?.pass === 1 ? "second" : "first";
  return features.map((g, k) => (k === i ? { type: "crossover", distance: g.distance, over } : g));
}

/**
 * Move the start line. The passes of a crossing are named in driving order from the start line, so a move past one
 * swaps their names: each crossover's `over` is rewritten so its bridge stays on the same pass.
 */
export function moveStart(design: Design, live: Pick<Live, "line" | "s" | "total">, distance: number): Design {
  const features = design.features ?? [];
  const start = { ...design.start, distance };
  if (!features.some((f) => f.type === "crossover")) return { ...design, start };
  const cr = findCrossings(live.line, live.s, live.total, design.start?.distance ?? 0);
  const claimed = bridgeCrossings(cr, features, live.total);
  const key = (d: number) => pyMod(d - distance, live.total);
  let changed = false;
  const next = features.map((f, fi) => {
    const claim = claimed.get(fi);
    if (!claim) return f;
    const [c, over] = claim;
    const want: Pass = key(c.d[over]) <= key(c.d[1 - over]) ? "first" : "second";
    if (want === (f.over ?? "first")) return f;
    changed = true;
    return { ...f, over: want };
  });
  return { ...design, start, features: changed ? next : features };
}

/** The tabletop or crossover standing on a check's spot (a crossing), if any: the nearest whose footprint holds it. */
export function bridgeAt(c: Pick<Check, "x" | "z">, features: BuiltFeature[]): number | null {
  if (c.x === undefined || c.z === undefined) return null;
  let best: number | null = null, bestD = Infinity;
  features.forEach((f, i) => {
    if (f.type !== "tabletop" && f.type !== "crossover") return;
    const h = (f.heading * Math.PI) / 180;
    const dx = c.x! - f.x, dz = c.z! - f.z;
    const along = dx * Math.cos(h) + dz * Math.sin(h), across = -dx * Math.sin(h) + dz * Math.cos(h);
    const d = Math.hypot(dx, dz);
    if (Math.abs(along) <= f.length / 2 + 0.01 && Math.abs(across) <= f.width / 2 + 0.05 && d < bestD) [best, bestD] = [i, d];
  });
  return best;
}

/** What to do about a crossing error, as a sentence; `bridge` is the type of the feature on the crossing, if any. */
export function crossingHint(c: Pick<Check, "code">, bridge: FeatureType | null): string | null {
  if (c.code === "crossing-unbridged") return "Add a crossover (or a long tabletop) here.";
  if (c.code === "crossing-too-low") return bridge === "crossover" ? "Too low to drive under: raise it to 0.40 m in Advanced." : "Too low to drive under: use a Crossover, or raise it to 0.40 m in Advanced.";
  return null;
}

/** Which pass a crossover puts over, in words, from the bake's crossings. */
export function overText(f: DesignFeature, i: number, crossings: Crossing[]): string {
  const c = crossings.find((k) => k.bridge?.feature === i);
  const over = c?.over ?? f.over ?? "first";
  return `The ${over} pass from the start goes over${c ? "" : " (once it's on a crossing)"}.`;
}
