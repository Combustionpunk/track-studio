// rctrack 1.11 (#151): marshal points, numbered cones where marshals stand. design.marshals = {number, x, z};
// built.marshals = {number, x, z, distance, side, gap, facing}; checks marshal-on-track, marshal-number-repeated,
// marshal-number-gap and marshal-far. Cones never affect the fit; adapting a layout moves them with it.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  adapt,
  bake,
  bakeBuilt,
  buildSheet,
  fits,
  MARSHAL_REACH,
  planBounds,
  planLayers,
  planMargin,
  planScene,
  planSvg,
  previewSvg,
  reverseDesign,
  transformBuilt,
  validateTrack,
  venueCheck,
  type Built,
  type DesignMarshal,
  type RcTrack,
  type RcVenue,
} from "../src/index.js";
import { examples, extraDir, readJson, venues } from "./helpers.js";

const example = (name: string) => readJson<RcTrack>(examples.find((e) => e.name === `${name}.rctrack.json`)!.path);
const v110 = (name: string) => readJson<RcTrack>(join(extraDir, "..", "v110", `${name}.rctrack.json`));
const venue = (id: string) => readJson<RcVenue>(venues.find((v) => v.name === `${id}.rcvenue.json`)!.path);
const MARSHAL_CODES = ["marshal-on-track", "marshal-number-repeated", "marshal-number-gap", "marshal-far"];
const marshalChecks = (b: Built) => b.checks.filter((c) => MARSHAL_CODES.includes(c.code));

/** A 20 × 8 m oval (lane 2 m) in a 24 × 12 m area, driven anticlockwise, with these cones. */
function oval(marshals?: DesignMarshal[]): RcTrack {
  return {
    format: "rctrack",
    version: 1,
    id: "00000000-0000-4000-8000-000000000151",
    revision: 1,
    info: { name: "Oval" },
    area: { length: 24, width: 12 },
    design: {
      laneWidth: 2,
      points: [
        { x: -9, z: -3, radius: 2 },
        { x: 9, z: -3, radius: 2 },
        { x: 9, z: 3, radius: 2 },
        { x: -9, z: 3, radius: 2 },
      ],
      ...(marshals ? { marshals } : {}),
    },
  };
}

describe("built.marshals", () => {
  it("is absent with no cones, and with an empty list", () => {
    expect(bakeBuilt(oval())).not.toHaveProperty("marshals");
    expect(bakeBuilt(oval([]))).not.toHaveProperty("marshals");
  });

  it("places a cone beside the track: lap distance, side, gap to the lane edge and facing", () => {
    // south straight z = -3 runs east (+x); its outer lane edge is z = -4. A cone at (0, -5) is 1 m outside it, on the
    // right of the direction of travel, looking north at the lane
    const b = bakeBuilt(oval([{ number: 1, x: 0, z: -5 }]));
    const [m] = b.marshals!;
    expect(m).toMatchObject({ number: 1, x: 0, z: -5, side: "right", gap: 1, facing: 90 });
    // the nearest racing-line point is (0, -3): its lap distance is on the lap
    expect(m.distance).toBeGreaterThan(0);
    expect(m.distance).toBeLessThan(b.lapLength);
    const at = b.racingLine.reduce((best, p, i) => (Math.hypot(p[0], p[1] + 3) < Math.hypot(b.racingLine[best][0], b.racingLine[best][1] + 3) ? i : best), 0);
    expect(Math.abs(m.distance - at * 0.25)).toBeLessThan(0.3);
    expect(marshalChecks(b)).toEqual([]);
  });

  it("a cone in the infield is on the left of an anticlockwise lap and faces the nearest lane edge", () => {
    const [m] = bakeBuilt(oval([{ number: 1, x: 0, z: 0 }])).marshals!;
    expect(m.side).toBe("left");
    expect(m.gap).toBeCloseTo(2, 2); // inner lane edges at z = ±2
    expect(Math.min(Math.abs(m.facing - 90), Math.abs(m.facing - 270))).toBeLessThan(0.1);
  });

  it("keeps the design order and copies number and position", () => {
    const cones = [{ number: 3, x: 0, z: -5 }, { number: 1, x: 11, z: 0 }, { number: 2, x: -11, z: 0 }];
    expect(bakeBuilt(oval(cones)).marshals!.map(({ number, x, z }) => ({ number, x, z }))).toEqual(cones);
  });

  it("a cone outside the drawing area is fine: no check against the area", () => {
    const b = bakeBuilt(oval([{ number: 1, x: 0, z: -7.5 }])); // 1.5 m beyond the area's south edge
    expect(b.marshals![0].gap).toBeCloseTo(3.5, 2);
    expect(b.checks.map((c) => c.code)).toEqual(["marshal-far"]);
  });
});

