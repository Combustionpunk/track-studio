// A track may cross itself on a bridge (rctrack v1.6): crossings in the racing line, what bridges them, the checks.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adapt, bakeBuilt, BRIDGE_MARGIN, fits, transformBuilt, type Built, type DesignFeature, type RcTrack, type RcVenue } from "../src/index.js";
import { extraDir, readJson } from "./helpers.js";

const track = (pts: [number, number][], opts: { features?: DesignFeature[]; start?: number; radius?: number; area?: [number, number] } = {}): RcTrack => ({
  format: "rctrack", version: 1, id: "t", revision: 1, info: { name: "t" },
  area: { length: opts.area?.[0] ?? 30, width: opts.area?.[1] ?? 20 },
  design: {
    laneWidth: 2, points: pts.map(([x, z]) => ({ x, z, radius: opts.radius ?? 1.5 })), features: opts.features ?? [],
    start: { distance: opts.start ?? 0 }, rostrum: { side: "south" },
  },
});
/** Figure of eight: diagonals crossing square at the origin, lobes east and west. */
const FIG8: [number, number][] = [[-6, -6], [6, 6], [10, 6], [10, -6], [6, -6], [-6, 6], [-10, 6], [-10, -6]];
/** The back straight dips under the main straight (z = -2) twice, at x = -3 and x = 3. */
const TWICE: [number, number][] = [[-10, -2], [10, -2], [10, 5], [3, 5], [3, -6], [-3, -6], [-3, 5], [-10, 5]];
const codes = (b: Built) => b.checks.map((c) => c.code);
const fixture = (name: string) => readJson<RcTrack>(join(extraDir, `${name}.rctrack.json`));

describe("crossing detection", () => {
  it("a figure of eight crosses itself once, square, at the origin", () => {
    const b = bakeBuilt(track(FIG8));
    expect(b.crossings).toHaveLength(1);
    const [c] = b.crossings!;
    expect(c.x).toBeCloseTo(0, 2);
    expect(c.z).toBeCloseTo(0, 2);
    expect(c.angle).toBeCloseTo(90, 1);
    expect(c.distances[0]).toBeLessThan(c.distances[1]);
    expect(c.distances[1] - c.distances[0]).toBeGreaterThan(10);
  });

  it("finds two crossings, in driving order", () => {
    const b = bakeBuilt(track(TWICE, { radius: 1 }));
    expect(b.crossings!.map((c) => [Math.round(c.x), Math.round(c.z)])).toEqual([[-3, -2], [3, -2]]);
    for (const c of b.crossings!) expect(c.angle).toBeCloseTo(90, 1);
  });

  it("finds a crossing on the lap's seam: point 0 is a straight-through point on the crossing", () => {
    // point 0 sits on the NE diagonal at the origin, so lap distance 0 is the crossing
    const pts: [number, number][] = [[0, 0], ...FIG8.slice(1), FIG8[0]];
    const b = bakeBuilt(track(pts));
    expect(b.crossings).toHaveLength(1);
    const d = b.crossings![0].distances;
    expect(Math.min(d[0], b.lapLength - d[0], d[1], b.lapLength - d[1])).toBeLessThan(0.01);
  });

  it("labels the passes from the start line: a start just past the first pass makes it the second", () => {
    const before = bakeBuilt(track(FIG8)).crossings![0];
    const after = bakeBuilt(track(FIG8, { start: before.distances[0] + 0.5 })).crossings![0];
    expect(after.distances).toEqual([before.distances[1], before.distances[0]]);
    const near = bakeBuilt(track(FIG8, { start: before.distances[0] - 0.5 })).crossings![0];
    expect(near.distances).toEqual(before.distances);
  });

  it("tracks that don't cross themselves have no crossings key", () => {
    const b = bakeBuilt(track([[-10, -5], [10, -5], [10, 5], [-10, 5]]));
    expect("crossings" in b).toBe(false);
  });

  it("an unbridged crossing is an error; the pipes of both passes stay whole", () => {
    const b = bakeBuilt(track(FIG8));
    expect(codes(b)).toEqual(["crossing-unbridged"]);
    expect(b.crossings![0]).toMatchObject({ over: null, bridge: null, footprint: null });
    // the two lane-edge pipes each run right round the eight (not cut at the crossing)
    expect(b.dividers.map((d) => d.closed)).toEqual([true, true]);
    for (const d of b.dividers) expect(d.points.length).toBeGreaterThan(12);
  });
});

