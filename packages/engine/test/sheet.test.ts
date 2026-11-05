// The build sheet's figures (src/sheet.ts): what marshals lay a track out from, measured from the south-west corner.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bakeBuilt, buildSheet, distanceToPolyline, fromSouthWest, planLayers, planScene, PRINT_PALETTE, type RcTrack } from "../src/index.js";
import { allTracks, examples, readJson, repoRoot } from "./helpers.js";

const ex = (name: string) => readJson<RcTrack>(examples.find((e) => e.name === name)!.path);
const track = (points: { x: number; z: number; radius?: number }[], area = { length: 40, width: 30 }): RcTrack => {
  const doc: RcTrack = { format: "rctrack", version: 1, id: "t", revision: 1, info: { name: "t" }, area, design: { laneWidth: 2, points } };
  return { ...doc, built: bakeBuilt(doc) };
};

describe("fromSouthWest", () => {
  it("measures from the west wall (x) and the south wall (z), not from the centre", () => {
    const area = { length: 22, width: 12 };
    expect(fromSouthWest(area, 0, 0)).toEqual({ fromWest: 11, fromSouth: 6 });
    expect(fromSouthWest(area, -11, -6)).toEqual({ fromWest: 0, fromSouth: 0 });
    expect(fromSouthWest(area, 11, 6)).toEqual({ fromWest: 22, fromSouth: 12 });
    expect(fromSouthWest(area, -6.036, -4.9)).toEqual({ fromWest: 4.964, fromSouth: 1.1 });
  });
});

