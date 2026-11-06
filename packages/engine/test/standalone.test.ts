// rctrack 1.7: a layout belongs to no venue. Venue checks (area, obstacles, rostrum) belong to the fit, not the layout.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  adapt, bake, bakeBuilt, compareBuilt, drawingArea, fits, rostrumPosition, upgradeTrack, validateTrack, venueCheck, VENUE_CHECKS,
  type Built, type RcTrack, type RcVenue,
} from "../src/index.js";
import { allTracks, as17, examples, extraDir, readJson } from "./helpers.js";

const TOL = 0.01;
const ex = (n: string) => readJson<RcTrack>(examples.find((e) => e.name === n)!.path);
const v16Dir = join(extraDir, "..", "v16");
const v16 = readdirSync(v16Dir).filter((f) => f.endsWith(".rctrack.json")).sort();

/** An oval drawn in a 22 × 12 m hall, its south straight running over (0, -4). */
const oval = (): RcTrack => ({
  format: "rctrack", version: 1, id: "oval", revision: 1, info: { name: "Oval" }, area: { length: 22, width: 12 },
  design: { laneWidth: 2, points: [{ x: -9, z: -4 }, { x: 9, z: -4 }, { x: 9, z: 4 }, { x: -9, z: 4 }], start: { distance: 2 } },
});
const hall = (id: string, obstacles: RcVenue["obstacles"]): RcVenue => ({
  format: "rcvenue", version: 1, id, revision: 3, info: { name: `Hall ${id}` }, area: { length: 26, width: 16 },
  rostrum: { side: "north", offset: 2 }, obstacles,
});

describe("upgradeTrack: loading a 1.6 file", () => {
  it("drops obstacles, both rostrums and the venue checks; basedOn becomes info.drawnFor", () => {
    const old = readJson<RcTrack>(join(v16Dir, "freeform-at-sports-hall-b.rctrack.json")) as RcTrack & Record<string, unknown>;
    expect(old.obstacles).toBeDefined();
    const before = JSON.stringify(old);
    const t = upgradeTrack(old, "Sports hall B (renamed)") as RcTrack & Record<string, unknown>;
    expect(JSON.stringify(old)).toBe(before); // pure
    expect(t.obstacles).toBeUndefined();
    expect(t.basedOn).toBeUndefined();
    expect(t.design).not.toHaveProperty("rostrum");
    expect(t.built).not.toHaveProperty("rostrum");
    expect(t.built!.checks.some((c) => (VENUE_CHECKS as readonly string[]).includes(c.code))).toBe(false);
    expect(t.info.drawnFor).toEqual({ venueTemplate: "venue-2", name: "Sports hall B (renamed)" });
    expect(t.area).toEqual(old.area); // the drawing area stays
    expect(validateTrack(t).valid).toBe(true);
  });

  it("names drawnFor after the forum venue, else the template id, when no name is given", () => {
    const old = readJson<RcTrack>(join(v16Dir, "freeform-at-sports-hall-b.rctrack.json"));
    expect(upgradeTrack(old).info.drawnFor).toEqual({ venueTemplate: "venue-2", name: "Sports hall B" });
    expect(upgradeTrack({ ...old, info: { ...old.info, venue: null } }).info.drawnFor).toEqual({ venueTemplate: "venue-2", name: "venue-2" });
  });

  it("leaves a 1.7 layout as it is", () => {
    const t = ex("club-a.rctrack.json");
    expect(upgradeTrack(t)).toEqual(t);
    expect(upgradeTrack(t).info.drawnFor).toBeUndefined();
  });

  it("has 1.6 fixtures", () => expect(v16.length).toBeGreaterThanOrEqual(6));
  it.each(v16)("%s bakes the same racing line and footprint (less the venue's parts)", (name) => {
    const old = readJson<RcTrack>(join(v16Dir, name));
    const t = bake(old);
    expect(Object.keys(t)).not.toContain("obstacles");
    expect(Object.keys(t)).not.toContain("basedOn");
    expect(t.design).not.toHaveProperty("rostrum");
    expect(t.built).not.toHaveProperty("rostrum");
    const want = as17(old.built!);
    const diff = compareBuilt(t.built!, { ...want, generator: "" });
    expect(diff.racingLineCount[0]).toBe(diff.racingLineCount[1]);
    expect(diff.racingLineMax).toBeLessThanOrEqual(TOL);
    expect(diff.lapLength).toBeLessThanOrEqual(TOL);
    expect(diff.footprint.bboxMax).toBeLessThanOrEqual(0.1 + 1e-9);
    expect(diff.checks[0]).toEqual(diff.checks[1]);
    // and exactly what the engine bakes for the stored 1.7 file of the same track, where there is one
    const now = allTracks.find((f) => f.name === name);
    if (now) expect({ ...t.built!, generator: "" }).toEqual({ ...bakeBuilt(readJson<RcTrack>(now.path)), generator: "" });
  });
});