describe("crossover", () => {
  const first = bakeBuilt(track(FIG8)).crossings![0].distances;

  it("goes over the first pass by default, sized from the lane: 2 m ramps, top = lane + 2 × 1 m, 0.3 m high", () => {
    const b = bakeBuilt(track(FIG8, { features: [{ type: "crossover", distance: first[0] }] }));
    expect(codes(b)).toEqual([]);
    const c = b.crossings![0];
    expect(c.over).toBe("first");
    expect(c.bridge).toEqual({ type: "crossover", feature: 0 });
    const f = b.features[0];
    expect(f).toMatchObject({ type: "crossover", heading: 45, length: 8, height: 0.3 });
    expect(f.profile).toEqual([[0, 0], [2, 0.3], [6, 0.3], [8, 0]]);
    expect(Math.hypot(f.x - c.x, f.z - c.z)).toBeLessThan(0.01);
    expect(c.footprint).toHaveLength(4);
  });

  it("over: second puts it on the other pass", () => {
    const b = bakeBuilt(track(FIG8, { features: [{ type: "crossover", distance: first[0], over: "second" }] }));
    expect(codes(b)).toEqual([]);
    expect(b.crossings![0].over).toBe("second");
    expect(b.features[0].heading).toBe(135);
  });

  it("snaps to the crossing from either pass's distance, within half its length", () => {
    for (const d of [first[0] + 3.5, first[1] - 3.5]) {
      const b = bakeBuilt(track(FIG8, { features: [{ type: "crossover", distance: d }] }));
      expect(codes(b)).toEqual([]);
      expect(b.features[0].heading).toBe(45); // over the first pass either way
    }
    const far = bakeBuilt(track(FIG8, { features: [{ type: "crossover", distance: first[0] + 4.5 }] }));
    expect(codes(far)).toContain("crossing-unbridged");
  });

  it("takes its own ramp, top and height", () => {
    const b = bakeBuilt(track(FIG8, { features: [{ type: "crossover", distance: first[0], rampLength: 1.5, topLength: 5, height: 0.25 }] }));
    expect(b.features[0].profile).toEqual([[0, 0], [1.5, 0.25], [6.5, 0.25], [8, 0]]);
    expect(codes(b)).toEqual([]);
  });

  it("a crossover whose top is too short doesn't bridge it", () => {
    const b = bakeBuilt(track(FIG8, { features: [{ type: "crossover", distance: first[0], topLength: 3.5 }] }));
    expect(codes(b)).toEqual(["crossing-unbridged"]);
  });

  it("ramps that reach a corner are feature-in-corner", () => {
    const b = bakeBuilt(track(FIG8, { features: [{ type: "crossover", distance: first[0], rampLength: 5 }] }));
    expect(codes(b)).toEqual(["feature-in-corner"]);
  });
});

describe("tabletop as the bridge", () => {
  const d = bakeBuilt(track(FIG8)).crossings![0].distances;
  // its flat top is 0.8 / 2.2 of its length and must span the 2 m lane plus 1 m each side: 4 m, so a length of 11 m
  const need = ((2 + 2 * BRIDGE_MARGIN) * 2.2) / 0.8;
  const on = (length: number, distance = d[1]) => bakeBuilt(track(FIG8, { features: [{ type: "tabletop", distance, length }] }));

  it("bridges the crossing when its flat top spans the under pass's lane plus 1 m each side", () => {
    const b = on(need + 0.01);
    expect(codes(b)).toEqual([]);
    expect(b.crossings![0]).toMatchObject({ over: "second", bridge: { type: "tabletop", feature: 0 } });
  });

  it("is crossing-unbridged when its top is too short, or the top misses the crossing", () => {
    expect(codes(on(need - 0.05))).toEqual(["crossing-unbridged"]);
    expect(codes(on(12, d[1] + 0.6))).toEqual(["crossing-unbridged"]); // 12 m long has 0.18 m to spare each side
    expect(codes(on(12, d[1] + 0.15))).toEqual([]);
  });
});

describe("crossing checks", () => {
  it("a 40° crossing is a warning", () => {
    const b = fixture("shallow-crossing").built!;
    expect(b.crossings![0].angle).toBeCloseTo(40, 1);
    expect(codes(bakeBuilt(fixture("shallow-crossing")))).toEqual(["crossing-angle"]);
  });

  it("two bridges whose footprints overlap are crossing-too-close; on the other passes they fit", () => {
    const d = bakeBuilt(track(TWICE, { radius: 1 })).crossings!.map((c) => c.distances[0]);
    const over = (o: "first" | "second") => bakeBuilt(track(TWICE, { radius: 1, features: d.map((x) => ({ type: "crossover" as const, distance: x, over: o })) }));
    expect(codes(over("first"))).toEqual(["crossing-too-close"]);
    expect(codes(over("second")).filter((c) => c.startsWith("crossing"))).toEqual([]);
  });
});

describe("fit search", () => {
  it("an adapted copy keeps its crossover on the crossing, whichever way round", () => {
    const t = fixture("crossover-figure8");
    const venue: RcVenue = { format: "rcvenue", version: 1, id: "v", revision: 1, info: { name: "Hall" }, area: { length: 18, width: 26 } };
    const res = fits(t, venue);
    expect(res.length).toBeGreaterThan(0);
    for (const fit of res) {
      const a = adapt(t, venue, fit, { id: "a" }).built!;
      expect(codes(a).filter((c) => c.startsWith("crossing"))).toEqual([]);
      const moved = transformBuilt(t.built!, fit);
      expect(Math.hypot(a.crossings![0].x - moved.crossings![0].x, a.crossings![0].z - moved.crossings![0].z)).toBeLessThan(0.01);
      const f = moved.features[0];
      for (const [x, z] of moved.crossings![0].footprint!) expect(Math.hypot(x - f.x, z - f.z)).toBeLessThan(f.length);
    }
  });
});

describe("tracks that don't cross themselves bake exactly as in 1.5", () => {
  // v15/: every fixture before crossings, and the engine's 1.5 bake of each (*.engine-built.json)
  const dir = join(extraDir, "..", "v15");
  const names = readdirSync(dir).filter((f) => f.endsWith(".rctrack.json")).sort();
  it("has fixtures", () => expect(names.length).toBeGreaterThanOrEqual(10));
  it.each(names)("%s", (name) => {
    const before = readJson<Built>(join(dir, name.replace(".rctrack.json", ".engine-built.json")));
    const after = bakeBuilt(readJson<RcTrack>(join(dir, name)));
    expect(JSON.stringify({ ...after, generator: "" })).toBe(JSON.stringify({ ...before, generator: "" }));
  });
});