describe("buildSheet", () => {
  it.each(allTracks)("$name: figures come from built", ({ path }) => {
    const doc = readJson<RcTrack>(path);
    const b = doc.built!;
    const s = buildSheet(doc);
    expect(s.area).toEqual(doc.area);
    expect(s.lapLength).toBe(b.lapLength);
    expect(s.corners).toBe(b.stats.corners);
    expect(s.pipe).toEqual({ length: b.stats.dividerLength, runs: b.stats.dividerRuns });
    expect(s.rostrum).toBe(b.rostrum.side);
    expect(s.size).toEqual(b.size ? { length: b.size.length, width: b.size.width } : null);
    expect(s.jumps).toHaveLength(b.features.length);
    s.jumps.forEach((j, i) => {
      const f = b.features[i];
      expect(j).toMatchObject({ type: f.type, x: f.x, z: f.z, length: f.length, height: f.height, ...fromSouthWest(doc.area, f.x, f.z) });
    });
    expect(s.start).toMatchObject({ x: b.startLine.x, z: b.startLine.z, ...fromSouthWest(doc.area, b.startLine.x, b.startLine.z) });
    const widths = b.racingLine.map((p) => p[2]);
    expect(s.laneWidth).toEqual({ min: Math.min(...widths), max: Math.max(...widths) });
  });

  it.each(allTracks)("$name: corner points number the racer's corners and sit on built's racing line", ({ path }) => {
    const doc = readJson<RcTrack>(path);
    const b = doc.built!;
    const s = buildSheet(doc);
    // one number per corner as racers count them (stats.corners), points of a joined corner lettered a, b, …
    const numbers = [...new Set(s.cornerPoints.map((c) => c.number))];
    expect(numbers).toEqual(Array.from({ length: b.stats.corners }, (_, i) => i + 1));
    const ring = [...b.racingLine, b.racingLine[0]].map((p): [number, number] => [p[0], p[1]]);
    for (const c of s.cornerPoints) {
      expect(c).toMatchObject(fromSouthWest(doc.area, c.x, c.z));
      // where the corner's arc starts and ends is on the racing line in built: within 1 cm, or within 5 cm for a sharp
      // corner with no arc, whose vertex the export spacing (EXPORT_STEP, 0.25 m) can cut
      const sharp = Math.hypot(c.arcEnd[0] - c.arcStart[0], c.arcEnd[1] - c.arcStart[1]) < 1e-9;
      for (const [x, z] of [c.arcStart, c.arcEnd]) expect(distanceToPolyline([x, z], ring)).toBeLessThan(sharp ? 0.05 : 0.01);
    }
  });

  it("club-a: 18 corner points, 12 corners, positions from the south-west corner", () => {
    const s = buildSheet(ex("club-a.rctrack.json"));
    expect(s.cornerPoints).toHaveLength(18);
    expect(s.corners).toBe(12);
    const first = s.cornerPoints[0];
    // design point 0 is (10, -4.9) in a 22 × 12 area: 21 m from the west wall, 1.1 m from the south wall
    expect(first.fromWest).toBeCloseTo(21, 6);
    expect(first.fromSouth).toBeCloseTo(1.1, 6);
    // points 0 and 1 (10, ±4.9) are 9.8 m apart: separate corners; 1 and 2 are 8.1 m apart too
    expect(s.cornerPoints.slice(0, 3).map((c) => c.label)).toEqual(["1", "2", "3"]);
    // joined corners: 90° turns the same way less than 3 m apart are one corner, its points lettered
    expect(s.cornerPoints.map((c) => c.label)).toEqual(["1", "2", "3", "4", "5a", "5b", "6a", "6b", "7", "8", "9a", "9b", "10a", "10b", "10c", "11", "12a", "12b"]);
    expect(s.cornerPoints.filter((c) => c.hairpin).length).toBe(11); // the joined ones turn 180° or 270°
    expect(s.cornerPoints[4]).toMatchObject({ turn: "right", index: 4, fromWest: 3, fromSouth: 6.9 });
    expect(s.direction).toBe("anticlockwise");
  });

  it("turn direction and travel: a clockwise rectangle turns right at every corner", () => {
    const cw = track([{ x: -10, z: 5 }, { x: 10, z: 5 }, { x: 10, z: -5 }, { x: -10, z: -5 }]);
    const s = buildSheet(cw);
    expect(s.direction).toBe("clockwise");
    expect(s.cornerPoints.map((c) => c.turn)).toEqual(["right", "right", "right", "right"]);
    expect(s.cornerPoints.map((c) => c.label)).toEqual(["1", "2", "3", "4"]);
    expect(s.cornerPoints.every((c) => !c.hairpin)).toBe(true);
    expect(s.cornerPoints[1]).toMatchObject({ fromWest: 30, fromSouth: 20 });
  });

  it("small changes of direction (20° or less) aren't corner points", () => {
    const s = buildSheet(track([{ x: 0, z: 0 }, { x: 10, z: 0.5 }, { x: 20, z: 0 }, { x: 20, z: 10 }, { x: 0, z: 10 }]));
    expect(s.cornerPoints).toHaveLength(4);
    expect(s.cornerPoints.map((c) => c.label)).toEqual(["1", "2", "3", "4"]);
  });

  it("a corner joined across point 0 keeps its letters together and is numbered last", () => {
    // the hairpin is made of the last point and point 0
    const pts = [{ x: -10, z: -1 }, { x: 10, z: -1 }, { x: 10, z: 1 }, { x: -10, z: 1 }];
    const s = buildSheet(track(pts));
    expect(s.corners).toBe(2);
    // corner 1 is the first one that starts at or after point 0; the hairpin made of the last point and point 0 is last
    expect(s.cornerPoints.map((c) => [c.label, c.index])).toEqual([["1a", 1], ["1b", 2], ["2a", 3], ["2b", 0]]);
    const rotated = buildSheet(track([pts[3], pts[0], pts[1], pts[2]]));
    expect(rotated.cornerPoints.map((c) => [c.label, c.index])).toEqual([["1a", 0], ["1b", 1], ["2a", 2], ["2b", 3]]);
  });

  it("start line: where it is and which way cars leave it", () => {
    const s = buildSheet(ex("club-a.rctrack.json"));
    expect(s.start.fromWest).toBeCloseTo(5.028, 6);
    expect(s.start.fromSouth).toBeCloseTo(1.1, 6);
    expect(s.start.heading).toBe("east");
    const b = buildSheet(ex("freeform-at-sports-hall-b.rctrack.json"));
    expect(b.start.heading).toBe("west");
  });

  it("needs built", () => {
    const { built: _b, ...doc } = ex("club-a.rctrack.json");
    expect(() => buildSheet(doc as RcTrack)).toThrow(/built/);
  });
});

