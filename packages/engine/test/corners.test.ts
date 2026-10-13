// Corner count (racer's count) and size, rctrack v1.2.
import { describe, expect, it } from "vitest";
import { bakeBuilt, countCorners, racingLine, type DesignPoint, type RcTrack } from "../src/index.js";
import { examples, readJson } from "./helpers.js";

const track = (points: DesignPoint[], laneWidth = 2): RcTrack => ({
  format: "rctrack", version: 1, id: "t", revision: 1, info: { name: "t" }, area: { length: 40, width: 30 }, design: { laneWidth, points },
});
const corners = (points: DesignPoint[]) => countCorners(racingLine(points, 2).corners);
const ex = (name: string) => readJson<RcTrack>(examples.find((e) => e.name === name)!.path);

describe("corner count", () => {
  it("counts the reference examples like a racer", () => {
    expect(bakeBuilt(ex("club-a.rctrack.json")).stats.corners).toBe(12); // 18 corner points
    expect(bakeBuilt(ex("freeform-example.rctrack.json")).stats.corners).toBe(9); // 12 corner points
  });

  it("a rectangle with long straights has 4 corners", () => {
    expect(corners([{ x: -10, z: -5 }, { x: 10, z: -5 }, { x: 10, z: 5 }, { x: -10, z: 5 }])).toBe(4);
  });

  it("a hairpin drawn as two 90° points is one corner", () => {
    // long rectangle with one end pinched into two points 2 m apart
    const pts = [{ x: -10, z: -1 }, { x: 10, z: -1 }, { x: 10, z: 1 }, { x: -10, z: 1 }];
    expect(corners(pts)).toBe(2);
  });

  it("turn - short straight - turn the same way is one corner; the opposite way is two", () => {
    // right-hand 90, 2.5 m straight (after tangents), right-hand 90 again
    const same = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 4.5, radius: 1 }, { x: 0, z: 4.5, radius: 1 }];
    expect(corners(same)).toBe(2);
    const chicane = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 6 }, { x: 13, z: 9 }, { x: 13, z: 14 }, { x: 0, z: 14 }];
    const c = racingLine(chicane, 2).corners;
    expect(c.filter((k) => k.th > (20 * Math.PI) / 180).length).toBe(6);
    expect(countCorners(c)).toBe(6); // the 45° left/right flick isn't merged
  });

  it("the 3 m limit: 2.9 m of straight joins, 3.1 m doesn't", () => {
    // two right-angle turns with radius 1: straight between them = side - 2
    const box = (side: number) => [{ x: 0, z: 0 }, { x: 20, z: 0 }, { x: 20, z: side }, { x: 0, z: side }];
    expect(corners(box(4.9))).toBe(2);
    expect(corners(box(5.1))).toBe(4);
  });

  it("small turns don't count and don't break a chain", () => {
    expect(corners([{ x: 0, z: 0 }, { x: 10, z: 0.5 }, { x: 20, z: 0 }, { x: 20, z: 10 }, { x: 0, z: 10 }])).toBe(4);
  });

  it("a single continuous turn is 1", () => {
    const circle = Array.from({ length: 12 }, (_, i) => ({ x: 3 * Math.cos((i * Math.PI) / 6), z: 3 * Math.sin((i * Math.PI) / 6), radius: 1 }));
    expect(corners(circle)).toBe(1);
  });
});

describe("size", () => {
  it("is the lane edges, without pipe padding", () => {
    const b = bakeBuilt(ex("club-a.rctrack.json"));
    expect(b.size).toEqual({ length: 22, width: 11.8, bbox: [-11, -5.9, 11, 5.9] });
    // the footprint (fit checks) is padded: pipe radius + one cell each side
    expect(b.footprint.bbox[2] - b.footprint.bbox[0]).toBeGreaterThan(b.size!.length);
  });

  it("follows per-point widths", () => {
    const b = bakeBuilt(track([{ x: -10, z: -5, width: 3 }, { x: 10, z: -5, width: 3 }, { x: 10, z: 5, width: 1.5 }, { x: -10, z: 5, width: 1.5 }]));
    expect(b.size!.bbox[1]).toBeCloseTo(-6.5, 3);
    expect(b.size!.bbox[3]).toBeCloseTo(5.75, 3);
  });
});
