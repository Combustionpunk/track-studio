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
    expect(c.z).toBeCloseTo(-3.8, 2);
    expect(c.x!).toBeGreaterThan(-1);
    expect(c.x!).toBeLessThan(4);
  });

  it("two straights sharing a pipe touch: no error", () => {
    const b = bakeBuilt(extra("shared-straights"));
    expect(b.dividers.some((d) => d.shared)).toBe(true);
    expect(overlaps(b)).toEqual([]);
  });

  it("a tight hairpin (a 164° V, its inside collapsed to the apex) meets itself: no error", () => {
    expect(overlaps(bakeBuilt(extra("tight-hairpin")))).toEqual([]);
  });

  it.each(["crossover-figure8", "unbridged-figure8", "shallow-crossing", "two-crossings"])("%s: no error at the crossing", (name) => {
    const b = bakeBuilt(extra(name));
    expect(b.crossings?.length).toBeGreaterThan(0);
    expect(overlaps(b)).toEqual([]);
  });

  it("the #82 case: a straight back west whose square corner clips a 45° diagonal", () => {
    const c = overlaps(bakeBuilt(extra("diagonal-clip")));
    expect(c.map((x) => [x.level, x.message])).toEqual([["error", "Lanes overlap by 0.82 m here"]]);
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
