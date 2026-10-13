// The engine must reproduce reference/bake.py: every example's `built` is re-baked from `design` and compared.
import { describe, expect, it } from "vitest";
import { bakeBuilt, compareBuilt, distanceToPolyline, dividers, racingLine, SIMPLIFY_TOL, type RcTrack } from "../src/index.js";
import { allTracks, readJson } from "./helpers.js";

const TOL = 0.01; // 1 cm
const CELL = 0.1;

describe.each(allTracks)("bake $name", ({ path }) => {
  const doc = readJson<RcTrack>(path);
  const expected = doc.built!;
  const actual = bakeBuilt(doc);
  const diff = compareBuilt(actual, expected);

  it("lap length within 1 cm", () => {
    expect(diff.lapLength).toBeLessThanOrEqual(TOL);
  });

  it("racing line within 1 cm", () => {
    expect(diff.racingLineCount[0]).toBe(diff.racingLineCount[1]);
    expect(diff.racingLineMax).toBeLessThanOrEqual(TOL);
    expect(diff.racingWidthMax).toBeLessThanOrEqual(TOL);
  });

  it("dividers: same runs, same pipe within 1 cm", () => {
    expect(diff.dividerCount[0]).toBe(diff.dividerCount[1]);
    // Every reference divider vertex lies on our unsimplified run: the pipe geometry is the same.
    const { line } = racingLine(doc.design.points, doc.design.laneWidth ?? 2.0);
    const dense = dividers(line).runs;
    expected.dividers.forEach((d, i) => {
      expect(diff.dividers[i].sameFlags).toBe(true);
      const worst = Math.max(...d.points.map((p) => distanceToPolyline(p, dense[i])));
      expect(worst).toBeLessThanOrEqual(TOL);
    });
  });

  it("dividers: simplified polylines agree (RDP ties aside)", () => {
    // RDP picks the point furthest from the chord; on symmetric arc spans the top two candidates differ by ~1e-16,
    // so last-bit differences in sin/cos can pick the other one. Both results are within SIMPLIFY_TOL of the same pipe.
    for (const d of diff.dividers) expect(d.maxDist).toBeLessThanOrEqual(2 * SIMPLIFY_TOL);
  });

  it("same check codes", () => {
    expect(diff.checks[0]).toEqual(diff.checks[1]);
  });

  it("footprint bbox within one cell", () => {
    expect(diff.footprint.bboxMax).toBeLessThanOrEqual(CELL + 1e-9);
  });

  it("features, start line, rostrum and stats match", () => {
    expect(diff.features.maxPos).toBeLessThanOrEqual(TOL);
    expect(diff.features.maxHeading).toBeLessThanOrEqual(0.5);
    expect(diff.features.otherSame).toBe(true);
    expect(diff.startLine.pos).toBeLessThanOrEqual(TOL);
    expect(diff.startLine.heading).toBeLessThanOrEqual(0.5);
    expect(diff.startLine.width).toBeLessThanOrEqual(TOL);
    expect(diff.rostrum).toBe(0);
    expect(diff.stats.dividerRuns[0]).toBe(diff.stats.dividerRuns[1]);
    expect(diff.stats.corners[0]).toBe(diff.stats.corners[1]);
    expect(diff.stats.dividerLength).toBeLessThanOrEqual(0.05);
  });
});
