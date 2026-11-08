// rctrack 1.9 (#95): lane-overlap, an error where the lane of one part of the lap runs into the lane of another.
import { join } from "node:path";
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bakeBuilt, type Built, type Check, type RcTrack } from "../src/index.js";
import { allTracks, as17, extraDir, readJson } from "./helpers.js";

const extra = (name: string) => readJson<RcTrack>(join(extraDir, `${name}.rctrack.json`));
const overlaps = (b: Built): Check[] => b.checks.filter((c) => c.code === "lane-overlap");

describe("lane-overlap fixtures", () => {
  it("two straights 1.4 m apart with a 2 m lane overlap by 0.6 m, at the middle of the overlap", () => {
    const [c, ...rest] = overlaps(bakeBuilt(extra("overlap-straights")));
    expect(rest).toEqual([]);
    expect(c).toMatchObject({ level: "error", code: "lane-overlap", message: "Lanes overlap by 0.60 m here" });
    // between the main straight (z -4.5) and the hairpin leg (z -3.1), along the 14 m they run side by side
    expect(c.z).toBeCloseTo(-3.8, 1);
    expect(c.x!).toBeGreaterThan(-1);
    expect(c.x!).toBeLessThan(4);
  });

  it("two straights sharing a pipe touch, through a tight (0.6 m) hairpin: no error", () => {
    // the hairpin leg runs a lane width (2 m) above the main straight: one pipe between them
    expect(overlaps(bakeBuilt(extra("shared-straights")))).toEqual([]);
  });

  it("a sharp V (a 164° hairpin drawn as one corner, its inside collapsed to the apex) meets itself: no error", () => {
    expect(overlaps(bakeBuilt(extra("tight-hairpin")))).toEqual([]);
  });

  it("a sweeper round a tighter corner, a lane apart, shares a pipe: no error (the square mitre doesn't count)", () => {
    const b = bakeBuilt(extra("nested-corners"));
    expect(b.dividers.some((d) => d.shared)).toBe(true);
    expect(overlaps(b)).toEqual([]);
  });

  it("a third pass running into the hairpin gives a second overlap, each placed between its own lanes", () => {
    // overlap-straights with its west loop pushed out east, so its back straight comes down 1.4 m past the hairpin
    const doc = extra("overlap-straights");
    const pts = [...doc.design.points.slice(0, 4), { x: -5, z: 4.5, radius: 1 }, { x: 10.4, z: 4.5, radius: 1 }, { x: 10.4, z: -8, radius: 1 }, { x: -9, z: -8, radius: 1 }];
    const c = overlaps(bakeBuilt({ ...doc, design: { ...doc.design, points: pts } }));
    // (bake.py: (1.561, -3.794) and (9.621, -3.794))
    expect(c.map((x) => x.message)).toEqual(["Lanes overlap by 0.60 m here", "Lanes overlap by 0.60 m here"]);
    expect(c[0]).toMatchObject({ x: expect.closeTo(1.56, 2), z: expect.closeTo(-3.79, 2) }); // the main straight and the leg
    expect(c[1]).toMatchObject({ x: expect.closeTo(9.62, 2), z: expect.closeTo(-3.79, 2) }); // the back straight and the bend
  });

  it.each(["crossover-figure8", "unbridged-figure8", "shallow-crossing", "two-crossings"])("%s: no error at the crossing", (name) => {
    const b = bakeBuilt(extra(name));
    expect(b.crossings?.length).toBeGreaterThan(0);
    expect(overlaps(b)).toEqual([]);
  });

  // #100: a figure of eight whose crossing falls on a racing-line sample. 1.9 as merged missed the crossing, so it
  // reported a 1.93 m lane-overlap there and the crossover on it as crossover-unused: a legitimate layout couldn't pass.
  it("a crossing on a racing-line sample is a crossing, not a lane-overlap: bridged, the layout is clean (#100)", () => {
    const b = bakeBuilt(extra("missed-crossing"));
    expect(b.crossings).toHaveLength(1);
    expect(b.crossings![0]).toMatchObject({ x: 0, z: 0, over: "first", bridge: { type: "crossover", feature: 0 } });
    expect(b.checks.filter((c) => c.code !== "radius-reduced")).toEqual([]);
  });

  it("the same figure of eight without the crossover is crossing-unbridged, not lane-overlap (#100)", () => {
    const doc = extra("missed-crossing");
    const b = bakeBuilt({ ...doc, design: { ...doc.design, features: [] } });
    expect(b.checks.map((c) => c.code)).toEqual(["crossing-unbridged"]);
  });

  it("a genuine overlap next to a crossover, not on its crossing, is still reported (#100)", () => {
    // a loop crossing once at the origin, bridged on the main straight (the crossover spans x -4..4), with a hairpin
    // leg 1.4 m above the main straight from x 5 to 10
    const b = bakeBuilt(extra("overlap-beside-crossing"));
    expect(b.crossings).toHaveLength(1);
    expect(b.crossings![0]).toMatchObject({ x: 0, z: 0, bridge: { type: "crossover", feature: 0 } });
    expect(b.checks.map((c) => [c.level, c.code, c.message])).toEqual([["error", "lane-overlap", "Lanes overlap by 0.60 m here"]]);
    expect(b.checks[0]).toMatchObject({ x: expect.closeTo(6.86, 1), z: expect.closeTo(0.72, 1) }); // between the main straight and the leg, east of the bridge
  });

  it("the #82 case: a straight back west whose corner clips a 45° diagonal", () => {
    const c = overlaps(bakeBuilt(extra("diagonal-clip")));
    expect(c.map((x) => [x.level, x.message])).toEqual([["error", "Lanes overlap by 0.17 m here"]]);
  });

  it("is an error, so a layout drawn in Advanced mode with lanes run together can't pass", () => {
    const doc = extra("shared-straights");
    // squeeze the hairpin leg down to 1.0 m above the main straight
    const pts = doc.design.points.map((p) => (p.z === -2.5 ? { ...p, z: -3.5, radius: 0.5 } : p));
    const c = overlaps(bakeBuilt({ ...doc, design: { ...doc.design, points: pts } }));
    expect(c.map((x) => [x.level, x.message])).toEqual([["error", "Lanes overlap by 1.00 m here"]]);
  });
});

describe("TS matches the Python reference", () => {
  it.each(allTracks)("$name: same lane-overlap checks, positions within 1 cm", ({ path }) => {
    const doc = readJson<RcTrack>(path);
    const want = overlaps(doc.built!), got = overlaps(bakeBuilt(doc));
    expect(got.map((c) => [c.level, c.message])).toEqual(want.map((c) => [c.level, c.message]));
    got.forEach((c, i) => expect(Math.hypot(c.x! - want[i].x!, c.z! - want[i].z!)).toBeLessThanOrEqual(0.01));
  });
});

describe("1.8 bakes", () => {
  // v18/: the reference examples and extras as bake.py 1.8 baked them. None has lanes that overlap, so none changes.
  const dir = join(extraDir, "..", "v18");
  const files = readdirSync(dir).filter((f) => f.endsWith(".rctrack.json")).sort();
  it("has 1.8 fixtures", () => expect(files.length).toBeGreaterThanOrEqual(20));
  it.each(files)("%s: same checks as 1.8, no lane-overlap", (name) => {
    const doc = readJson<RcTrack>(join(dir, name));
    const got = bakeBuilt(doc);
    expect(got.checks).toEqual(as17(doc.built!).checks);
    expect(overlaps(got)).toEqual([]);
  });
});
