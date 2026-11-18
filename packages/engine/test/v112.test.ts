// rctrack 1.12 (#155, the Board's answer of 18 Nov 2026): club pipe is 0.065 m square in section, not 0.08 m round. The
// footprint pads the lanes by half of it, 0.0325 m (was 0.04 m). Re-baking a 1.11 layout changes its footprint and
// nothing else: the raster keeps its frame (FOOT_MARGIN), so cells are only uncovered, never added or moved.
import { join } from "node:path";
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bakeBuilt, FOOT_MARGIN, GENERATOR, PIPE_SIZE, unrle, type Built, type RcTrack } from "../src/index.js";
import { as17, extraDir, readJson } from "./helpers.js";

// bakes stored by older engines, with the 0.04 m pad: the reference examples as 1.10 baked them, and everything 1.8 baked
const old = ["v110", "v18"].flatMap((v) => {
  const dir = join(extraDir, "..", v);
  return readdirSync(dir).filter((f) => f.endsWith(".rctrack.json")).sort().map((f) => ({ name: `${v}/${f}`, doc: readJson<RcTrack>(join(dir, f)) }));
});
const cells = (b: Built) => unrle(b.footprint.rle, b.footprint.rows * b.footprint.cols);

describe("rctrack 1.12: a 0.065 m square pipe", () => {
  it("is one constant, and the generator says 1.12", () => {
    expect(PIPE_SIZE).toBe(0.065);
    expect(FOOT_MARGIN).toBe(0.04);
    expect(GENERATOR).toMatch(/ 1\.12$/);
  });

  it("has older bakes to compare with", () => expect(old.length).toBeGreaterThanOrEqual(20));

  it.each(old)("$name: the footprint keeps its frame and only loses cells", ({ doc }) => {
    const before = doc.built!, after = bakeBuilt(doc);
    const { rle: _a, ...frameAfter } = after.footprint, { rle: _b, ...frameBefore } = before.footprint;
    expect(frameAfter).toEqual(frameBefore);
    const was = cells(before), now = cells(after);
    let lost = 0;
    for (let k = 0; k < was.length; k++) {
      if (now[k] && !was[k]) throw new Error(`cell ${k} is covered in 1.12 and was not before`);
      if (was[k] && !now[k]) lost++;
    }
    // at most the cells along the edges: a strip 7.5 mm wide is a small part of the cells the lanes cover
    expect(lost).toBeLessThan(was.reduce((n, c) => n + c, 0) * 0.02);
  });

  it("uncovers cells on some of them (the pad really is thinner)", () => {
    const lost = old.map(({ doc }) => cells(doc.built!).reduce((n, c) => n + c, 0) - cells(bakeBuilt(doc)).reduce((n, c) => n + c, 0));
    expect(lost.filter((n) => n > 0).length).toBeGreaterThan(old.length / 2);
  });

  // (bake.py is checked for "nothing but the footprint changes" by gen_fixtures.py, exactly; the engine's own older
  // bakes by the 1.4 and 1.5 comparisons in radius.test.ts and crossings.test.ts)
  it.each(old)("$name: the same checks, word for word", ({ doc }) => {
    expect(as17(bakeBuilt(doc)).checks).toEqual(as17(doc.built!).checks);
  });
});