describe("bake: built.checks covers the track only", () => {
  it("no rostrum, and no outside-area or obstacle check even for a 1.6 doc with obstacles off its area", () => {
    const old = { ...oval(), area: { length: 10, width: 4 }, obstacles: [{ type: "circle", x: 0, z: -4, radius: 0.3 }] } as RcTrack;
    const b = bakeBuilt(old);
    expect(b).not.toHaveProperty("rostrum");
    expect(b.checks.map((c) => c.code)).toEqual([]);
  });

  it("area is optional: a layout without one bakes the same", () => {
    const { area: _a, ...t } = oval();
    expect(validateTrack(t).valid).toBe(true);
    expect(bakeBuilt(t as RcTrack)).toEqual(bakeBuilt(oval()));
  });
});

describe("drawingArea", () => {
  it("is the layout's area when it has one", () => expect(drawingArea(ex("club-a.rctrack.json"))).toEqual({ length: 22, width: 12 }));
  it("else a box centred on the origin, whole metres, round built.size with 0.5 m to spare", () => {
    const { area: _a, ...t } = bake(oval());
    // lanes reach x ±10, z ±5
    expect(drawingArea(t as RcTrack)).toEqual({ length: 22, width: 12 });
    expect(drawingArea({ ...t, built: { ...t.built!, size: { length: 3, width: 2, bbox: [-1, -0.2, 2.2, 1.8] } } } as RcTrack)).toEqual({ length: 6, width: 6 });
  });
});

describe("venueCheck: the layout where it is drawn, against a venue", () => {
  const pillarA = hall("A", [{ type: "circle", x: 0, z: -4, radius: 0.3, label: "Pillar" }]);
  const clearB = hall("B", []);

  it("reports obstacle hits and the venue's rostrum", () => {
    const r = venueCheck(bake(oval()), pillarA);
    expect(r.checks.map((c) => c.code)).toEqual(["obstacle"]);
    expect(Math.hypot(r.checks[0].x! - 0, r.checks[0].z! + 4)).toBeLessThan(0.5);
    const [x, z] = rostrumPosition(pillarA.area, "north", 2);
    expect(r.rostrum).toEqual({ side: "north", x, z, eyeHeight: 2.8 });
  });

  it("reports the lanes leaving the venue's area", () => {
    const small: RcVenue = { ...clearB, area: { length: 18, width: 16 } };
    expect(venueCheck(bake(oval()), small).checks.map((c) => c.code)).toEqual(["outside-area"]);
    expect(venueCheck(bake(oval()), clearB).checks).toEqual([]);
  });

  it("a layout made from venue A fits venue B with no trace of A's pillar", () => {
    // drawn in A, over the spot where A has a pillar: A's check says so, but nothing of A is saved in the layout
    const drawnInA: RcTrack = bake({ ...oval(), info: { name: "Oval", drawnFor: { venueTemplate: "A", name: "Hall A" } } });
    expect(venueCheck(drawnInA, pillarA).checks.map((c) => c.code)).toEqual(["obstacle"]);
    expect(JSON.stringify(drawnInA)).not.toMatch(/Pillar|obstacle|rostrum/);
    // B is clear where A has the pillar: the layout fits B as designed, and checks clean there
    expect(venueCheck(drawnInA, clearB).checks).toEqual([]);
    expect(fits(drawnInA, clearB).map((f) => f.orientation)).toContain("as designed");
    // an adapted copy for A carries none of A's obstacles or rostrum either, and fits B
    const fitA = fits(drawnInA, pillarA);
    expect(fitA.length).toBeGreaterThan(0);
    const copy = adapt(drawnInA, pillarA, fitA[0]);
    expect(JSON.stringify(copy)).not.toMatch(/Pillar|obstacle|rostrum|basedOn/);
    expect(venueCheck(copy, pillarA).checks).toEqual([]);
    expect(fits(copy, clearB).length).toBeGreaterThan(0);
  });
});