describe("print palette", () => {
  it("is tokens.json's print-* colours", () => {
    const tokens = JSON.parse(readFileSync(join(repoRoot, "docs/design/tokens.json"), "utf8")) as { color: { tokens: { name: string; value: string }[] } };
    expect(PRINT_PALETTE).toEqual(Object.fromEntries(tokens.color.tokens.filter((t) => t.name.startsWith("print-")).map((t) => [t.name, t.value])));
  });

  it.each(allTracks)("$name: the print plan uses print colours only", ({ path }) => {
    const svg = planLayers(planScene(readJson<RcTrack>(path)), { px: 0.02, palette: "print", layers: { checks: false } });
    const print = new Set(Object.values(PRINT_PALETTE).map((c) => c.toLowerCase()));
    const used = [...svg.matchAll(/(?:fill|stroke)="(#[0-9a-fA-F]{3,8})"/g)].map((m) => m[1].toLowerCase());
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((c) => !print.has(c))).toEqual([]);
  });

  it("keep-out areas are outlined in ink, not white on white", () => {
    const doc = readJson<RcTrack>(allTracks.find((t) => t.name === "freeform-at-sports-hall-b.rctrack.json")!.path);
    expect(doc.obstacles?.some((o) => o.type === "rect")).toBe(true);
    const svg = planLayers(planScene(doc), { px: 0.02, palette: "print" });
    for (const m of svg.matchAll(/<rect class="p-keepout"[^>]*>/g)) expect(m[0]).toContain(`stroke="${PRINT_PALETTE["print-ink"]}"`);
  });

  it("jumps are hatched and outlined in ink, so they read in black and white", () => {
    const svg = planLayers(planScene(ex("club-a.rctrack.json")), { px: 0.02, palette: "print" });
    expect(svg).toMatch(new RegExp(`class="p-jump-body"[^>]*fill="${PRINT_PALETTE["print-jump"]}" stroke="${PRINT_PALETTE["print-ink"]}"`));
    expect(svg).toContain('class="p-jump-print-hatch"');
    expect(svg).toMatch(new RegExp(`class="p-area"[^>]*stroke="${PRINT_PALETTE["print-ink"]}"`));
  });
});

describe("crossovers on the build sheet (#51)", () => {
  const extra = (name: string) => readJson<RcTrack>(allTracks.find((t) => t.name === `${name}.rctrack.json`)!.path);

  it("lists each crossover: where it is from the south-west corner, which pass goes over and its size", () => {
    const doc = extra("crossover-figure8");
    expect(buildSheet(doc).crossovers).toEqual([
      { number: 1, feature: 0, x: 0, z: 0, fromWest: 12, fromSouth: 8, over: "first", length: 8, ramp: 2, top: 4, height: 0.4 },
    ]);
  });

  it("numbers several in driving order from the start line; one that bridges nothing has no over pass", () => {
    const two = buildSheet(extra("two-crossings")).crossovers;
    expect(two.map((c) => [c.number, c.feature, c.over])).toEqual([[1, 0, "first"], [2, 1, "first"]]);
    expect(two.map((c) => c.fromWest)).toEqual([8, 14]);
    expect(buildSheet(extra("crossover-low-figure8")).crossovers[0]).toMatchObject({ over: null, height: 0.3 });
    expect(buildSheet(extra("crossover-unused-figure8")).crossovers.some((c) => c.over === null)).toBe(true);
  });

  it("no crossovers: an empty list (a tabletop bridge stays with the jumps)", () => {
    expect(buildSheet(ex("club-a.rctrack.json")).crossovers).toEqual([]);
    expect(buildSheet(extra("tabletop-figure8")).crossovers).toEqual([]);
  });
});