describe("marshal checks", () => {
  it("a cone in a lane is an error at the cone; its gap is 0 and it faces the racing line", () => {
    const b = bakeBuilt(oval([{ number: 1, x: 0, z: -3.5 }]));
    expect(marshalChecks(b)).toEqual([{ level: "error", code: "marshal-on-track", x: 0, z: -3.5, message: "Cone 1 is on the track" }]);
    expect(b.marshals![0]).toMatchObject({ gap: 0, facing: 90 });
  });

  it("a cone on a pipe (just outside the lane edge, within the pipe's thickness) is an error", () => {
    expect(marshalChecks(bakeBuilt(oval([{ number: 1, x: 0, z: -4.02 }]))).map((c) => c.code)).toEqual(["marshal-on-track"]);
    expect(marshalChecks(bakeBuilt(oval([{ number: 1, x: 0, z: -4.2 }])))).toEqual([]);
  });

  it(`a cone more than ${MARSHAL_REACH} m from every lane edge is info`, () => {
    expect(MARSHAL_REACH).toBe(3);
    expect(marshalChecks(bakeBuilt(oval([{ number: 7, x: 0, z: -7.4 }]))).filter((c) => c.code === "marshal-far")).toEqual([
      { level: "info", code: "marshal-far", x: 0, z: -7.4, message: "Cone 7 is 3.4 m from the track" },
    ]);
    expect(marshalChecks(bakeBuilt(oval([{ number: 1, x: 0, z: -6.9 }])))).toEqual([]);
  });

  it("a repeated number is one warning, at its second cone", () => {
    const b = bakeBuilt(oval([{ number: 1, x: 0, z: -5 }, { number: 1, x: 3, z: -5 }, { number: 2, x: 11, z: 0 }]));
    expect(marshalChecks(b)).toEqual([{ level: "warning", code: "marshal-number-repeated", x: 3, z: -5, message: "Two cones are numbered 1" }]);
    const three = bakeBuilt(oval([{ number: 1, x: 0, z: -5 }, { number: 1, x: 3, z: -5 }, { number: 1, x: 11, z: 0 }]));
    expect(marshalChecks(three).map((c) => c.message)).toEqual(["3 cones are numbered 1"]);
  });

  it("a gap in the numbers is a warning per missing number, at the next cone above it", () => {
    const b = bakeBuilt(oval([{ number: 4, x: 0, z: -5 }, { number: 1, x: 11, z: 0 }, { number: 2, x: -11, z: 0 }]));
    expect(marshalChecks(b)).toEqual([
      { level: "warning", code: "marshal-number-gap", x: 0, z: -5, message: "No cone 3: with 3 marshals, cone 4 is manned and 3 is empty" },
    ]);
    expect(marshalChecks(bakeBuilt(oval([{ number: 3, x: 0, z: -5 }]))).map((c) => c.message)).toEqual([
      "No cone 1: with 1 marshals, cone 3 is manned and 1 is empty",
      "No cone 2: with 2 marshals, cone 3 is manned and 2 is empty",
    ]);
  });

  it("come after the track's own checks: per cone first, then repeats, then gaps", () => {
    const b = bakeBuilt(example("freeform-example"));
    expect(b.checks.map((c) => c.code)).toEqual(["marshal-on-track", "marshal-far", "marshal-number-repeated", "marshal-number-gap", "marshal-number-gap"]);
  });
});

