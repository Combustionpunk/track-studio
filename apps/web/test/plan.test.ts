import { fits, transformPt, type Built, type RcTrack, type RcVenue } from "@track-studio/engine";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as fmt from "../src/lib/format.js";
import { areaBounds, featureCorners, fitView, laneSegments, pan, rostrumPos, toPlan, transformBuilt, viewBox, zoomAt } from "../src/lib/plan.js";

const ref = <T,>(p: string) => JSON.parse(readFileSync(join(__dirname, "../../../reference", p), "utf8")) as T;

describe("view maths", () => {
  const area = { length: 22, width: 12 };
  it("fits the area plus margin into the box", () => {
    const v = fitView(areaBounds(area), 1080, 680);
    expect(v.cx).toBe(0);
    expect(v.cy).toBe(0);
    expect(v.s).toBeCloseTo(Math.min(1080 / 27, 680 / 17));
    expect(viewBox(v, 1080, 680)).toBe(`${-1080 / 2 / v.s} ${-680 / 2 / v.s} ${1080 / v.s} ${680 / v.s}`);
  });

  it("zooms around the cursor: the plan point under it stays put", () => {
    const v = fitView(areaBounds(area), 1000, 600);
    const before = toPlan(v, 700, 200, 1000, 600);
    const z = zoomAt(v, 2.5, 700, 200, 1000, 600, 1, 400);
    const after = toPlan(z, 700, 200, 1000, 600);
    expect(after[0]).toBeCloseTo(before[0], 9);
    expect(after[1]).toBeCloseTo(before[1], 9);
    expect(z.s).toBeCloseTo(v.s * 2.5);
    expect(zoomAt(v, 1000, 0, 0, 1000, 600, 1, 400).s).toBe(400); // clamped
  });

  it("pans by screen pixels; north is up", () => {
    const v = { cx: 0, cy: 0, s: 10 };
    expect(pan(v, 50, -20)).toEqual({ cx: -5, cy: 2, s: 10 });
    expect(toPlan(v, 500, 0, 1000, 600)[1]).toBe(30); // top of the box is +z (north)
  });
});

describe("drawing helpers", () => {
  const club = ref<RcTrack>("examples/club-a.rctrack.json");
  it("lane segments close the loop and carry the lane width", () => {
    const segs = laneSegments(club.built!.racingLine);
    expect(segs).toHaveLength(club.built!.racingLine.length);
    const last = segs[segs.length - 1], first = club.built!.racingLine[0];
    expect([last.x2, last.y2]).toEqual([first[0], -first[1]]);
    expect(Math.min(...segs.map((s) => s.w))).toBeGreaterThanOrEqual(1.8);
  });

  it("feature footprint is length × width around its centre", () => {
    const c = featureCorners({ x: 1, z: 2, heading: 90, length: 2, width: 1 });
    const xs = c.map((p) => p[0]), zs = c.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(2);
  });

  it("rostrum position matches the engine's", () => {
    const sports = ref<RcTrack>("examples/freeform-at-sports-hall-b.rctrack.json");
    const [x, z] = rostrumPos(sports.area, "south", 3);
    expect({ x, z }).toEqual({ x: sports.built!.rostrum.x, z: sports.built!.rostrum.z });
  });
});

describe("fit preview", () => {
  it("transformed built matches the adapted example (within rounding)", () => {
    const track = ref<RcTrack>("examples/freeform-example.rctrack.json");
    const venue = ref<RcVenue>("venues/sports-hall-b.rcvenue.json");
    const adapted = ref<RcTrack>("examples/freeform-at-sports-hall-b.rctrack.json");
    const [fit] = fits(track, venue);
    const moved: Built = transformBuilt(track.built!, fit);
    // the copy is re-baked from the moved design; drawing the moved geometry must land in the same place
    expect(moved.racingLine.length).toBe(adapted.built!.racingLine.length);
    const near = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const worst = Math.max(...moved.racingLine.map((p) => Math.min(...adapted.built!.racingLine.map((q) => near(p, q)))));
    expect(worst).toBeLessThan(0.15); // same line, sampled from a different start
    moved.features.forEach((f, i) => {
      expect(near([f.x, f.z], [adapted.built!.features[i].x, adapted.built!.features[i].z])).toBeLessThan(0.02);
      expect(Math.abs(((f.heading - adapted.built!.features[i].heading + 540) % 360) - 180)).toBeLessThan(0.5);
    });
  });

  it("mirroring flips x before rotating", () => {
    expect(transformPt(1, 2, 0, true)).toEqual([-1, 2]);
  });
});

describe("format", () => {
  it("shows whole metres for size and lap, precise on request", () => {
    expect(fmt.size({ length: 22, width: 11.8 })).toBe("22 × 12 m");
    expect(fmt.size({ length: 22, width: 11.8 }, true)).toBe("22 × 11.8 m");
    expect(fmt.size(null)).toBe("—");
    expect(fmt.lap(124.036)).toBe("124 m");
    expect(fmt.corners(1)).toBe("1 corner");
    expect(fmt.spare({ orientation: "x", rotation: 0, mirror: false, shift: [0, 0], spare: [0.1, 0.3] })).toBe("0.1 × 0.3 m spare");
    expect(fmt.slug("Club A @ Hall!")).toBe("club-a-hall");
  });
});
