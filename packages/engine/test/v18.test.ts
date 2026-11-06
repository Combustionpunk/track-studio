// rctrack 1.8 (#81): a jump across lap distance 0 is checked for corners (#62); a jump in a corner is info, a
// crossover's ramps in one still a warning; the start line's heading is the true tangent at a corner join (#69).
import { join } from "node:path";
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bakeBuilt, reverseDesign, type Built, type DesignFeature, type RcTrack } from "../src/index.js";
import { as18, extraDir, readJson } from "./helpers.js";

const pyMod = (a: number, b: number) => ((a % b) + b) % b;
const angleDiff = (a: number, b: number) => Math.abs(pyMod(a - b + 540, 360) - 180);

/** 18 × 8 m rectangle, 2 m corners. Lap distance 0 is where point 0's corner arc starts, coming up the west straight. */
const track = (features: DesignFeature[], start = 0): RcTrack => ({
  format: "rctrack", version: 1, id: "t", revision: 1, info: { name: "t" },
  design: {
    laneWidth: 2, points: [[-9, -4], [9, -4], [9, 4], [-9, 4]].map(([x, z]) => ({ x, z, radius: 2 })), features,
    start: { distance: start },
  },
});
const inCorner = (b: Built) => b.checks.filter((c) => c.code === "feature-in-corner");

describe("feature-in-corner across lap distance 0", () => {
  // centred 1.5 m before lap distance 0; it lands across 0 into point 0's corner
  it("a tabletop spanning lap distance 0 next to a corner gets it, as info", () => {
    const b = bakeBuilt(track([{ type: "tabletop", distance: -1.5 }]));
    expect(inCorner(b)).toEqual([{ level: "info", code: "feature-in-corner", x: -9, z: -0.5, message: "Tabletop at -1.5 m is on or lands into a corner (technical section)" }]);
  });

  // 0.8 m before 0, so even a 0.5 m bump's span (to 1 m past its end) runs across 0
  it.each(["double", "kicker", "stepup", "stepdown", "whoops", "bump"] as const)("so does a %s", (type) => {
    expect(inCorner(bakeBuilt(track([{ type, distance: -0.8 }]))).map((c) => c.level)).toEqual(["info"]);
  });

  it("a crossover in the same place gets it as a warning", () => {
    const b = bakeBuilt(track([{ type: "crossover", distance: -1.5, rampLength: 1, topLength: 0.5 }]));
    expect(inCorner(b)).toEqual([{ level: "warning", code: "feature-in-corner", x: -9, z: -0.5, message: "crossover at -1.5 m is on or lands into a corner" }]);
  });

  it("a jump on a straight gets nothing", () => {
    expect(inCorner(bakeBuilt(track([{ type: "tabletop", distance: 9 }, { type: "tabletop", distance: -2.6 }])))).toEqual([]);
  });

  it("names the jump the way people do", () => {
    expect(inCorner(bakeBuilt(track([{ type: "stepup", distance: -1.5 }])))[0].message).toBe("Step-up at -1.5 m is on or lands into a corner (technical section)");
  });
});

describe("start line at a corner join", () => {
  it("faces along the straight, not into the arc", () => {
    // the west straight runs south (270°) into point 0's corner
    expect(bakeBuilt(track([])).startLine).toMatchObject({ x: -9, z: -2, heading: 270 });
  });

  it.each([
    ["the rectangle", track([])],
    ["two-crossings", readJson<RcTrack>(join(extraDir, "two-crossings.rctrack.json"))],
    ["jump-across-start", readJson<RcTrack>(join(extraDir, "jump-across-start.rctrack.json"))],
  ])("%s reversed gives the same line, facing the other way, within 0.01°", (_, doc) => {
    expect(doc.design.start?.distance).toBe(0);
    const a = bakeBuilt(doc).startLine, b = bakeBuilt({ ...doc, design: reverseDesign(doc.design) }).startLine;
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThanOrEqual(0.01);
    expect(angleDiff(a.heading, b.heading + 180)).toBeLessThan(0.01);
  });
});

describe("1.7 bakes", () => {
  // v17/: the reference examples and extras as bake.py 1.7 baked them. None has a jump across lap distance 0 next to a
  // corner or a start on a corner join, so 1.8 changes only a jump's feature-in-corner level and message.
  const dir = join(extraDir, "..", "v17");
  const files = readdirSync(dir).filter((f) => f.endsWith(".rctrack.json")).sort();
  it("has 1.7 fixtures", () => expect(files.length).toBeGreaterThanOrEqual(18));
  it.each(files)("%s: same checks and start line as 1.7, a jump in a corner as info", (name) => {
    const doc = readJson<RcTrack>(join(dir, name));
    const want = as18(doc.built!), got = bakeBuilt(doc);
    expect(got.checks).toEqual(want.checks);
    expect(got.startLine).toEqual(want.startLine);
  });
});