describe("the reference fixtures (bake.py 1.11)", () => {
  it.each(["club-a", "freeform-example", "freeform-at-sports-hall-b"])("%s: same cones as the reference", (name) => {
    const doc = example(name);
    const want = doc.built!.marshals!, got = bakeBuilt(doc).marshals!;
    expect(got.map((m) => [m.number, m.side])).toEqual(want.map((m) => [m.number, m.side]));
    got.forEach((m, i) => {
      expect(Math.hypot(m.x - want[i].x, m.z - want[i].z)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(m.distance - want[i].distance)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(m.gap - want[i].gap)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(((m.facing - want[i].facing + 540) % 360) - 180)).toBeLessThanOrEqual(0.5);
    });
  });

  it("freeform-example: the same marshal checks, word for word", () => {
    const doc = example("freeform-example");
    expect(marshalChecks(bakeBuilt(doc))).toEqual(marshalChecks(doc.built!));
  });

  it("club-a's clean set (1-6 round the hall, cone 6 1 m outside the area) has no checks", () => {
    const doc = example("club-a");
    expect(doc.design.marshals!.map((m) => m.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(doc.design.marshals![5].x).toBe(-doc.area!.length / 2 - 1);
    expect(bakeBuilt(doc).checks).toEqual([]);
  });
});

describe("a 1.10 file", () => {
  it.each(["club-a", "freeform-example", "freeform-at-sports-hall-b"])("%s with no cones loads, validates and bakes with no marshals", (name) => {
    const doc = v110(name);
    expect(doc.design).not.toHaveProperty("marshals");
    expect(validateTrack(doc).valid).toBe(true);
    const b = bakeBuilt(doc);
    expect(b).not.toHaveProperty("marshals");
    expect(marshalChecks(b)).toEqual([]);
    expect(b.checks.map((c) => c.code)).toEqual(doc.built!.checks.map((c) => c.code));
  });

  it.each(["club-a", "freeform-example", "freeform-at-sports-hall-b"])("%s: adding cones changes nothing else in built", (name) => {
    const { marshals, checks, ...withCones } = bakeBuilt(example(name));
    const { checks: before, ...without } = bakeBuilt(v110(name));
    expect(marshals!.length).toBeGreaterThan(0);
    expect(withCones).toEqual(without);
    expect(checks.filter((c) => !MARSHAL_CODES.includes(c.code))).toEqual(before);
  });
});

describe("schema", () => {
  it("accepts design.marshals and built.marshals", () => {
    expect(validateTrack(bake(oval([{ number: 1, x: 0, z: -5 }]))).valid).toBe(true);
    for (const e of examples) expect(validateTrack(readJson(e.path)).valid).toBe(true);
  });

  it("rejects a cone numbered 0, a fraction or over 99, and a cone with no position", () => {
    for (const bad of [{ number: 0, x: 0, z: 0 }, { number: 1.5, x: 0, z: 0 }, { number: 100, x: 0, z: 0 }, { number: 1, x: 0 }])
      expect(validateTrack(oval([bad as DesignMarshal])).valid).toBe(false);
  });
});

describe("venue fit and adaptation", () => {
  const track = example("freeform-example");
  const hall = venue("sports-hall-b");
  const without = { ...track, design: { ...track.design, marshals: undefined } };

  it("cones never affect the fit search or the venue checks", () => {
    expect(fits(track, hall)).toEqual(fits(without, hall));
    expect(venueCheck(track, hall)).toEqual(venueCheck(without, hall));
    // a cone far outside the venue doesn't stop it fitting either
    const far = { ...track, design: { ...track.design, marshals: [{ number: 1, x: 40, z: 40 }] } };
    expect(fits(far, hall)).toEqual(fits(without, hall));
  });

  it("adapt moves the cones with the layout: the stored freeform-at-sports-hall-b", () => {
    const stored = example("freeform-at-sports-hall-b");
    const fit = fits(track, hall).find((f) => f.orientation === stored.info.derivedFrom!.orientation)!;
    const out = adapt(track, hall, fit, { id: stored.id });
    expect(out.design.marshals).toEqual(stored.design.marshals);
    expect(out.built!.marshals!.map((m) => m.number)).toEqual(stored.built!.marshals!.map((m) => m.number));
  });

  it.each([
    [90, false],
    [0, true],
    [270, true],
  ])("adapt rotated %i°, mirrored %s: each cone keeps its place beside the track", (rotation, mirror) => {
    const t = bake(oval([{ number: 1, x: 0, z: -5 }, { number: 2, x: 10.5, z: 1 }]));
    const fit = { orientation: "test", rotation, mirror, shift: [0.5, -0.25] as [number, number], spare: [0, 0] as [number, number] };
    const out = adapt(t, { ...hall, obstacles: [] }, fit, { id: "a" });
    const before = t.built!.marshals!, after = out.built!.marshals!;
    after.forEach((m, i) => {
      expect(m.gap).toBeCloseTo(before[i].gap, 2);
      // mirroring keeps the driving order, so the cone is now on the other side of the line
      expect(m.side).toBe(mirror ? (before[i].side === "left" ? "right" : "left") : before[i].side);
    });
    // transformBuilt (drawing a fit without re-baking) puts the cones where the re-bake does
    const moved = transformBuilt(t.built!, fit).marshals!;
    moved.forEach((m, i) => {
      expect(Math.hypot(m.x - after[i].x, m.z - after[i].z)).toBeLessThan(0.002);
      expect(Math.abs(((m.facing - after[i].facing + 540) % 360) - 180)).toBeLessThan(0.5);
      expect(m.side).toBe(after[i].side);
    });
  });

  it("reversing a track leaves the cones where they are", () => {
    const t = oval([{ number: 1, x: 0, z: -5 }]);
    const r = reverseDesign(t.design);
    expect(r.marshals).toEqual(t.design.marshals);
    const [m] = bakeBuilt({ ...t, design: r }).marshals!;
    expect(m.side).toBe("left"); // clockwise now: the outside is on the left
  });
});

describe("drawing", () => {
  it("the forum preview draws each cone with its number", () => {
    const svg = previewSvg(example("club-a"));
    expect(svg.match(/fill="#ff7a1a"/g)).toHaveLength(6);
    for (const k of [1, 2, 3, 4, 5, 6]) expect(svg).toContain(`>${k}</text>`);
  });

  it("the preview widens its margin for a cone further out than 2 m (freeform-example's cone 6, 4 m south)", () => {
    const svg = previewSvg(example("freeform-example"));
    const club = previewSvg(example("club-a")); // same 22 x 12 area, cones within the margin
    expect(svg.match(/height="(\d+)"/)![1]).not.toBe(club.match(/height="(\d+)"/)![1]);
  });

  it("the plan draws a numbered cone for each marshal point, with a tip hook", () => {
    const layers = planLayers(planScene(example("club-a")), { px: 0.05, tips: true });
    expect(layers.match(/class="p-marshal"/g)).toHaveLength(6);
    expect(layers).toContain('data-tip="m5"');
    expect(layers).toMatch(/class="p-marshal-number"[^>]*>6</);
    expect(planLayers(planScene(example("club-a")), { px: 0.05, layers: { marshals: false } })).not.toContain("p-marshal");
  });

  it("the plan's bounds grow to hold a cone further out than the margin, plus 0.5 m", () => {
    const club = planScene(example("club-a"));
    expect(planMargin(club)).toBe(2.5); // cones up to 2 m out sit in the usual margin
    const far = planScene(example("freeform-example")); // cone 6 at z = -10, 4 m beyond the area
    expect(planMargin(far)).toBeCloseTo(4.5, 9);
    const b = planBounds(far.area, planMargin(far));
    expect(b.y0).toBeCloseTo(-6 - 4.5, 9);
    expect(planSvg(far, { width: 600 })).toContain(`viewBox="${b.x0} ${b.y0} ${b.w} ${b.h}"`);
  });
});

describe("build sheet", () => {
  it("lists the cones in fill order: number, position from the south-west corner and where it stands", () => {
    const sheet = buildSheet(example("freeform-example"));
    expect(sheet.marshals.map((m) => m.number)).toEqual([1, 2, 2, 4, 6]);
    const one = sheet.marshals[0];
    expect(one).toMatchObject({ number: 1, x: -6, z: -1.5, fromWest: 5, fromSouth: 4.5 });
    expect(one.where).toMatch(/corner \d+|straight/);
    expect(sheet.marshals.find((m) => m.number === 4)!.where).toBe("on the track");
  });

  it("names the corner a cone stands by, inside or outside it", () => {
    // a 20 × 10 m rectangle, anticlockwise: four 90° corners, corner 1 at point 0 (south-west); a cone beyond the
    // south-west corner is outside it
    const t = oval([{ number: 1, x: -10.8, z: -5.8 }, { number: 2, x: -6.5, z: -2.5 }, { number: 3, x: 0, z: -6 }]);
    t.design.points = [{ x: -9, z: -4, radius: 2 }, { x: 9, z: -4, radius: 2 }, { x: 9, z: 4, radius: 2 }, { x: -9, z: 4, radius: 2 }];
    const sheet = buildSheet(bake(t));
    expect(sheet.corners).toBe(4);
    expect(sheet.marshals.map((m) => m.where)).toEqual(["outside corner 1", "inside corner 1", "beside the straight after corner 1"]);
  });

  it("the oval's ends are hairpins (two 90° points 2 m apart make one corner)", () => {
    const sheet = buildSheet(bake(oval([{ number: 1, x: 11, z: 0 }])));
    expect(sheet.marshals[0].where).toBe("outside corner 1 (hairpin)");
  });

  it("adds the jump a cone stands by", () => {
    const t = oval([{ number: 1, x: 0, z: -5 }]);
    t.design.features = [];
    const plain = buildSheet(bake(t)).marshals[0];
    const lap = bakeBuilt(t).marshals![0].distance;
    t.design.features = [{ type: "double", distance: lap + 1 }];
    expect(buildSheet(bake(t)).marshals[0].where).toBe(`${plain.where}, by the double`);
  });

  it("no cones: an empty list", () => {
    expect(buildSheet(bake(oval())).marshals).toEqual([]);
  });
});
