// rctrack 1.10 (#102): a lane squeezed against a shared pipe at a corner is a warning, `lane-squeeze` ("Lane narrows by
// X m at this corner"), not a lane-overlap error; overlaps of up to 5 cm between lanes sharing a pipe are rounding.
import { join } from "node:path";
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bakeBuilt, OVERLAP_TOL, type Built, type Check, type RcTrack } from "../src/index.js";
import { allTracks, as17, extraDir, readJson } from "./helpers.js";

const extra = (name: string) => readJson<RcTrack>(join(extraDir, `${name}.rctrack.json`));
const laneChecks = (b: Built): Check[] => b.checks.filter((c) => c.code === "lane-overlap" || c.code === "lane-squeeze");
const errors = (b: Built): Check[] => b.checks.filter((c) => c.level === "error");

describe("the production layout \"Test\" (8 Nov 2026)", () => {
  // the only stored layout on production: 1.9 gave it three lane-overlap errors, two of 2-3 cm between lanes sharing a
  // pipe (rounding) and one of 0.35 m where the outer lane's sweeper and the inner hairpin lane share a pipe at the
  // bottom-left corner, both corners squeezed to different curves
  const b = bakeBuilt(extra("test-squeezed-corner"));

  it("gives 0 errors and exactly 1 lane-squeeze warning", () => {
    expect(errors(b)).toEqual([]);
    expect(laneChecks(b).map((c) => [c.level, c.code, c.message])).toEqual([["warning", "lane-squeeze", "Lane narrows by 0.35 m at this corner"]]);
  });

  it("places the warning at the bottom-left shared corner, and keeps the other checks", () => {
    const [c] = laneChecks(b);
    expect(c.x).toBeCloseTo(-8.2, 0);
    expect(c.z).toBeCloseTo(-3.1, 0);
    expect(b.checks.filter((c) => c.code === "radius-reduced")).toHaveLength(4);
  });

  it("matches the Python reference's bake", () => {
    const doc = extra("test-squeezed-corner");
    expect(doc.built!.checks.map((c) => [c.level, c.code, c.message])).toEqual(b.checks.map((c) => [c.level, c.code, c.message]));
  });
});

describe("the shared-pipe allowance is 5 cm", () => {
  it("is documented as OVERLAP_TOL", () => expect(OVERLAP_TOL).toBe(0.05));

  it("straights 1.96 m apart (a 4 cm overlap) are clean", () => {
    expect(laneChecks(bakeBuilt(extra("shared-straights-4cm")))).toEqual([]);
  });

  it("straights 1.94 m apart (a 6 cm overlap) are a lane-overlap error", () => {
    expect(laneChecks(bakeBuilt(extra("shared-straights-6cm"))).map((c) => [c.level, c.code, c.message])).toEqual([["error", "lane-overlap", "Lanes overlap by 0.06 m here"]]);
  });
});

describe("true overlaps are still lane-overlap errors", () => {
  it.each([
    ["overlap-straights", "Lanes overlap by 0.60 m here"],
    ["overlap-beside-crossing", "Lanes overlap by 0.60 m here"],
    ["diagonal-clip", "Lanes overlap by 0.17 m here"],
  ])("%s", (name, message) => {
    expect(laneChecks(bakeBuilt(extra(name))).map((c) => [c.level, c.code, c.message])).toEqual([["error", "lane-overlap", message]]);
  });

  it("a hairpin leg squeezed to 1.0 m above the main straight (1.9's Advanced-mode case) is an error", () => {
    const doc = extra("shared-straights");
    const pts = doc.design.points.map((p) => (p.z === -2.5 ? { ...p, z: -3.5, radius: 0.5 } : p));
    const c = laneChecks(bakeBuilt({ ...doc, design: { ...doc.design, points: pts } }));
    expect(c.map((x) => [x.level, x.code, x.message])).toEqual([["error", "lane-overlap", "Lanes overlap by 1.00 m here"]]);
  });

  it("hairpin legs 1 m apart (half a lane) are an error, though their corners overlap too and pipes are drawn between them", () => {
    // the Quick-mode case in apps/web's lanes test: every pair along the legs is 1.00 m deep, the first of them at the
    // corners the legs start from; an overlap along straights is never a squeeze
    const pts = [[-10, -5], [10, -5], [10, 5], [1, 5], [1, -1], [0, -1], [0, 5], [-10, 5]].map(([x, z]) => ({ x, z, radius: 1 }));
    const doc: RcTrack = { format: "rctrack", version: 1, id: "legs", revision: 1, info: { name: "legs" }, area: { length: 22, width: 12 }, design: { laneWidth: 2, points: pts, start: { distance: 3 } } };
    expect(laneChecks(bakeBuilt(doc)).map((c) => [c.level, c.code, c.message])).toEqual([["error", "lane-overlap", "Lanes overlap by 1.00 m here"]]);
  });

  it("a third pass running into the hairpin still gives two overlaps", () => {
    const doc = extra("overlap-straights");
    const pts = [...doc.design.points.slice(0, 4), { x: -5, z: 4.5, radius: 1 }, { x: 10.4, z: 4.5, radius: 1 }, { x: 10.4, z: -8, radius: 1 }, { x: -9, z: -8, radius: 1 }];
    const c = laneChecks(bakeBuilt({ ...doc, design: { ...doc.design, points: pts } }));
    expect(c.map((x) => [x.level, x.code])).toEqual([["error", "lane-overlap"], ["error", "lane-overlap"]]);
  });
});

describe("lanes that meet without overlapping stay clean", () => {
  it.each(["shared-straights", "nested-corners", "tight-hairpin", "crossover-figure8", "unbridged-figure8", "shallow-crossing", "two-crossings", "missed-crossing", "peel-round", "peel-square", "switchbacks"])("%s", (name) => {
    expect(laneChecks(bakeBuilt(extra(name)))).toEqual([]);
  });
});

describe("TS matches the Python reference", () => {
  it.each(allTracks)("$name: same lane-overlap and lane-squeeze checks, positions within 1 cm", ({ path }) => {
    const doc = readJson<RcTrack>(path);
    const want = laneChecks(doc.built!), got = laneChecks(bakeBuilt(doc));
    expect(got.map((c) => [c.level, c.code, c.message])).toEqual(want.map((c) => [c.level, c.code, c.message]));
    got.forEach((c, i) => expect(Math.hypot(c.x! - want[i].x!, c.z! - want[i].z!)).toBeLessThanOrEqual(0.01));
  });
});

describe("1.8 bakes", () => {
  // v18/: the reference examples and extras as bake.py 1.8 baked them. None has lanes that overlap or squeeze.
  const dir = join(extraDir, "..", "v18");
  const files = readdirSync(dir).filter((f) => f.endsWith(".rctrack.json")).sort();
  it.each(files)("%s: same checks as 1.8", (name) => {
    const doc = readJson<RcTrack>(join(dir, name));
    expect(bakeBuilt(doc).checks).toEqual(as17(doc.built!).checks);
  });
});
