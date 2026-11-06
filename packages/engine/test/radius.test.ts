// How a corner's radius shrinks to fit (rctrack v1.5): corners share each straight by what they need.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bakeBuilt, racingLine, type Corner, type DesignPoint, type RcTrack } from "../src/index.js";
import { as17, extraDir, readJson } from "./helpers.js";

const track = (points: DesignPoint[], laneWidth = 2): RcTrack => ({
  format: "rctrack", version: 1, id: "t", revision: 1, info: { name: "t" }, area: { length: 40, width: 30 }, design: { laneWidth, points },
});
const corners = (points: DesignPoint[]) => racingLine(points, 2).corners;
const tangent = (c: Corner) => Math.hypot(c.P[0] - c.start[0], c.P[1] - c.start[1]); // length taken from each straight
const reduced = (points: DesignPoint[]) => bakeBuilt(track(points)).checks.filter((k) => k.code === "radius-reduced");

describe("corner radius shrinks to fit", () => {
  it("(a) a hairpin pair (two 90° points 2 m apart, r = 1) fits with no radius-reduced", () => {
    const pts = [{ x: -10, z: -1, radius: 1 }, { x: 10, z: -1, radius: 1 }, { x: 10, z: 1, radius: 1 }, { x: -10, z: 1, radius: 1 }];
    expect(reduced(pts)).toEqual([]);
    for (const c of corners(pts)) expect(c.r).toBeCloseTo(1, 9);
  });

  it("(b) a 4.5 m corner next to a 1 m corner on a 6 m straight gets more than half the straight", () => {
    // 6 m straight along the south side between the 4.5 m sweeper (SW) and a 1 m corner (SE); the other straights are 10 m
    const pts = [{ x: -3, z: -5, radius: 4.5 }, { x: 3, z: -5, radius: 1 }, { x: 3, z: 5, radius: 1 }, { x: -3, z: 5, radius: 1 }];
    const [sweeper, next] = corners(pts);
    expect(tangent(sweeper)).toBeGreaterThan(3);
    expect(sweeper.r).toBeCloseTo(4.5, 9); // 4.5 + 1 <= 6: both get what they ask for
    expect(next.r).toBeCloseTo(1, 9);
    expect(reduced(pts)).toEqual([]);
  });

  it("(c) two corners both asking for too much are cut in proportion and never overlap", () => {
    // 4 m straight on the south side; 90° corners asking for r = 4 (t = 4) and r = 2 (t = 2): f = 4 / 6
    const pts = [{ x: -2, z: -6, radius: 4 }, { x: 2, z: -6, radius: 2 }, { x: 2, z: 6, radius: 1 }, { x: -2, z: 6, radius: 1 }];
    const c = corners(pts);
    expect(tangent(c[0])).toBeCloseTo((4 * 4) / 6, 9);
    expect(tangent(c[1])).toBeCloseTo((2 * 4) / 6, 9);
    expect(c[0].r).toBeCloseTo((4 * 4) / 6, 9);
    expect(tangent(c[0]) + tangent(c[1])).toBeLessThanOrEqual(4 + 1e-9);
    const r = reduced(pts);
    expect(r.map((k) => [k.x, k.z])).toEqual([[-2, -6], [2, -6]]);
  });

  it("(c) a corner squeezed on both straights takes the tighter share; no straight is ever overrun", () => {
    // NE corner (r = 3, t = 3) shares a 4 m straight with SE (t = 2) and a 5 m straight with NW (t = 3)
    const pts = [{ x: -2.5, z: -2, radius: 0.5 }, { x: 2.5, z: -2, radius: 2 }, { x: 2.5, z: 2, radius: 3 }, { x: -2.5, z: 2, radius: 3 }];
    const c = corners(pts);
    const fSouth = 1, fEast = 4 / (2 + 3), fNorth = 5 / (3 + 3), fWest = 1; // south 5 m (2 + 0.5), west 4 m (3 + 0.5) fit
    expect(tangent(c[2])).toBeCloseTo(3 * Math.min(fEast, fNorth), 9);
    expect(tangent(c[3])).toBeCloseTo(3 * Math.min(fNorth, fWest), 9);
    expect(tangent(c[1])).toBeCloseTo(2 * Math.min(fSouth, fEast), 9);
    for (let i = 0; i < c.length; i++) {
      const j = (i + 1) % c.length;
      const L = Math.hypot(c[j].P[0] - c[i].P[0], c[j].P[1] - c[i].P[1]);
      expect(tangent(c[i]) + tangent(c[j])).toBeLessThanOrEqual(L + 1e-9);
    }
  });
});

describe("designs with no squeezed corners bake exactly as in 1.4", () => {
  // v14/: tracks with no radius-reduced check, and the engine's 1.4 bake of each (*.engine-built.json)
  const dir = join(extraDir, "..", "v14");
  const names = readdirSync(dir).filter((f) => f.endsWith(".rctrack.json")).sort();
  it("has fixtures", () => expect(names.length).toBeGreaterThan(0));
  it.each(names)("%s", (name) => {
    const doc = readJson<RcTrack>(join(dir, name));
    expect(doc.built!.checks.some((k) => k.code === "radius-reduced")).toBe(false);
    const before = readJson<RcTrack["built"]>(join(dir, name.replace(".rctrack.json", ".engine-built.json")))!;
    const after = bakeBuilt(doc);
    expect(JSON.stringify(as17(after))).toBe(JSON.stringify(as17(before))); // less the venue's parts (1.7)
  });
});
